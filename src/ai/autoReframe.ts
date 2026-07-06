import { assetStore } from '../state/assetStore'
import type { AssetMeta, Keyframe } from '../types/model'

/**
 * Auto-reframe for vertical: tracks the horizontal center of motion in a wide
 * source and produces smoothed `transform.x` keyframes that keep the action
 * centered when the compositor cover-fits it into a 9:16 frame.
 * Pure frame-difference motion saliency — local, no models needed.
 */
export async function computeReframeKeyframes(
  asset: AssetMeta,
  clip: { offset: number; duration: number; speed: number },
  projectW: number,
  projectH: number,
  onProgress?: (p: number) => void,
): Promise<Keyframe[]> {
  if (asset.type !== 'video' || !asset.url) return []
  const video = assetStore.createExportVideo(asset.id, asset.url)
  await waitFor(video, 'loadeddata')

  const W = 96
  const H = 54
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  // how far the cover-fit source extends past the frame (px, at project scale)
  const coverScale = Math.max(projectW / asset.width, projectH / asset.height)
  const overflowX = (asset.width * coverScale - projectW) / 2
  if (overflowX < 8) return [] // nothing to reframe — source already fits

  const step = Math.max(0.2, clip.duration / 60) // ≤60 samples per clip
  let prev: Uint8ClampedArray | null = null
  const centers: { t: number; cx: number }[] = []

  for (let lt = 0; lt < clip.duration; lt += step) {
    const sourceT = clip.offset + lt * clip.speed
    if (sourceT >= asset.duration) break
    video.currentTime = sourceT
    await waitFor(video, 'seeked', 400)
    ctx.drawImage(video, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data
    if (prev) {
      // motion center of mass
      let sum = 0
      let sx = 0
      for (let i = 0; i < data.length; i += 4) {
        const d =
          Math.abs(data[i] - prev[i]) + Math.abs(data[i + 1] - prev[i + 1]) + Math.abs(data[i + 2] - prev[i + 2])
        if (d > 40) {
          const px = (i / 4) % W
          sum += d
          sx += d * px
        }
      }
      const cx = sum > 500 ? sx / sum / W : 0.5 // 0..1, fallback = center
      centers.push({ t: lt, cx })
    }
    prev = new Uint8ClampedArray(data)
    onProgress?.(lt / clip.duration)
  }
  video.removeAttribute('src')
  if (centers.length < 2) return []

  // exponential smoothing so the crop glides instead of jittering
  let s = centers[0].cx
  const smoothed = centers.map((c) => {
    s = s * 0.75 + c.cx * 0.25
    return { t: c.t, cx: s }
  })

  // decimate: keep keyframes only where the target moved meaningfully
  const kfs: Keyframe[] = []
  let lastKept = -1
  for (const c of smoothed) {
    // cx 0.5 = centered; offset moves the layer opposite to the subject
    const x = clamp((0.5 - c.cx) * 2 * overflowX, -overflowX, overflowX)
    if (lastKept < 0 || Math.abs(x - lastKept) > overflowX * 0.08 || c.t === smoothed[smoothed.length - 1].t) {
      kfs.push({ t: c.t, value: Math.round(x), easing: 'easeInOut' })
      lastKept = x
    }
  }
  return kfs.length >= 2 ? kfs : []
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function waitFor(el: HTMLMediaElement, event: string, timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; el.removeEventListener(event, finish); resolve() } }
    el.addEventListener(event, finish, { once: true })
    setTimeout(finish, timeout)
  })
}
