import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Project, VideoClip } from '../types/model'
import { projectDuration } from '../types/model'
import { renderFrame, clipSourceTime, type FrameProvider } from '../engine/compositor'
import { scheduleAudio } from '../engine/audioGraph'
import { assetStore } from '../state/assetStore'
import { pickVideoCodec, pickAudioCodec, encodePcm } from './codecs'
import { idb } from '../state/db'

export interface ExportSettings {
  width: number
  height: number
  fps: number
  videoBitrate: number // bps
  includeAudio: boolean
  /** normalize the final mix to -14 LUFS (platform loudness target) */
  normalizeAudio?: boolean
}

export interface ExportProgress {
  phase: 'audio' | 'video' | 'muxing' | 'done'
  /** 0..1 */
  progress: number
}

const AUDIO_SAMPLE_RATE = 48000

/**
 * Render the whole mix offline. Must run on the main thread —
 * `OfflineAudioContext` is not exposed to Workers.
 */
export async function renderAudioMix(project: Project, normalize: boolean): Promise<AudioBuffer | null> {
  const duration = projectDuration(project)
  if (duration <= 0) return null
  const offline = new OfflineAudioContext(2, Math.ceil(duration * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE)
  await scheduleAudio(offline, offline.destination, project, 0, 0)
  const buffer = await offline.startRendering()
  if (normalize) {
    const { normalizationGain, applyGain } = await import('../ai/audioPro')
    const { gain } = normalizationGain(buffer, -14)
    if (Math.abs(gain - 1) > 0.01) applyGain(buffer, gain)
  }
  return buffer
}

/**
 * Fully local MP4 export. Video frames are decoded sequentially with
 * WebCodecs (mediabunny demuxer) — no per-frame <video> seeking — composited
 * through the same renderFrame() the preview uses, and re-encoded (H.264
 * preferred, VP9/AV1 fallback). Audio: the whole mix is rendered by an
 * OfflineAudioContext, then AAC/Opus-encoded.
 */
export async function exportProject(
  project: Project,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  signal?: { cancelled: boolean },
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs is not available in this browser. Use Chrome, Edge, or Safari 16.4+.')
  }

  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('Project is empty — add clips to the timeline first.')

  const videoCodec = await pickVideoCodec(settings)

  // ── audio mix (offline render) ──
  let audioBuffer: AudioBuffer | null = null
  const audioCodec = settings.includeAudio ? await pickAudioCodec(AUDIO_SAMPLE_RATE) : null
  if (settings.includeAudio && audioCodec) {
    onProgress({ phase: 'audio', progress: 0 })
    audioBuffer = await renderAudioMix(project, settings.normalizeAudio !== false)
    onProgress({ phase: 'audio', progress: 1 })
  }

  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target,
    video: { codec: videoCodec.mux, width: settings.width, height: settings.height },
    audio: audioBuffer && audioCodec
      ? { codec: audioCodec.mux, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 }
      : undefined,
    fastStart: 'in-memory',
  })

  // ── video encoder ──
  let encodeError: Error | null = null
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)) },
  })
  videoEncoder.configure({
    codec: videoCodec.codec,
    width: settings.width,
    height: settings.height,
    bitrate: settings.videoBitrate,
    framerate: settings.fps,
  })

  // Layout stays in project coordinates at every output size; letterbox on
  // aspect mismatch instead of re-flowing (what you previewed is what you get).
  const scale = Math.min(settings.width / project.width, settings.height / project.height)
  const ox = (settings.width - project.width * scale) / 2
  const oy = (settings.height - project.height * scale) / 2

  const canvas = document.createElement('canvas')
  canvas.width = settings.width
  canvas.height = settings.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const frames = new ExportFrameProvider(project)
  const totalFrames = Math.ceil(duration * settings.fps)

  onProgress({ phase: 'video', progress: 0 })
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal?.cancelled) throw new Error('Export cancelled')
      if (encodeError) throw encodeError
      const t = i / settings.fps
      await frames.prepare(t)
      renderFrame(ctx, project, t, frames, scale, ox, oy)

      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / settings.fps) })
      videoEncoder.encode(frame, { keyFrame: i % (settings.fps * 2) === 0 })
      frame.close()
      // keep encoder queue bounded
      while (videoEncoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5))
      if (i % 5 === 0) onProgress({ phase: 'video', progress: i / totalFrames })
    }
    await videoEncoder.flush()
  } catch (e) {
    try { videoEncoder.close() } catch { /* already closed */ }
    throw e
  } finally {
    await frames.dispose()
  }

  // ── audio encode ──
  if (audioBuffer && audioCodec) {
    onProgress({ phase: 'muxing', progress: 0.2 })
    await encodePcm(channelsOf(audioBuffer), audioBuffer.sampleRate, audioCodec.codec, (chunk, meta) =>
      muxer.addAudioChunk(chunk, meta),
    )
  }

  onProgress({ phase: 'muxing', progress: 0.8 })
  muxer.finalize()
  onProgress({ phase: 'done', progress: 1 })
  return new Blob([target.buffer], { type: 'video/mp4' })
}

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  return [left, right]
}

