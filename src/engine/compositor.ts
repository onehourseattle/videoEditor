import type { Clip, Project, StickerClip, Track, VideoClip } from '../types/model'
import { sampleKeyframes } from './keyframes'
import { filterString, hasPixelEffects, applyPixelEffects } from './effects'
import { drawTransition } from './transitions'
import { drawCaptionClip, drawTextClip } from './textRenderer'
import { drawChartClip } from './chartRenderer'
import { ease } from './keyframes'

/**
 * Renders the project at time `t` onto a canvas. Pure with respect to time —
 * the same (project, t, frames) always draws the same image, so the realtime
 * preview and the frame-exact exporter share this code path.
 *
 * Video pixels come from a FrameProvider: the preview hands over live <video>
 * elements; the exporter hands over precisely-seeked ones.
 */
export interface FrameProvider {
  getVideoFrame(clip: VideoClip, sourceTime: number): CanvasImageSource | null
  getImage(assetId: string): CanvasImageSource | null
}

const scratchPool: HTMLCanvasElement[] = []

function getScratch(w: number, h: number, i: number): HTMLCanvasElement {
  let c = scratchPool[i]
  if (!c) {
    c = document.createElement('canvas')
    scratchPool[i] = c
  }
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return c
}

export function clipSourceTime(clip: VideoClip, timelineTime: number): number {
  return clip.offset + (timelineTime - clip.start) * clip.speed
}

export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, frames: FrameProvider) {
  const { width: W, height: H } = project
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // Bottom-up: tracks array is top-first, so iterate in reverse. Audio never draws.
  let scratchIdx = 0
  for (let ti = project.tracks.length - 1; ti >= 0; ti--) {
    const track = project.tracks[ti]
    if (track.kind === 'audio' || track.hidden) continue

    const active = track.clips.find((c) => t >= c.start && t < c.start + c.duration)
    const { outgoing, transition, transP } = findTransition(track, t)

    if (outgoing && transition && active && outgoing.id !== active.id) {
      // outgoing clip frozen at its final frame as the base layer
      const outLayer = renderClipLayer(project, outgoing, outgoing.duration - 0.001 + outgoing.start, frames, getScratch(W, H, scratchIdx++), t)
      if (outLayer) ctx.drawImage(outLayer, 0, 0)
      const inLayer = renderClipLayer(project, active, t, frames, getScratch(W, H, scratchIdx++), t)
      if (inLayer) drawTransition(ctx, inLayer, transition.type, transP, W, H)
      continue
    }

    if (active) {
      const layer = renderClipLayer(project, active, t, frames, getScratch(W, H, scratchIdx++), t)
      if (layer) ctx.drawImage(layer, 0, 0)
    }
  }
}

function findTransition(track: Track, t: number): { outgoing: Clip | null; transition: Clip['transition']; transP: number } {
  for (let i = 0; i < track.clips.length - 1; i++) {
    const a = track.clips[i]
    const b = track.clips[i + 1]
    if (!a.transition) continue
    const boundaryOk = Math.abs(a.start + a.duration - b.start) < 0.05
    if (boundaryOk && t >= b.start && t < b.start + a.transition.duration) {
      return { outgoing: a, transition: a.transition, transP: (t - b.start) / a.transition.duration }
    }
  }
  return { outgoing: null, transition: undefined, transP: 0 }
}

