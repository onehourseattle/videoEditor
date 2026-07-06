import type { TransitionType } from '../types/model'
import { ease } from './keyframes'

/**
 * Transitions blend the outgoing clip (already on `ctx`) with the incoming
 * clip layer. `p` is 0→1 progress through the transition.
 * The compositor renders outgoing first, then calls this with the incoming layer.
 */
export function drawTransition(
  ctx: CanvasRenderingContext2D,
  incoming: CanvasImageSource,
  type: TransitionType,
  p: number,
  w: number,
  h: number,
) {
  const e = ease('easeInOut', p)
  ctx.save()
  switch (type) {
    case 'crossfade':
      ctx.globalAlpha = e
      ctx.drawImage(incoming, 0, 0, w, h)
      break
    case 'fadeToBlack': {
      // first half: fade out to black; second half: fade incoming in
      if (p < 0.5) {
        ctx.fillStyle = `rgba(0,0,0,${ease('easeIn', p * 2)})`
        ctx.fillRect(0, 0, w, h)
      } else {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = ease('easeOut', (p - 0.5) * 2)
        ctx.drawImage(incoming, 0, 0, w, h)
      }
      break
    }
    case 'slideLeft':
      ctx.drawImage(incoming, w * (1 - e), 0, w, h)
      break
    case 'slideRight':
      ctx.drawImage(incoming, -w * (1 - e), 0, w, h)
      break
    case 'slideUp':
      ctx.drawImage(incoming, 0, h * (1 - e), w, h)
      break
    case 'wipe': {
      ctx.beginPath()
      ctx.rect(0, 0, w * e, h)
      ctx.clip()
      ctx.drawImage(incoming, 0, 0, w, h)
      break
    }
    case 'zoomIn': {
      const s = 0.6 + 0.4 * e
      ctx.globalAlpha = e
      ctx.translate(w / 2, h / 2)
      ctx.scale(s, s)
      ctx.drawImage(incoming, -w / 2, -h / 2, w, h)
      break
    }
    case 'zoomOut': {
      const s = 1.6 - 0.6 * e
      ctx.globalAlpha = e
      ctx.translate(w / 2, h / 2)
      ctx.scale(s, s)
      ctx.drawImage(incoming, -w / 2, -h / 2, w, h)
      break
    }
    case 'blurThrough': {
      const blur = Math.sin(p * Math.PI) * 24
      ctx.filter = `blur(${blur.toFixed(1)}px)`
      ctx.globalAlpha = e
      ctx.drawImage(incoming, 0, 0, w, h)
      break
    }
    case 'glitch': {
      const slices = 8
      for (let i = 0; i < slices; i++) {
        const sy = (h / slices) * i
        const jitter = (Math.sin(i * 37.7 + p * 40) * (1 - p) * w) / 12
        if (Math.sin(i * 13 + p * 25) > 1 - 2 * p) {
          ctx.drawImage(incoming, 0, sy, w, h / slices, jitter, sy, w, h / slices)
        }
      }
      break
    }
    case 'spin': {
      ctx.globalAlpha = e
      ctx.translate(w / 2, h / 2)
      ctx.rotate((1 - e) * Math.PI * 0.5)
      const s = 0.7 + 0.3 * e
      ctx.scale(s, s)
      ctx.drawImage(incoming, -w / 2, -h / 2, w, h)
      break
    }
  }
  ctx.restore()
}

export const TRANSITION_TYPES: { type: TransitionType; label: string }[] = [
  { type: 'crossfade', label: 'Crossfade' },
  { type: 'fadeToBlack', label: 'Fade to black' },
  { type: 'slideLeft', label: 'Slide left' },
  { type: 'slideRight', label: 'Slide right' },
  { type: 'slideUp', label: 'Slide up' },
  { type: 'wipe', label: 'Wipe' },
  { type: 'zoomIn', label: 'Zoom in' },
  { type: 'zoomOut', label: 'Zoom out' },
  { type: 'blurThrough', label: 'Blur through' },
  { type: 'glitch', label: 'Glitch' },
  { type: 'spin', label: 'Spin' },
]
