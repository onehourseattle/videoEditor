/**
 * On-device person segmentation (MediaPipe selfie segmenter) powering the
 * "text behind person" effect. Same locality contract as Whisper: the WASM
 * runtime ships from node_modules (copied to /mediapipe-wasm by
 * fetch-models), the model file loads only from this app's /models dir
 * (`npm run fetch-models -- --segmentation`). Nothing is fetched at runtime.
 *
 * Once initialized, matting is SYNCHRONOUS per frame (MediaPipe video mode),
 * so the compositor can call it inline for both preview and export.
 */

type SegState = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

let state: SegState = 'idle'
let segmenter: import('@mediapipe/tasks-vision').ImageSegmenter | null = null
let lastTs = 0
let personMaskIndex = 1

const SEG_W = 512 // segment at reduced size; matte upscales with the frame

const scratch = document.createElement('canvas')
const matte = document.createElement('canvas')

export function segmentationState(): SegState {
  return state
}

/** Fire-and-forget init; compositor calls this when a 'behind' clip appears. */
export function ensureSegmenter(): void {
  if (state !== 'idle') return
  state = 'loading'
  void (async () => {
    try {
      const modelUrl = '/models/mediapipe/selfie_segmenter.tflite'
      const head = await fetch(modelUrl, { method: 'HEAD' }).catch(() => null)
      if (!head?.ok) {
        state = 'missing'
        return
      }
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
      const make = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        })
      try {
        segmenter = await make('GPU')
      } catch {
        segmenter = await make('CPU')
      }
      // which confidence channel is the person? (selfie models label it
      // 'selfie'/'person'; channel 0 is usually background)
      try {
        const labels = segmenter.getLabels()
        const idx = labels.findIndex((l) => /selfie|person|foreground/i.test(l))
        personMaskIndex = idx >= 0 ? idx : labels.length > 1 ? 1 : 0
      } catch {
        personMaskIndex = 1
      }
      state = 'ready'
    } catch (e) {
      console.warn('segmentation init failed', e)
      state = 'error'
    }
  })()
}

/**
 * Person-only cutout of `frame` (same pixels, background transparent), or
 * null while the segmenter is loading/unavailable. Synchronous when ready.
 */
export function getPersonMatte(frame: CanvasImageSource, srcW: number, srcH: number): HTMLCanvasElement | null {
  if (state !== 'ready' || !segmenter || !srcW || !srcH) return null
  const h = Math.max(16, Math.round((srcH / srcW) * SEG_W))
  if (scratch.width !== SEG_W || scratch.height !== h) {
    scratch.width = SEG_W
    scratch.height = h
    matte.width = SEG_W
    matte.height = h
  }
  const sctx = scratch.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(frame, 0, 0, SEG_W, h)

  lastTs = Math.max(lastTs + 1, Math.round(performance.now()))
  let conf: Float32Array | null = null
  const result = segmenter.segmentForVideo(scratch, lastTs)
  try {
    const masks = result.confidenceMasks
    const mask = masks?.[Math.min(personMaskIndex, (masks?.length ?? 1) - 1)]
    if (mask) conf = mask.getAsFloat32Array()
  } finally {
    result.close()
  }
  if (!conf) return null

  const img = sctx.getImageData(0, 0, SEG_W, h)
  const d = img.data
  for (let i = 0; i < conf.length; i++) {
    // soft edge: keep the model's confidence as alpha, gate the noise floor
    const c = conf[i]
    d[i * 4 + 3] = c < 0.25 ? 0 : Math.min(255, Math.round(c * 255))
  }
  matte.getContext('2d')!.putImageData(img, 0, 0)
  return matte
}
