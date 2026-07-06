import type { CaptionClip, TextClip, TextStyle } from '../types/model'
import { ease } from './keyframes'

/**
 * Draws text and caption clips onto the compositor canvas.
 * All animation is a pure function of `t` (seconds since clip start), so
 * preview and export render identically.
 */

interface Line {
  words: { text: string; wordIndex: number }[]
}

function layoutLines(ctx: CanvasRenderingContext2D, words: string[], maxWidth: number): Line[] {
  const lines: Line[] = [{ words: [] }]
  let lineWidth = 0
  const spaceW = ctx.measureText(' ').width
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width
    if (lineWidth > 0 && lineWidth + spaceW + ww > maxWidth) {
      lines.push({ words: [] })
      lineWidth = 0
    }
    lines[lines.length - 1].words.push({ text: w, wordIndex: i })
    lineWidth += (lineWidth > 0 ? spaceW : 0) + ww
  })
  return lines
}

function applyFont(ctx: CanvasRenderingContext2D, s: TextStyle) {
  ctx.font = `${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`
  ctx.textBaseline = 'alphabetic'
}

export function drawTextClip(ctx: CanvasRenderingContext2D, clip: TextClip, t: number, w: number, h: number) {
  const raw = clip.style.uppercase ? clip.text.toUpperCase() : clip.text
  const words = raw.split(/\s+/).filter(Boolean)
  if (!words.length) return
  const progress = clip.animationDuration > 0 ? Math.min(1, t / clip.animationDuration) : 1
  drawStyledText(ctx, words, clip.style, w, h, {
    animation: clip.animation,
    progress,
    t,
    activeWord: -1,
    revealedWords: revealCount(clip.animation, words.length, progress),
  })
}

export function drawCaptionClip(ctx: CanvasRenderingContext2D, clip: CaptionClip, t: number, w: number, h: number) {
  if (!clip.words.length) return
  const perPage = Math.max(1, clip.wordsPerPage)
  // find the page containing time t
  let pageStart = 0
  while (pageStart < clip.words.length) {
    const page = clip.words.slice(pageStart, pageStart + perPage)
    const pageEnd = page[page.length - 1].end
    if (t <= pageEnd || pageStart + perPage >= clip.words.length) {
      if (t < page[0].start - 0.05) return
      const words = page.map((cw) => (clip.style.uppercase ? cw.text.toUpperCase() : cw.text))
      let active = -1
      for (let i = 0; i < page.length; i++) if (t >= page[i].start && t <= page[i].end) active = i
      if (active === -1 && t > pageEnd) active = page.length - 1
      const revealed =
        clip.animation === 'wordPop' || clip.animation === 'typewriter'
          ? page.filter((cw) => t >= cw.start).length
          : words.length
      // per-word pop progress: how far into the active word we are
      const popT = active >= 0 ? Math.min(1, (t - page[active].start) / 0.18) : 1
      drawStyledText(ctx, words, clip.style, w, h, {
        animation: clip.animation,
        progress: 1,
        t,
        activeWord: active,
        revealedWords: revealed,
        popT,
      })
      return
    }
    pageStart += perPage
  }
}

interface DrawOpts {
  animation: TextClip['animation']
  progress: number // clip-level entrance progress 0..1
  t: number
  activeWord: number // caption karaoke highlight, -1 = none
  revealedWords: number
  popT?: number
}

function revealCount(animation: TextClip['animation'], total: number, progress: number): number {
  if (animation === 'typewriter' || animation === 'waveIn' || animation === 'wordPop') {
    return Math.ceil(total * ease('easeOut', progress))
  }
  return total
}

