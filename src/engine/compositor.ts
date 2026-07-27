import type { Clip, Project, StickerClip, Track, VideoClip } from '../types/model'
import { sampleKeyframes } from './keyframes'
import { filterString, hasPixelEffects, applyPixelEffects } from './effects'
import { applyPixelEffectsGPU } from './glEffects'
import { drawTransition } from './transitions'
import { drawCaptionClip, drawTextClip } from './textRenderer'
import { drawChartClip } from './chartRenderer'
import { ease } from './keyframes'
import { ensureSegmenter, getPersonMatte } from '../ai/segmentation'
import { sourceTimeAt } from './speed'

/**
 * Renders the project at time `t` onto a canvas. Pure with respect to time —
 * the same (project, t, frames) always draws the same image, so the realtime
 * preview and the frame-exact exporter share this code path.
 *
 * All layout happens in PROJECT coordinates; `scale` maps them to device
 * pixels. The preview passes its display scale (rendering only the pixels it
 * shows), the exporter passes outputSize/projectSize (letterboxed via ox/oy
 * when aspect differs) — so text, charts, and keyframes lay out identically
 * at every output resolution.
 *
 * Video pixels come from a FrameProvider: the preview hands over live <video>
 * elements; the exporter hands over precisely-decoded frames.
 */
export interface FrameProvider {
  getVideoFrame(clip: VideoClip, sourceTime: number): CanvasImageSource | null
  getImage(assetId: string): CanvasImageSource | null
}

/** Canvas that works on the main thread or inside a Worker. */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

export function createCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return new OffscreenCanvas(w, h)
}

const scratchPool: AnyCanvas[] = []

function getScratch(w: number, h: number, i: number): AnyCanvas {
  let c = scratchPool[i]
  if (!c) {
    c = createCanvas(w, h)
    scratchPool[i] = c
  }
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return c
}

