import type { AssetMeta } from '../types/model'
import { uid } from '../utils/id'
import { idb } from './db'

/**
 * Holds the binary side of assets (Blobs + decoded helpers) outside of the
 * undoable project JSON. Object URLs are session-scoped; the project file
 * stores names so media can be re-linked after reload.
 */
class AssetStore {
  private blobs = new Map<string, Blob>()
  private audioBuffers = new Map<string, AudioBuffer>()
  private videoPool = new Map<string, HTMLVideoElement>()
  private images = new Map<string, HTMLImageElement>()
  private filmstrips = new Map<string, Promise<string>>()
  private waveforms = new Map<string, Promise<string>>()

  async importFile(file: File): Promise<AssetMeta> {
    const id = uid('asset')
    const url = URL.createObjectURL(file)
    this.blobs.set(id, file)
    void idb.put('blobs', id, file) // persist so reloads never ask to re-link

    if (file.type.startsWith('video')) {
      const video = document.createElement('video')
      video.preload = 'auto'
      video.muted = true
      video.src = url
      await once(video, 'loadedmetadata')
      const meta: AssetMeta = {
        id,
        name: file.name,
        type: 'video',
        duration: await realDuration(video),
        width: video.videoWidth,
        height: video.videoHeight,
        url,
        thumbnail: await captureThumb(video),
      }
      this.videoPool.set(id, video)
      return meta
    }

    if (file.type.startsWith('audio')) {
      const dur = await audioDuration(url)
      return { id, name: file.name, type: 'audio', duration: dur, width: 0, height: 0, url }
    }

    if (file.type.startsWith('image')) {
      const img = new Image()
      img.src = url
      await once(img, 'load')
      this.images.set(id, img)
      return {
        id,
        name: file.name,
        type: 'image',
        duration: 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
        url,
        thumbnail: url,
      }
    }

    throw new Error(`Unsupported file type: ${file.type || file.name}`)
  }

  getBlob(id: string): Blob | undefined {
    return this.blobs.get(id)
  }

  getImage(id: string): HTMLImageElement | undefined {
    return this.images.get(id)
  }

  /** Shared <video> element per asset, used by the realtime preview. */
  getPreviewVideo(id: string, url: string): HTMLVideoElement {
    let v = this.videoPool.get(id)
    if (!v) {
      v = document.createElement('video')
      v.preload = 'auto'
      v.muted = true // audio goes through the Web Audio mixer, not the element
      v.src = url
      this.videoPool.set(id, v)
    }
    return v
  }

  /** Dedicated seek-video for export (doesn't fight with the preview element). */
  createExportVideo(id: string, url: string): HTMLVideoElement {
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    v.src = url
    return v
  }

  /** Decode full audio track (from video or audio assets) for mixing/analysis. */
  async getAudioBuffer(id: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
    const cached = this.audioBuffers.get(id)
    if (cached) return cached
    const blob = this.blobs.get(id)
    if (!blob) return null
    try {
      const arr = await blob.arrayBuffer()
      const buf = await ctx.decodeAudioData(arr)
      this.audioBuffers.set(id, buf)
      return buf
    } catch {
      return null // video without audio track, or undecodable
    }
  }

  /** Filmstrip of N frames across the asset, drawn once and cached (dataURL). */
  getFilmstrip(id: string, url: string, duration: number): Promise<string> {
    let p = this.filmstrips.get(id)
    if (!p) {
      p = buildFilmstrip(url, duration).catch(() => '')
      this.filmstrips.set(id, p)
    }
    return p
  }

  /** Min/max waveform image for audio clips, computed from the decoded buffer. */
  getWaveform(id: string): Promise<string> {
    let p = this.waveforms.get(id)
    if (!p) {
      p = (async () => {
        const probe = new OfflineAudioContext(1, 1, 16000)
        const buf = await this.getAudioBuffer(id, probe)
        return buf ? drawWaveform(buf) : ''
      })().catch(() => '')
      this.waveforms.set(id, p)
    }
    return p
  }

  /**
   * Restore asset blobs from IndexedDB after a reload: recreate object URLs
   * and decoded elements. Returns updated metas + ids whose blobs are gone
   * (cleared site data) and need a manual re-import.
   */
  async rehydrateAssets(assets: Record<string, AssetMeta>): Promise<{ assets: Record<string, AssetMeta>; missing: string[] }> {
    const out: Record<string, AssetMeta> = {}
    const missing: string[] = []
    for (const [id, meta] of Object.entries(assets)) {
      if (meta.url && this.blobs.has(id)) {
        out[id] = meta
        continue
      }
      const blob = await idb.get<Blob>('blobs', id)
      if (!blob) {
        missing.push(id)
        out[id] = { ...meta, url: '' }
        continue
      }
      this.blobs.set(id, blob)
      const url = URL.createObjectURL(blob)
      out[id] = { ...meta, url, thumbnail: meta.type === 'image' ? url : meta.thumbnail }
      if (meta.type === 'image') {
        const img = new Image()
        img.src = url
        this.images.set(id, img)
      }
    }
    return { assets: out, missing }
  }

