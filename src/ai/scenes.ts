import { assetStore } from '../state/assetStore'
import type { AssetMeta } from '../types/model'

/**
 * Scene-cut detection: sample frames at ~4fps, compare downscaled color
 * histograms; a spike in histogram distance = a cut. Runs locally via
 * <video> seeking, no decode pipeline needed.
 */
export async function detectScenes(
  asset: AssetMeta,
  onProgress?: (p: number) => void,
): Promise<number[]> {
  if (asset.type !== 'video' || !asset.url) return []
  const video = assetStore.createExportVideo(asset.id, asset.url)
  await waitFor(video, 'loadeddata')

  const step = 0.25
  const W = 64
  const H = 36
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const cuts: number[] = []
  let prev: Float32Array | null = null
  let prevDist = 0

  for (let t = 0; t < asset.duration; t += step) {
    video.currentTime = t
    await waitFor(video, 'seeked', 400)
    ctx.drawImage(video, 0, 0, W, H)
    const hist = histogram(ctx.getImageData(0, 0, W, H).data)
    if (prev) {
      const dist = chiSquare(hist, prev)
      // a cut = sharp spike relative to neighborhood, absolute floor to skip noise
      if (dist > 0.28 && dist > prevDist * 2.2 && (cuts.length === 0 || t - cuts[cuts.length - 1] > 0.6)) {
        cuts.push(t)
      }
      prevDist = dist * 0.5 + prevDist * 0.5
    }
    prev = hist
    onProgress?.(t / asset.duration)
  }
  video.removeAttribute('src')
  return cuts
}

function histogram(data: Uint8ClampedArray): Float32Array {
  // 4x4x4 RGB histogram, normalized
  const h = new Float32Array(64)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] >> 6
    const g = data[i + 1] >> 6
    const b = data[i + 2] >> 6
    h[(r << 4) | (g << 2) | b]++
  }
  const total = data.length / 4
  for (let i = 0; i < 64; i++) h[i] /= total
  return h
}

function chiSquare(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const sum = a[i] + b[i]
    if (sum > 0) s += ((a[i] - b[i]) ** 2) / sum
  }
  return s
}

function waitFor(el: HTMLMediaElement, event: string, timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; el.removeEventListener(event, finish); resolve() } }
    el.addEventListener(event, finish, { once: true })
    setTimeout(finish, timeout)
  })
}