function drawStyledText(
  ctx: CanvasRenderingContext2D,
  words: string[],
  s: TextStyle,
  w: number,
  h: number,
  opts: DrawOpts,
) {
  ctx.save()
  applyFont(ctx, s)
  const maxWidth = w * 0.86
  const lines = layoutLines(ctx, words, maxWidth)
  const lineH = s.fontSize * s.lineHeight
  const totalH = lines.length * lineH
  // Text/caption block is positioned via the clip transform; base anchor = center.
  let y = h / 2 - totalH / 2 + s.fontSize * 0.8

  // clip-level entrance transforms
  const p = ease('easeOut', opts.progress)
  if (opts.animation === 'fadeIn') ctx.globalAlpha *= p
  if (opts.animation === 'popIn') {
    ctx.translate(w / 2, h / 2)
    const sc = 0.5 + 0.5 * ease('spring', opts.progress)
    ctx.scale(sc, sc)
    ctx.translate(-w / 2, -h / 2)
    ctx.globalAlpha *= Math.min(1, opts.progress * 4)
  }
  if (opts.animation === 'slideUp') {
    ctx.translate(0, (1 - p) * s.fontSize * 1.5)
    ctx.globalAlpha *= p
  }
  if (opts.animation === 'bounceIn') {
    ctx.translate(0, (1 - ease('bounce', opts.progress)) * -s.fontSize * 2)
  }
  if (opts.animation === 'shake') {
    ctx.translate(Math.sin(opts.t * 50) * 4, Math.cos(opts.t * 47) * 3)
  }

  const spaceW = ctx.measureText(' ').width
  let wordIdx = 0
  for (const line of lines) {
    const lineWidth =
      line.words.reduce((acc, lw) => acc + ctx.measureText(lw.text).width, 0) + spaceW * (line.words.length - 1)
    let x = s.align === 'left' ? w * 0.07 : s.align === 'right' ? w * 0.93 - lineWidth : (w - lineWidth) / 2

    // background box per line
    if (s.backgroundColor) {
      ctx.save()
      ctx.fillStyle = s.backgroundColor
      roundRect(
        ctx,
        x - s.backgroundPadding,
        y - s.fontSize * 0.85 - s.backgroundPadding * 0.5,
        lineWidth + s.backgroundPadding * 2,
        s.fontSize * 1.1 + s.backgroundPadding,
        s.cornerRadius,
      )
      ctx.fill()
      ctx.restore()
    }

    for (const lw of line.words) {
      const isActive = lw.wordIndex === opts.activeWord
      const isRevealed = lw.wordIndex < opts.revealedWords
      const ww = ctx.measureText(lw.text).width

      if (!isRevealed && (opts.animation === 'typewriter' || opts.animation === 'wordPop' || opts.animation === 'waveIn')) {
        x += ww + spaceW
        wordIdx++
        continue
      }

      ctx.save()
      // per-word animation transforms
      if (opts.animation === 'wordPop' && isActive) {
        const pop = ease('spring', opts.popT ?? 1)
        ctx.translate(x + ww / 2, y - s.fontSize * 0.35)
        ctx.scale(0.85 + 0.25 * pop, 0.85 + 0.25 * pop)
        ctx.translate(-(x + ww / 2), -(y - s.fontSize * 0.35))
      }
      if (opts.animation === 'waveIn') {
        ctx.translate(0, Math.sin(opts.t * 6 + lw.wordIndex * 0.9) * s.fontSize * 0.06)
      }
      if (opts.animation === 'wordHighlight' && isActive) {
        ctx.fillStyle = s.highlightColor
        roundRect(ctx, x - 8, y - s.fontSize * 0.85, ww + 16, s.fontSize * 1.1, 10)
        ctx.fill()
      }

      // shadow
      if (s.shadowBlur > 0) {
        ctx.shadowColor = s.shadowColor
        ctx.shadowBlur = s.shadowBlur
        ctx.shadowOffsetY = s.shadowBlur / 4
      }
      // stroke
      if (s.strokeWidth > 0) {
        ctx.lineJoin = 'round'
        ctx.strokeStyle = s.strokeColor
        ctx.lineWidth = s.strokeWidth
        ctx.strokeText(lw.text, x, y)
      }
      // fill (gradient or flat, active word may recolor)
      if (s.gradient) {
        const g = ctx.createLinearGradient(0, y - s.fontSize, 0, y)
        g.addColorStop(0, s.gradient[0])
        g.addColorStop(1, s.gradient[1])
        ctx.fillStyle = g
      } else {
        ctx.fillStyle = opts.animation === 'wordPop' && isActive ? s.highlightColor : s.color
      }
      if (opts.animation === 'wordHighlight' && isActive) ctx.fillStyle = '#ffffff'
      ctx.fillText(lw.text, x, y)
      ctx.restore()

      x += ww + spaceW
      wordIdx++
    }
    y += lineH
  }
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export { roundRect }

// ─── CapCut-style text presets ───────────────────────────────────────────────

import { defaultTextStyle } from '../types/model'

export const TEXT_PRESETS: { label: string; style: Partial<TextStyle>; animation: TextClip['animation'] }[] = [
  { label: 'Bold pop', style: { fontWeight: 900, strokeWidth: 10, strokeColor: '#000' }, animation: 'popIn' },
  { label: 'Karaoke', style: { fontWeight: 800 }, animation: 'wordPop' },
  { label: 'Highlight box', style: { fontWeight: 800, highlightColor: '#6C5CE7' }, animation: 'wordHighlight' },
  { label: 'Typewriter', style: { fontFamily: 'ui-monospace, monospace', fontWeight: 600 }, animation: 'typewriter' },
  { label: 'Boxed', style: { backgroundColor: 'rgba(0,0,0,0.75)', fontWeight: 700 }, animation: 'fadeIn' },
  { label: 'Neon', style: { color: '#7efcf6', shadowColor: '#0affef', shadowBlur: 28, fontWeight: 800 }, animation: 'fadeIn' },
  { label: 'Gradient slide', style: { gradient: ['#ff8a5c', '#ff2d95'] as [string, string], fontWeight: 900 }, animation: 'slideUp' },
  { label: 'Wave', style: { fontWeight: 800 }, animation: 'waveIn' },
  { label: 'Bounce', style: { fontWeight: 900 }, animation: 'bounceIn' },
  { label: 'Shake (impact)', style: { fontWeight: 900, uppercase: true, strokeWidth: 8, strokeColor: '#000' }, animation: 'shake' },
]

export function makePresetStyle(partial: Partial<TextStyle>): TextStyle {
  return { ...defaultTextStyle(), ...partial }
}