  /** Register an imported blob under an existing (re-linked) asset id too. */
  adopt(sourceId: string, targetId: string) {
    const blob = this.blobs.get(sourceId)
    if (!blob) return
    this.blobs.set(targetId, blob)
    void idb.put('blobs', targetId, blob)
  }

  remove(id: string) {
    void idb.delete('blobs', id)
    this.filmstrips.delete(id)
    this.waveforms.delete(id)
    const blob = this.blobs.get(id)
    if (blob) this.blobs.delete(id)
    this.audioBuffers.delete(id)
    this.videoPool.get(id)?.removeAttribute('src')
    this.videoPool.delete(id)
    this.images.delete(id)
  }
}

function once(el: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    el.addEventListener(event, () => resolve(), { once: true })
    el.addEventListener('error', () => reject(new Error(`failed loading media (${event})`)), { once: true })
  })
}

async function audioDuration(url: string): Promise<number> {
  const a = new Audio()
  a.preload = 'metadata'
  a.src = url
  await once(a, 'loadedmetadata')
  return realDuration(a)
}

/**
 * MediaRecorder-produced WebM (screen/camera recordings) reports
 * duration=Infinity in metadata. Seeking far past the end forces the browser
 * to scan the file and report the real duration.
 */
async function realDuration(el: HTMLMediaElement): Promise<number> {
  if (isFinite(el.duration) && el.duration > 0) return el.duration
  el.currentTime = 1e7
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (!done && isFinite(el.duration)) { done = true; resolve() }
    }
    el.addEventListener('durationchange', finish)
    el.addEventListener('seeked', finish)
    setTimeout(() => { done = true; resolve() }, 3000)
  })
  el.currentTime = 0
  return isFinite(el.duration) && el.duration > 0 ? el.duration : 1
}

async function captureThumb(video: HTMLVideoElement): Promise<string> {
  try {
    video.currentTime = Math.min(0.5, video.duration / 2)
    await once(video, 'seeked')
    const c = document.createElement('canvas')
    const scale = 160 / video.videoWidth
    c.width = 160
    c.height = Math.round(video.videoHeight * scale)
    c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.6)
  } catch {
    return ''
  }
}

const FILMSTRIP_FRAMES = 8
const FILMSTRIP_H = 46

async function buildFilmstrip(url: string, duration: number): Promise<string> {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.src = url
  await once(video, 'loadeddata')
  const frameW = Math.max(24, Math.round((video.videoWidth / video.videoHeight) * FILMSTRIP_H))
  const c = document.createElement('canvas')
  c.width = frameW * FILMSTRIP_FRAMES
  c.height = FILMSTRIP_H
  const ctx = c.getContext('2d')!
  for (let i = 0; i < FILMSTRIP_FRAMES; i++) {
    video.currentTime = Math.min(duration - 0.05, (duration * (i + 0.5)) / FILMSTRIP_FRAMES)
    await Promise.race([once(video, 'seeked'), new Promise((r) => setTimeout(r, 500))])
    ctx.drawImage(video, i * frameW, 0, frameW, FILMSTRIP_H)
  }
  video.removeAttribute('src')
  return c.toDataURL('image/jpeg', 0.55)
}

function drawWaveform(buf: AudioBuffer): string {
  const BINS = 220
  const W = BINS * 2
  const H = 44
  const data = buf.getChannelData(0)
  const per = Math.floor(data.length / BINS)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  for (let i = 0; i < BINS; i++) {
    let min = 0
    let max = 0
    const base = i * per
    // sparse sampling keeps this instant even for hour-long audio
    for (let j = 0; j < per; j += Math.max(1, Math.floor(per / 48))) {
      const v = data[base + j]
      if (v < min) min = v
      if (v > max) max = v
    }
    const y1 = (0.5 - max * 0.48) * H
    const y2 = (0.5 - min * 0.48) * H
    ctx.fillRect(i * 2, y1, 1.4, Math.max(1, y2 - y1))
  }
  return c.toDataURL('image/png')
}

export const assetStore = new AssetStore()