/** Draw one clip (with transform + effects) onto its own full-size layer. */
function renderClipLayer(
  project: Project,
  clip: Clip,
  t: number,
  frames: FrameProvider,
  layer: HTMLCanvasElement,
  wallT: number,
): HTMLCanvasElement | null {
  const { width: W, height: H } = project
  const local = t - clip.start
  const ctx = layer.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)

  const x = sampleKeyframes(clip.transform.x, local)
  const y = sampleKeyframes(clip.transform.y, local)
  const scale = sampleKeyframes(clip.transform.scale, local)
  const rotation = sampleKeyframes(clip.transform.rotation, local)
  const opacity = sampleKeyframes(clip.transform.opacity, local)
  if (opacity <= 0 || scale === 0) return null

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(W / 2 + x, H / 2 + y)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(scale, scale)
  ctx.translate(-W / 2, -H / 2)
  ctx.filter = filterString(clip.effects)

  switch (clip.kind) {
    case 'video': {
      const frame = frames.getVideoFrame(clip, clipSourceTime(clip, t))
      if (frame) drawCover(ctx, frame, W, H)
      break
    }
    case 'image': {
      const img = frames.getImage(clip.assetId)
      if (img) drawCover(ctx, img, W, H)
      break
    }
    case 'text':
      drawTextClip(ctx, clip, local, W, H)
      break
    case 'caption':
      drawCaptionClip(ctx, clip, local, W, H)
      break
    case 'chart':
      drawChartClip(ctx, clip, local, W, H)
      break
    case 'sticker':
      drawSticker(ctx, clip, local, W, H)
      break
    case 'shape': {
      drawShape(ctx, clip, W, H)
      break
    }
    case 'audio':
      break
  }
  ctx.restore()

  if (hasPixelEffects(clip.effects)) applyPixelEffects(layer, clip.effects, wallT)
  return layer
}

/** Scale media to cover the project frame (social-video default), centered. */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, W: number, H: number) {
  const sw = (src as HTMLVideoElement).videoWidth ?? (src as HTMLImageElement).naturalWidth ?? (src as HTMLCanvasElement).width
  const sh = (src as HTMLVideoElement).videoHeight ?? (src as HTMLImageElement).naturalHeight ?? (src as HTMLCanvasElement).height
  if (!sw || !sh) return
  const s = Math.max(W / sw, H / sh)
  const dw = sw * s
  const dh = sh * s
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

function drawSticker(ctx: CanvasRenderingContext2D, clip: StickerClip, t: number, W: number, H: number) {
  const size = W * 0.28
  ctx.save()
  ctx.translate(W / 2, H / 2)
  switch (clip.animation) {
    case 'pulse': {
      const s = 1 + Math.sin(t * 4) * 0.08
      ctx.scale(s, s)
      break
    }
    case 'heartbeat': {
      const beat = t % 1
      const s = beat < 0.15 ? 1.18 : beat < 0.3 ? 1.08 : 1
      ctx.scale(s, s)
      break
    }
    case 'spin':
      ctx.rotate(t * 1.5)
      break
    case 'shake':
      ctx.translate(Math.sin(t * 40) * 6, 0)
      break
    case 'float':
      ctx.translate(0, Math.sin(t * 2) * size * 0.08)
      break
    case 'none':
      break
  }
  // entrance pop
  const inP = ease('spring', Math.min(1, t / 0.35))
  ctx.scale(inP, inP)
  ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(clip.emoji, 0, 0)
  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, clip: Extract<Clip, { kind: 'shape' }>, W: number, H: number) {
  const w = clip.width * W
  const h = clip.height * H
  const cx = W / 2
  const cy = H / 2
  ctx.save()
  ctx.fillStyle = clip.fill
  ctx.strokeStyle = clip.stroke
  ctx.lineWidth = clip.strokeWidth
  switch (clip.shape) {
    case 'rect':
      if (clip.fill !== 'transparent') ctx.fillRect(cx - w / 2, cy - h / 2, w, h)
      if (clip.strokeWidth > 0) ctx.strokeRect(cx - w / 2, cy - h / 2, w, h)
      break
    case 'circle':
      ctx.beginPath()
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (clip.fill !== 'transparent') ctx.fill()
      if (clip.strokeWidth > 0) ctx.stroke()
      break
    case 'line':
      ctx.beginPath()
      ctx.moveTo(cx - w / 2, cy)
      ctx.lineTo(cx + w / 2, cy)
      ctx.lineWidth = Math.max(clip.strokeWidth, 4)
      ctx.stroke()
      break
    case 'arrow': {
      const lw = Math.max(clip.strokeWidth, 6)
      ctx.lineWidth = lw
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx - w / 2, cy)
      ctx.lineTo(cx + w / 2 - lw * 2, cy)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx + w / 2, cy)
      ctx.lineTo(cx + w / 2 - lw * 3, cy - lw * 1.6)
      ctx.lineTo(cx + w / 2 - lw * 3, cy + lw * 1.6)
      ctx.closePath()
      ctx.fillStyle = clip.stroke
      ctx.fill()
      break
    }
  }
  ctx.restore()
}
