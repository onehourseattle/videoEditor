/// <reference lib="webworker" />
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Project, VideoClip } from '../types/model'
import { projectDuration } from '../types/model'
import { renderFrame, clipSourceTime, createCanvas, type FrameProvider } from '../engine/compositor'
import { pickVideoCodec, pickAudioCodec, encodePcm } from './codecs'

/**
 * Video render + encode, off the main thread.
 *
 * The audio mix arrives as PCM because `OfflineAudioContext` is main-thread
 * only (see REBUILD_SPEC §3.8) — everything else (demux, composite, encode,
 * mux) happens here, so a long export no longer competes with the editor for
 * the main thread.
 */

export interface WorkerExportRequest {
  project: Project
  settings: {
    width: number
    height: number
    fps: number
    videoBitrate: number
    includeAudio: boolean
  }
  /** assetId → media blob (structured-cloned by reference, not copied) */
  blobs: Record<string, Blob>
  fonts: { family: string; data: ArrayBuffer }[]
  audio: { channels: Float32Array[]; sampleRate: number } | null
}

export type WorkerExportResponse =
  | { type: 'progress'; phase: 'video' | 'muxing'; progress: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'error'; message: string }

let cancelled = false

self.onmessage = async (e: MessageEvent) => {
  if (e.data?.type === 'cancel') {
    cancelled = true
    return
  }
  const req = e.data as WorkerExportRequest
  try {
    const buffer = await run(req)
    const res: WorkerExportResponse = { type: 'done', buffer }
    ;(self as unknown as Worker).postMessage(res, [buffer])
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

function post(msg: WorkerExportResponse) {
  ;(self as unknown as Worker).postMessage(msg)
}

async function run(req: WorkerExportRequest): Promise<ArrayBuffer> {
  const { project, settings, blobs, fonts, audio } = req
  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('Project is empty')

  // imported fonts must exist in this realm or text falls back to a default
  for (const f of fonts) {
    try {
      const face = new FontFace(f.family, f.data)
      await face.load()
      ;(self as unknown as { fonts: FontFaceSet }).fonts.add(face)
    } catch { /* skip unusable font */ }
  }

  const videoCodec = await pickVideoCodec(settings)
  const audioCodec = audio && settings.includeAudio ? await pickAudioCodec(audio.sampleRate) : null

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: videoCodec.mux, width: settings.width, height: settings.height },
    audio: audio && audioCodec
      ? { codec: audioCodec.mux, sampleRate: audio.sampleRate, numberOfChannels: 2 }
      : undefined,
    fastStart: 'in-memory',
  })

  let encodeError: Error | null = null
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { encodeError = err instanceof Error ? err : new Error(String(err)) },
  })
  videoEncoder.configure({
    codec: videoCodec.codec,
    width: settings.width,
    height: settings.height,
    bitrate: settings.videoBitrate,
    framerate: settings.fps,
  })

  const scale = Math.min(settings.width / project.width, settings.height / project.height)
  const ox = (settings.width - project.width * scale) / 2
  const oy = (settings.height - project.height * scale) / 2

  const canvas = createCanvas(settings.width, settings.height)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  const frames = new WorkerFrames(project, blobs)
  await frames.loadImages()

  const totalFrames = Math.ceil(duration * settings.fps)
  post({ type: 'progress', phase: 'video', progress: 0 })
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (cancelled) throw new Error('Export cancelled')
      if (encodeError) throw encodeError
      const t = i / settings.fps
      await frames.prepare(t)
      renderFrame(ctx, project, t, frames, scale, ox, oy)

      const frame = new VideoFrame(canvas as unknown as CanvasImageSource, {
        timestamp: Math.round(t * 1e6),
        duration: Math.round(1e6 / settings.fps),
      })
      videoEncoder.encode(frame, { keyFrame: i % (settings.fps * 2) === 0 })
      frame.close()
      while (videoEncoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5))
      if (i % 5 === 0) post({ type: 'progress', phase: 'video', progress: i / totalFrames })
    }
    await videoEncoder.flush()
  } catch (err) {
    try { videoEncoder.close() } catch { /* already closed */ }
    throw err
  } finally {
    frames.dispose()
  }

  if (audio && audioCodec) {
    post({ type: 'progress', phase: 'muxing', progress: 0.2 })
    await encodePcm(audio.channels, audio.sampleRate, audioCodec.codec, (chunk, meta) =>
      muxer.addAudioChunk(chunk, meta),
    )
  }
  post({ type: 'progress', phase: 'muxing', progress: 0.8 })
  muxer.finalize()
  return target.buffer
}