export function clipSourceTime(clip: VideoClip, timelineTime: number): number {
  // speed ramps make this an integral, not a multiplication
  return sourceTimeAt(clip, timelineTime - clip.start)
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  frames: FrameProvider,
  scale = 1,
  ox = 0,
  oy = 0,
) {
  const { width: W, height: H } = project
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(scale, 0, 0, scale, ox, oy)

  // "Text behind person": when a behind-placed text clip is active, render in
  // phases — base footage, behind-text, person cutout of the footage, then
  // the remaining overlays. Otherwise use the normal single pass.
  const behindActive = project.tracks.some((tr) =>
    !tr.hidden && tr.clips.some(
      (c) => c.kind === 'text' && c.placement === 'behind' && t >= c.start && t < c.start + c.duration,
    ),
  )

  const counter = { i: 0 }
  if (!behindActive) {
    renderTracksPass(ctx, project, t, frames, scale, counter, () => true)
  } else {
    ensureSegmenter()
    const isBase = (c: Clip) => c.kind === 'video' || c.kind === 'image'
    const isBehindText = (c: Clip) => c.kind === 'text' && c.placement === 'behind'
    renderTracksPass(ctx, project, t, frames, scale, counter, isBase)
    renderTracksPass(ctx, project, t, frames, scale, counter, isBehindText)
    drawPersonMatte(ctx, project, t, frames, scale, counter)
    renderTracksPass(ctx, project, t, frames, scale, counter, (c) => !isBase(c) && !isBehindText(c))
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function renderTracksPass(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  frames: FrameProvider,
  scale: number,
  counter: { i: number },
  include: (c: Clip) => boolean,
) {
  const { width: W, height: H } = project
  // Bottom-up: tracks array is top-first, so iterate in reverse. Audio never draws.
  // ALL clips active at t on a track render, stacked in start order (later on
  // top) — overlapping overlays coexist rather than eclipsing each other.
  for (let ti = project.tracks.length - 1; ti >= 0; ti--) {
    const track = project.tracks[ti]
    if (track.kind === 'audio' || track.hidden) continue

    const actives = track.clips.filter((c) => t >= c.start && t < c.start + c.duration && include(c))
    const trans = findTransition(track, t)
    const useTrans = trans && include(trans.incoming) && include(trans.outgoing)

    if (trans && useTrans) {
      // outgoing clip frozen at its final frame as the base layer
      const outLayer = renderClipLayer(project, trans.outgoing, trans.outgoing.start + trans.outgoing.duration - 0.001, frames, getScratch(sw(W, scale), sw(H, scale), counter.i++), t, scale)
      if (outLayer) ctx.drawImage(outLayer, 0, 0, W, H)
      const inLayer = renderClipLayer(project, trans.incoming, t, frames, getScratch(sw(W, scale), sw(H, scale), counter.i++), t, scale)
      if (inLayer) drawTransition(ctx, inLayer, trans.transition.type, trans.transP, W, H)
    }

    for (const clip of actives) {
      if (trans && useTrans && clip.id === trans.incoming.id) continue // already drawn via the transition
      const layer = renderClipLayer(project, clip, t, frames, getScratch(sw(W, scale), sw(H, scale), counter.i++), t, scale)
      if (layer) ctx.drawImage(layer, 0, 0, W, H)
    }
  }
}

/** Re-draw the person from the topmost active video clip over the behind-text. */
function drawPersonMatte(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  frames: FrameProvider,
  scale: number,
  counter: { i: number },
) {
  const { width: W, height: H } = project
  // topmost active video clip (tracks are top-first)
  let vc: VideoClip | null = null
  for (const track of project.tracks) {
    if (track.hidden) continue
    for (let i = track.clips.length - 1; i >= 0; i--) {
      const c = track.clips[i]
      if (c.kind === 'video' && t >= c.start && t < c.start + c.duration) { vc = c; break }
    }
    if (vc) break
  }
  if (!vc) return
  const frame = frames.getVideoFrame(vc, clipSourceTime(vc, t))
  if (!frame) return
  const fw = (frame as HTMLVideoElement).videoWidth ?? (frame as HTMLCanvasElement).width
  const fh = (frame as HTMLVideoElement).videoHeight ?? (frame as HTMLCanvasElement).height
  const matte = getPersonMatte(frame, fw, fh)
  if (!matte) return

  // mirror the video clip's transform + filters so the cutout sits exactly on itself
  const local = t - vc.start
  const layer = getScratch(sw(W, scale), sw(H, scale), counter.i++)
  const lctx = layer.getContext('2d') as CanvasRenderingContext2D
  lctx.setTransform(1, 0, 0, 1, 0, 0)
  lctx.clearRect(0, 0, layer.width, layer.height)
  lctx.setTransform(scale, 0, 0, scale, 0, 0)
  const x = sampleKeyframes(vc.transform.x, local)
  const y = sampleKeyframes(vc.transform.y, local)
  const scl = sampleKeyframes(vc.transform.scale, local)
  const rotation = sampleKeyframes(vc.transform.rotation, local)
  const opacity = sampleKeyframes(vc.transform.opacity, local)
  if (opacity <= 0 || scl === 0) return
  lctx.save()
  lctx.globalAlpha = opacity
  lctx.translate(W / 2 + x, H / 2 + y)
  lctx.rotate((rotation * Math.PI) / 180)
  lctx.scale(scl, scl)
  lctx.translate(-W / 2, -H / 2)
  lctx.filter = filterString(vc.effects)
  drawCover(lctx, matte, W, H)
  lctx.restore()
  ctx.drawImage(layer, 0, 0, W, H)
}

function sw(v: number, scale: number): number {
  return Math.max(1, Math.round(v * scale))
}

function findTransition(
  track: Track,
  t: number,
): { outgoing: Clip; incoming: Clip; transition: NonNullable<Clip['transition']>; transP: number } | null {
  for (let i = 0; i < track.clips.length - 1; i++) {
    const a = track.clips[i]
    const b = track.clips[i + 1]
    if (!a.transition) continue
    const boundaryOk = Math.abs(a.start + a.duration - b.start) < 0.05
    if (boundaryOk && t >= b.start && t < b.start + a.transition.duration) {
      return { outgoing: a, incoming: b, transition: a.transition, transP: (t - b.start) / a.transition.duration }
    }
  }
  return null
}

/** Draw one clip (with transform + effects) onto its own layer (device px = project px × scale). */
function renderClipLayer(
  project: Project,
  clip: Clip,
  t: number,
  frames: FrameProvider,
  layer: AnyCanvas,
  wallT: number,
  scale: number,
): CanvasImageSource | null {
  const { width: W, height: H } = project
  const local = t - clip.start
  const ctx = layer.getContext('2d') as CanvasRenderingContext2D
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, layer.width, layer.height)
  ctx.setTransform(scale, 0, 0, scale, 0, 0)

  const x = sampleKeyframes(clip.transform.x, local)
  const y = sampleKeyframes(clip.transform.y, local)
  const scl = sampleKeyframes(clip.transform.scale, local)
  const rotation = sampleKeyframes(clip.transform.rotation, local)
  const opacity = sampleKeyframes(clip.transform.opacity, local)
  if (opacity <= 0 || scl === 0) return null

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.translate(W / 2 + x, H / 2 + y)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(scl, scl)
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

  if (hasPixelEffects(clip.effects)) {
    // GPU chain covers every per-pixel effect; CPU stays authoritative fallback
    const gpu = applyPixelEffectsGPU(layer, clip.effects, wallT)
    if (gpu) return gpu
    applyPixelEffects(layer, clip.effects, wallT)
  }
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