/**
 * Export with the frame loop in a Worker, so a long render doesn't compete
 * with the editor for the main thread. Audio is mixed here (Web Audio is
 * main-thread only) and its PCM transferred in. Rejects when the Worker can't
 * handle the media — callers fall back to `exportProject`, which has the
 * seek-based decode path.
 */
export async function exportProjectInWorker(
  project: Project,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void,
  signal?: { cancelled: boolean },
): Promise<Blob> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Worker export unavailable')
  }
  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('Project is empty — add clips to the timeline first.')

  // audio first, on this thread
  let audio: { channels: Float32Array[]; sampleRate: number } | null = null
  if (settings.includeAudio) {
    onProgress({ phase: 'audio', progress: 0 })
    const buffer = await renderAudioMix(project, settings.normalizeAudio !== false)
    if (buffer) {
      const [l, r] = channelsOf(buffer)
      audio = { channels: [new Float32Array(l), new Float32Array(r)], sampleRate: buffer.sampleRate }
    }
    onProgress({ phase: 'audio', progress: 1 })
  }

  // media blobs (structured-cloned by reference) + imported fonts
  const blobs: Record<string, Blob> = {}
  for (const asset of Object.values(project.assets)) {
    const blob = assetStore.getBlob(asset.id) ?? (await idb.get<Blob>('blobs', asset.id))
    if (blob) blobs[asset.id] = blob
  }
  const storedFonts = await idb.getAll<{ family: string; data: ArrayBuffer }>('fonts')

  const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const onCancel = setInterval(() => {
        if (signal?.cancelled) worker.postMessage({ type: 'cancel' })
      }, 250)
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'progress') {
          onProgress({ phase: msg.phase, progress: msg.progress })
        } else if (msg.type === 'done') {
          clearInterval(onCancel)
          onProgress({ phase: 'done', progress: 1 })
          resolve(new Blob([msg.buffer], { type: 'video/mp4' }))
        } else if (msg.type === 'error') {
          clearInterval(onCancel)
          reject(new Error(msg.message))
        }
      }
      worker.onerror = (e) => {
        clearInterval(onCancel)
        reject(new Error(e.message || 'Export worker failed'))
      }
      const transfers: Transferable[] = audio ? audio.channels.map((c) => c.buffer) : []
      worker.postMessage(
        {
          project,
          settings: {
            width: settings.width, height: settings.height, fps: settings.fps,
            videoBitrate: settings.videoBitrate, includeAudio: settings.includeAudio,
          },
          blobs,
          fonts: storedFonts,
          audio,
        },
        transfers,
      )
    })
  } finally {
    worker.terminate()
  }
}

// ─── frame provider ──────────────────────────────────────────────────────────

interface ClipReader {
  /** sequential WebCodecs decode via mediabunny — the fast path */
  iter: AsyncGenerator<{ canvas: CanvasImageSource; timestamp: number }, void, unknown> | null
  current: { canvas: CanvasImageSource; timestamp: number } | null
  next: { canvas: CanvasImageSource; timestamp: number } | null
  done: boolean
  /** seek-based <video> fallback for containers/codecs WebCodecs can't decode */
  fallbackVideo: HTMLVideoElement | null
}

/**
 * Per-clip sequential decoders. Because export time only moves forward, each
 * clip is one forward pass through its source — every packet decoded at most
 * once. Falls back to precise <video> seeking per asset when the container
 * isn't demuxable (rare).
 */
class ExportFrameProvider implements FrameProvider {
  private readers = new Map<string, ClipReader>()
  private sinks = new Map<string, Promise<unknown | null>>() // assetId → CanvasSink | null
  private inputs: { dispose?: () => void }[] = []
  private fallbackAssets = new Set<string>()

  constructor(private project: Project) {}