/**
 * Worker frame source: sequential WebCodecs decode only. There is no
 * <video> element off the main thread, so an undecodable container makes the
 * whole job fail — the caller then retries on the main thread, which has the
 * seek-based fallback.
 */
interface Reader {
  iter: AsyncGenerator<{ canvas: CanvasImageSource; timestamp: number }, void, unknown> | null
  current: { canvas: CanvasImageSource; timestamp: number } | null
  next: { canvas: CanvasImageSource; timestamp: number } | null
  done: boolean
}

class WorkerFrames implements FrameProvider {
  private readers = new Map<string, Reader>()
  private sinks = new Map<string, Promise<unknown | null>>()
  private inputs: { dispose?: () => void }[] = []
  private images = new Map<string, ImageBitmap>()

  constructor(private project: Project, private blobs: Record<string, Blob>) {}

  async loadImages() {
    for (const asset of Object.values(this.project.assets)) {
      if (asset.type !== 'image') continue
      const blob = this.blobs[asset.id]
      if (!blob) continue
      try {
        this.images.set(asset.id, await createImageBitmap(blob))
      } catch { /* unsupported image */ }
    }
  }

  private getSink(assetId: string): Promise<unknown | null> {
    let sink = this.sinks.get(assetId)
    if (!sink) {
      sink = (async () => {
        const blob = this.blobs[assetId]
        if (!blob) return null
        const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny')
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
        this.inputs.push(input as unknown as { dispose?: () => void })
        const track = await input.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) return null
        return new CanvasSink(track, { poolSize: 2 })
      })()
      this.sinks.set(assetId, sink)
    }
    return sink
  }

  async prepare(t: number) {
    const active: { clip: VideoClip; want: number }[] = []
    for (const track of this.project.tracks) {
      if (track.hidden) continue
      for (const clip of track.clips) {
        if (clip.kind !== 'video') continue
        if (t < clip.start - 1 || t >= clip.start + clip.duration + 1) continue
        const asset = this.project.assets[clip.assetId]
        if (!asset) continue
        const clamped = Math.min(Math.max(t, clip.start), clip.start + clip.duration - 0.001)
        const want = Math.min(Math.max(0, clipSourceTime(clip, clamped)), (asset.duration || 1) - 0.001)
        active.push({ clip, want })
      }
    }
    await Promise.all(active.map(({ clip, want }) => this.advance(clip, want)))
    for (const [clipId, reader] of this.readers) {
      if (!active.some((a) => a.clip.id === clipId)) {
        void reader.iter?.return?.()
        this.readers.delete(clipId)
      }
    }
  }

  private async advance(clip: VideoClip, want: number) {
    let reader = this.readers.get(clip.id)
    if (!reader) {
      reader = { iter: null, current: null, next: null, done: false }
      this.readers.set(clip.id, reader)
      const sink = (await this.getSink(clip.assetId)) as {
        canvases: (from?: number, to?: number) => AsyncGenerator<{ canvas: CanvasImageSource; timestamp: number }, void, unknown>
      } | null
      if (!sink) throw new Error('This media cannot be decoded off the main thread')
      reader.iter = sink.canvases(Math.max(0, clip.offset), clip.offset + clip.duration * clip.speed + 0.5)
    }
    if (!reader.iter) return
    if (!reader.next && !reader.done) {
      const r = await reader.iter.next()
      if (r.done) reader.done = true
      else reader.next = r.value
    }
    while (reader.next && reader.next.timestamp <= want) {
      reader.current = reader.next
      const r = await reader.iter.next()
      if (r.done) { reader.done = true; reader.next = null } else reader.next = r.value
    }
    if (!reader.current && reader.next) reader.current = reader.next
  }

  getVideoFrame(clip: VideoClip): CanvasImageSource | null {
    return this.readers.get(clip.id)?.current?.canvas ?? null
  }

  getImage(assetId: string): CanvasImageSource | null {
    return (this.images.get(assetId) as unknown as CanvasImageSource) ?? null
  }

  dispose() {
    for (const reader of this.readers.values()) void reader.iter?.return?.()
    this.readers.clear()
    for (const bmp of this.images.values()) bmp.close()
    this.images.clear()
    for (const input of this.inputs) {
      try { input.dispose?.() } catch { /* best effort */ }
    }
    this.inputs = []
  }
}
