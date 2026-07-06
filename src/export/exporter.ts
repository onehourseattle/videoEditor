import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { Project, VideoClip } from '../types/model'
import { projectDuration } from '../types/model'
import { renderFrame, clipSourceTime, type FrameProvider } from '../engine/compositor'
import { scheduleAudio } from '../engine/audioGraph'
import { assetStore } from '../state/assetStore'

export interface ExportSettings {
  width: number
  height: number
  fps: number
  videoBitrate: number // bps
  includeAudio: boolean
}

export interface ExportProgress {
  phase: 'audio' | 'video' | 'muxing' | 'done'
  /** 0..1 */
  progress: number
}

const AUDIO_SAMPLE_RATE = 48000

/**
 * Fully local MP4 export. Video: each output frame is composited on canvas from
 * precisely-seeked <video> elements, then encoded with WebCodecs H.264.
 * Audio: the whole mix is rendered by an OfflineAudioContext, then AAC-encoded.
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

  const target = new ArrayBufferTarget()

  // ── audio mix (offline render) ──
  let audioBuffer: AudioBuffer | null = null
  if (settings.includeAudio) {
    onProgress({ phase: 'audio', progress: 0 })
    const offline = new OfflineAudioContext(2, Math.ceil(duration * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE)
    await scheduleAudio(offline, offline.destination, project, 0, 0)
    audioBuffer = await offline.startRendering()
    onProgress({ phase: 'audio', progress: 1 })
  }
  const hasAudio = !!audioBuffer && typeof AudioEncoder !== 'undefined'

  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: settings.width, height: settings.height },
    audio: hasAudio ? { codec: 'aac', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 } : undefined,
    fastStart: 'in-memory',
  })

  // ── video encoder ──
  let encodeError: Error | null = null
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)) },
  })
  videoEncoder.configure({
    codec: pickAvcCodec(settings.width, settings.height, settings.fps),
    width: settings.width,
    height: settings.height,
    bitrate: settings.videoBitrate,
    framerate: settings.fps,
  })

  // render at export resolution (project aspect is preserved by the compositor)
  const exportProject_: Project = { ...project, width: settings.width, height: settings.height }
  const canvas = document.createElement('canvas')
  canvas.width = settings.width
  canvas.height = settings.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const frames = new ExportFrameProvider(project)
  const totalFrames = Math.ceil(duration * settings.fps)

  onProgress({ phase: 'video', progress: 0 })
  for (let i = 0; i < totalFrames; i++) {
    if (signal?.cancelled) {
      videoEncoder.close()
      frames.dispose()
      throw new Error('Export cancelled')
    }
    if (encodeError) throw encodeError
    const t = i / settings.fps
    await frames.prepare(exportProject_, t)
    renderFrame(ctx, exportProject_, t, frames)

    const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / settings.fps) })
    videoEncoder.encode(frame, { keyFrame: i % (settings.fps * 2) === 0 })
    frame.close()
    // keep encoder queue bounded
    if (videoEncoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 10))
    if (i % 5 === 0) onProgress({ phase: 'video', progress: i / totalFrames })
  }
  await videoEncoder.flush()
  frames.dispose()

  // ── audio encode ──
  if (hasAudio && audioBuffer) {
    onProgress({ phase: 'muxing', progress: 0.2 })
    await encodeAudio(audioBuffer, (chunk, meta) => muxer.addAudioChunk(chunk, meta))
  }

  onProgress({ phase: 'muxing', progress: 0.8 })
  muxer.finalize()
  onProgress({ phase: 'done', progress: 1 })
  return new Blob([target.buffer], { type: 'video/mp4' })
}

function pickAvcCodec(w: number, h: number, fps: number): string {
  // High profile, level chosen for resolution (5.1 covers 1080p60 / 4K30)
  const mbps = (w * h * fps) / 256
  const level = mbps > 983040 ? '33' : '2a'
  return `avc1.6400${level}`
}

async function encodeAudio(
  buffer: AudioBuffer,
  emit: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
) {
  let err: Error | null = null
  const encoder = new AudioEncoder({
    output: emit,
    error: (e) => { err = e instanceof Error ? e : new Error(String(e)) },
  })
  encoder.configure({ codec: 'mp4a.40.2', sampleRate: buffer.sampleRate, numberOfChannels: 2, bitrate: 192_000 })

  const chunkFrames = 4800 // 0.1s per AudioData
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    if (err) throw err
    const n = Math.min(chunkFrames, buffer.length - offset)
    const interleaved = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      interleaved[i * 2] = left[offset + i]
      interleaved[i * 2 + 1] = right[offset + i]
    }
    const data = new AudioData({
      format: 'f32',
      sampleRate: buffer.sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((offset / buffer.sampleRate) * 1e6),
      data: interleaved,
    })
    encoder.encode(data)
    data.close()
  }
  await encoder.flush()
  encoder.close()
}

/**
 * Frame provider for export: owns dedicated <video> elements and seeks them to
 * the exact source time for each output frame before the compositor draws.
 */
class ExportFrameProvider implements FrameProvider {
  private videos = new Map<string, HTMLVideoElement>()

  constructor(private sourceProject: Project) {}

  async prepare(project: Project, t: number) {
    const jobs: Promise<void>[] = []
    for (const track of project.tracks) {
      if (track.hidden) continue
      for (const clip of track.clips) {
        if (clip.kind !== 'video') continue
        // include clips in transition windows (they render slightly out of range)
        if (t < clip.start - 1 || t >= clip.start + clip.duration + 1) continue
        const asset = this.sourceProject.assets[clip.assetId]
        if (!asset?.url) continue
        let v = this.videos.get(clip.assetId)
        if (!v) {
          v = assetStore.createExportVideo(clip.assetId, asset.url)
          this.videos.set(clip.assetId, v)
        }
        const want = Math.min(Math.max(0, clipSourceTime(clip, Math.min(Math.max(t, clip.start), clip.start + clip.duration))), (asset.duration || 1) - 0.001)
        if (Math.abs(v.currentTime - want) > 1 / 240) {
          jobs.push(seekTo(v, want))
        }
      }
    }
    await Promise.all(jobs)
  }

  getVideoFrame(clip: VideoClip): CanvasImageSource | null {
    const v = this.videos.get(clip.assetId)
    return v && v.readyState >= 2 ? v : null
  }

  getImage(assetId: string): CanvasImageSource | null {
    return assetStore.getImage(assetId) ?? null
  }

  dispose() {
    for (const v of this.videos.values()) v.removeAttribute('src')
    this.videos.clear()
  }
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve() }
    v.addEventListener('seeked', done)
    v.currentTime = t
    // safety: some containers fire no 'seeked' for sub-frame moves
    setTimeout(done, 500)
  })
}

export const EXPORT_PRESETS = [
  { label: 'TikTok / Reels / Shorts — 1080×1920 @30', width: 1080, height: 1920, fps: 30, videoBitrate: 8_000_000 },
  { label: 'Vertical high-fps — 1080×1920 @60', width: 1080, height: 1920, fps: 60, videoBitrate: 12_000_000 },
  { label: 'Square — 1080×1080 @30', width: 1080, height: 1080, fps: 30, videoBitrate: 6_000_000 },
  { label: 'YouTube — 1920×1080 @30', width: 1920, height: 1080, fps: 30, videoBitrate: 10_000_000 },
  { label: 'Draft preview — 540×960 @30', width: 540, height: 960, fps: 30, videoBitrate: 2_500_000 },
]