  /** CanvasSink per asset (null = not decodable → use fallback). */
  private getSink(assetId: string): Promise<unknown | null> {
    let sink = this.sinks.get(assetId)
    if (!sink) {
      sink = (async () => {
        const blob = assetStore.getBlob(assetId)
        if (!blob) return null
        try {
          const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny')
          const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
          this.inputs.push(input as unknown as { dispose?: () => void })
          const track = await input.getPrimaryVideoTrack()
          if (!track || !(await track.canDecode())) return null
          return new CanvasSink(track, { poolSize: 2 })
        } catch {
          return null
        }
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
        // include clips in transition windows (they render slightly out of range)
        if (t < clip.start - 1 || t >= clip.start + clip.duration + 1) continue
        const asset = this.project.assets[clip.assetId]
        if (!asset?.url) continue
        const clamped = Math.min(Math.max(t, clip.start), clip.start + clip.duration - 0.001)
        const want = Math.min(Math.max(0, clipSourceTime(clip, clamped)), (asset.duration || 1) - 0.001)
        active.push({ clip, want })
      }
    }

    await Promise.all(active.map(({ clip, want }) => this.advance(clip, want)))

    // release readers for clips we've moved past
    for (const [clipId, reader] of this.readers) {
      const stillActive = active.some((a) => a.clip.id === clipId)
      if (!stillActive) {
        void reader.iter?.return?.()
        reader.fallbackVideo?.removeAttribute('src')
        this.readers.delete(clipId)
      }
    }
  }

  private async advance(clip: VideoClip, want: number) {
    let reader = this.readers.get(clip.id)
    if (!reader) {
      reader = { iter: null, current: null, next: null, done: false, fallbackVideo: null }
      this.readers.set(clip.id, reader)
      if (!this.fallbackAssets.has(clip.assetId)) {
        const sink = (await this.getSink(clip.assetId)) as {
          canvases: (from?: number, to?: number) => AsyncGenerator<{ canvas: CanvasImageSource; timestamp: number }, void, unknown>
        } | null
        if (sink) {
          const from = Math.max(0, clip.offset)
          const to = clip.offset + clip.duration * clip.speed + 0.5
          reader.iter = sink.canvases(from, to)
        } else {
          this.fallbackAssets.add(clip.assetId)
        }
      }
    }

    if (reader.iter) {
      try {
        // pull frames forward until `next` is beyond the wanted time
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
        if (!reader.current && reader.next) reader.current = reader.next // first frame starts past `want`
        return
      } catch {
        // decoder blew up mid-stream — drop to the <video> fallback
        reader.iter = null
        reader.current = null
        this.fallbackAssets.add(clip.assetId)
      }
    }

    // fallback: precise-seek a dedicated <video>
    const asset = this.project.assets[clip.assetId]
    if (!asset?.url) return
    if (!reader.fallbackVideo) {
      reader.fallbackVideo = assetStore.createExportVideo(clip.assetId, asset.url)
      await waitEvent(reader.fallbackVideo, 'loadeddata', 5000)
    }
    const v = reader.fallbackVideo
    if (Math.abs(v.currentTime - want) > 1 / 240) {
      v.currentTime = want
      await waitEvent(v, 'seeked', 500)
    }
  }

  getVideoFrame(clip: VideoClip): CanvasImageSource | null {
    const reader = this.readers.get(clip.id)
    if (!reader) return null
    if (reader.current) return reader.current.canvas
    if (reader.fallbackVideo && reader.fallbackVideo.readyState >= 2) return reader.fallbackVideo
    return null
  }

  getImage(assetId: string): CanvasImageSource | null {
    return assetStore.getImage(assetId) ?? null
  }

  async dispose() {
    for (const reader of this.readers.values()) {
      void reader.iter?.return?.()
      reader.fallbackVideo?.removeAttribute('src')
    }
    this.readers.clear()
    for (const input of this.inputs) {
      try { input.dispose?.() } catch { /* best effort */ }
    }
    this.inputs = []
  }
}

function waitEvent(el: EventTarget, event: string, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; el.removeEventListener(event, finish); resolve() } }
    el.addEventListener(event, finish, { once: true })
    setTimeout(finish, timeout)
  })
}

export const EXPORT_PRESETS = [
  { label: 'TikTok / Reels / Shorts — 1080×1920 @30', width: 1080, height: 1920, fps: 30, videoBitrate: 8_000_000 },
  { label: 'Vertical high-fps — 1080×1920 @60', width: 1080, height: 1920, fps: 60, videoBitrate: 12_000_000 },
  { label: 'Square — 1080×1080 @30', width: 1080, height: 1080, fps: 30, videoBitrate: 6_000_000 },
  { label: 'YouTube — 1920×1080 @30', width: 1920, height: 1080, fps: 30, videoBitrate: 10_000_000 },
  { label: 'Draft preview — 540×960 @30', width: 540, height: 960, fps: 30, videoBitrate: 2_500_000 },
]
