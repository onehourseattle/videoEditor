import type { Effect } from '../types/model'

/**
 * Effects come in two flavors:
 *  - ctx.filter-based (GPU accelerated, cheap): brightness, contrast, blur…
 *  - pixel effects (getImageData): chroma key, vignette, glitch, grain…
 * The compositor draws a clip's layer to a scratch canvas, applies filter
 * string + pixel passes, then composites.
 */

export function filterString(effects: Effect[]): string {
  const parts: string[] = []
  for (const e of effects) {
    if (!e.enabled) continue
    const amt = Number(e.params.amount ?? 1)
    switch (e.type) {
      case 'brightness': parts.push(`brightness(${amt})`); break
      case 'contrast': parts.push(`contrast(${amt})`); break
      case 'saturation': parts.push(`saturate(${amt})`); break
      case 'hue': parts.push(`hue-rotate(${Number(e.params.degrees ?? 0)}deg)`); break
      case 'blur': parts.push(`blur(${Number(e.params.px ?? 4)}px)`); break
      case 'grayscale': parts.push(`grayscale(${amt})`); break
      case 'sepia': parts.push(`sepia(${amt})`); break
      case 'invert': parts.push(`invert(${amt})`); break
      default: break
    }
  }
  return parts.length ? parts.join(' ') : 'none'
}

export function hasPixelEffects(effects: Effect[]): boolean {
  return effects.some((e) => e.enabled && isPixelEffect(e.type))
}

function isPixelEffect(t: Effect['type']): boolean {
  return t === 'chromaKey' || t === 'vignette' || t === 'glitch' || t === 'vhs' || t === 'filmGrain' || t === 'pixelate' || t === 'sharpen' || t === 'lut'
}

/** Apply pixel-level effects in place on a canvas. `time` drives animated effects. */
export function applyPixelEffects(canvas: HTMLCanvasElement | OffscreenCanvas, effects: Effect[], time: number) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  for (const e of effects) {
    if (!e.enabled || !isPixelEffect(e.type)) continue
    switch (e.type) {
      case 'chromaKey': chromaKey(ctx, canvas.width, canvas.height, e); break
      case 'vignette': vignette(ctx, canvas.width, canvas.height, Number(e.params.amount ?? 0.6)); break
      case 'glitch': glitch(ctx, canvas.width, canvas.height, time, Number(e.params.amount ?? 1)); break
      case 'vhs': vhs(ctx, canvas.width, canvas.height, time); break
      case 'filmGrain': grain(ctx, canvas.width, canvas.height, Number(e.params.amount ?? 0.15)); break
      case 'pixelate': pixelate(ctx, canvas.width, canvas.height, Number(e.params.size ?? 16)); break
      case 'sharpen': convolve(ctx, canvas.width, canvas.height, [0, -1, 0, -1, 5, -1, 0, -1, 0]); break
      case 'lut': lutTint(ctx, canvas.width, canvas.height, e); break
      default: break
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function chromaKey(ctx: CanvasRenderingContext2D, w: number, h: number, e: Effect) {
  const [kr, kg, kb] = hexToRgb(String(e.params.keyColor ?? '#00ff00'))
  const tol = Number(e.params.tolerance ?? 0.35) * 255 * Math.sqrt(3)
  const soft = Number(e.params.softness ?? 0.1) * 255
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.sqrt((d[i] - kr) ** 2 + (d[i + 1] - kg) ** 2 + (d[i + 2] - kb) ** 2)
    if (dist < tol) d[i + 3] = 0
    else if (dist < tol + soft) d[i + 3] = Math.round(d[i + 3] * ((dist - tol) / soft))
  }
  ctx.putImageData(img, 0, 0)
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.75)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, amount)})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function glitch(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, amount: number) {
  // deterministic per-frame pseudo-random slices + RGB shift
  const seed = Math.floor(time * 12)
  const rand = mulberry(seed)
  const slices = 3 + Math.floor(rand() * 4)
  for (let i = 0; i < slices; i++) {
    const y = Math.floor(rand() * h)
    const sh = Math.floor(rand() * h * 0.08) + 2
    const dx = Math.floor((rand() - 0.5) * w * 0.08 * amount)
    ctx.drawImage(ctx.canvas, 0, y, w, sh, dx, y, w, sh)
  }
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.06 * amount
  ctx.drawImage(ctx.canvas, 4 * amount, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

function vhs(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  for (let y = Math.floor(time * 30) % 3; y < h; y += 3) ctx.fillRect(0, y, w, 1)
  // slight chroma bleed
  ctx.globalAlpha = 0.05
  ctx.drawImage(ctx.canvas, 2, 0)
  ctx.globalAlpha = 1
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const strength = amount * 255
  for (let i = 0; i < d.length; i += 16) {
    const n = (Math.random() - 0.5) * strength
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

function pixelate(ctx: CanvasRenderingContext2D, w: number, h: number, size: number) {
  const sw = Math.max(1, Math.floor(w / size))
  const sh = Math.max(1, Math.floor(h / size))
  const tmp = document.createElement('canvas')
  tmp.width = sw; tmp.height = sh
  const tctx = tmp.getContext('2d')!
  tctx.imageSmoothingEnabled = false
  tctx.drawImage(ctx.canvas, 0, 0, sw, sh)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, sw, sh, 0, 0, w, h)
  ctx.imageSmoothingEnabled = true
}

function convolve(ctx: CanvasRenderingContext2D, w: number, h: number, kernel: number[]) {
  const src = ctx.getImageData(0, 0, w, h)
  const out = ctx.createImageData(w, h)
  const s = src.data, o = out.data
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let v = 0, k = 0
        for (let ky = -1; ky <= 1; ky++)
          for (let kx = -1; kx <= 1; kx++)
            v += s[((y + ky) * w + (x + kx)) * 4 + c] * kernel[k++]
        o[(y * w + x) * 4 + c] = v
      }
      o[(y * w + x) * 4 + 3] = s[(y * w + x) * 4 + 3]
    }
  }
  ctx.putImageData(out, 0, 0)
}

