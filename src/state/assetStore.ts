import type { AssetMeta } from '../types/model'
import { uid } from '../utils/id'

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

  async importFile(file: File): Promise<AssetMeta> {
    const id = uid('asset')
    const url = URL.createObjectURL(file)
    this.blobs.set(id, file)

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
        duration: video.duration,
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

  remove(id: string) {
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
  return a.duration
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

export const assetStore = new AssetStore()