/** Simple "LUT" as a duotone/teal-orange style curve remap — parameterized cinematic look. */
function lutTint(ctx: CanvasRenderingContext2D, w: number, h: number, e: Effect) {
  const [sr, sg, sb] = hexToRgb(String(e.params.shadows ?? '#123a52'))
  const [hr, hg, hb] = hexToRgb(String(e.params.highlights ?? '#ffb86b'))
  const mix = Number(e.params.amount ?? 0.35)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
    d[i] += (sr + (hr - sr) * lum - d[i]) * mix
    d[i + 1] += (sg + (hg - sg) * lum - d[i + 1]) * mix
    d[i + 2] += (sb + (hb - sb) * lum - d[i + 2]) * mix
  }
  ctx.putImageData(img, 0, 0)
}

function mulberry(seed: number) {
  let a = seed + 0x6d2b79f5
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const EFFECT_PRESETS: { label: string; make: () => Omit<Effect, 'id'> }[] = [
  { label: 'Brightness', make: () => ({ type: 'brightness', enabled: true, params: { amount: 1.15 } }) },
  { label: 'Contrast', make: () => ({ type: 'contrast', enabled: true, params: { amount: 1.2 } }) },
  { label: 'Saturation', make: () => ({ type: 'saturation', enabled: true, params: { amount: 1.3 } }) },
  { label: 'Hue rotate', make: () => ({ type: 'hue', enabled: true, params: { degrees: 30 } }) },
  { label: 'Blur', make: () => ({ type: 'blur', enabled: true, params: { px: 8 } }) },
  { label: 'B&W', make: () => ({ type: 'grayscale', enabled: true, params: { amount: 1 } }) },
  { label: 'Sepia', make: () => ({ type: 'sepia', enabled: true, params: { amount: 0.8 } }) },
  { label: 'Cinematic (teal/orange)', make: () => ({ type: 'lut', enabled: true, params: { amount: 0.4, shadows: '#123a52', highlights: '#ffb86b' } }) },
  { label: 'Vignette', make: () => ({ type: 'vignette', enabled: true, params: { amount: 0.6 } }) },
  { label: 'Green screen (chroma key)', make: () => ({ type: 'chromaKey', enabled: true, params: { keyColor: '#00ff00', tolerance: 0.35, softness: 0.1 } }) },
  { label: 'Glitch', make: () => ({ type: 'glitch', enabled: true, params: { amount: 1 } }) },
  { label: 'VHS', make: () => ({ type: 'vhs', enabled: true, params: {} }) },
  { label: 'Film grain', make: () => ({ type: 'filmGrain', enabled: true, params: { amount: 0.15 } }) },
  { label: 'Pixelate', make: () => ({ type: 'pixelate', enabled: true, params: { size: 16 } }) },
  { label: 'Sharpen', make: () => ({ type: 'sharpen', enabled: true, params: {} }) },
]
