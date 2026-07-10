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
  // tracking: measureText honors this once set (Chrome 99+/Safari 17+)
  if ('letterSpacing' in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${s.letterSpacing || 0}px`
  }
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
    // at least one word from the very first frame — a blank pop-in reads as a glitch
    return Math.max(1, Math.ceil(total * ease('easeOut', progress)))
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
  // headline slant around the block center
  if (s.skewDeg) {
    ctx.translate(w / 2, h / 2)
    ctx.transform(1, 0, -Math.tan((s.skewDeg * Math.PI) / 180), 1, 0, 0)
    ctx.translate(-w / 2, -h / 2)
  }

  const spaceW = ctx.measureText(' ').width
  let wordIdx = 0
  let li = -1
  for (const line of lines) {
    li++
    const lineWidth =
      line.words.reduce((acc, lw) => acc + ctx.measureText(lw.text).width, 0) + spaceW * (line.words.length - 1)
    let x = s.align === 'left' ? w * 0.07 : s.align === 'right' ? w * 0.93 - lineWidth : (w - lineWidth) / 2

    // staggered line entrance (headlines)
    ctx.save()
    if (opts.animation === 'linesUp') {
      const lp = ease('easeOut', Math.min(1, Math.max(0, opts.progress * (lines.length + 1) - li)))
      ctx.translate(0, (1 - lp) * s.fontSize * 1.1)
      ctx.globalAlpha *= lp
    }
    const lineHollow = !!s.hollow || (!!s.alternateLines && li % 2 === 1)

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

      // poster echo: offset duplicate behind everything, no shadow
      if (s.echo) {
        ctx.save()
        ctx.shadowBlur = 0
        ctx.fillStyle = s.echo.color
        ctx.fillText(lw.text, x + s.echo.x, y + s.echo.y)
        ctx.restore()
      }
      // shadow
      if (s.shadowBlur > 0) {
        ctx.shadowColor = s.shadowColor
        ctx.shadowBlur = s.shadowBlur
        ctx.shadowOffsetY = s.shadowBlur / 4
      }
      // stroke (hollow letters stroke in the text color when no explicit stroke is set)
      const strokeW = lineHollow ? Math.max(s.strokeWidth, s.fontSize * 0.045) : s.strokeWidth
      if (strokeW > 0) {
        ctx.lineJoin = 'round'
        ctx.strokeStyle = lineHollow && s.strokeWidth === 0 ? s.color : s.strokeColor
        ctx.lineWidth = strokeW
        ctx.strokeText(lw.text, x, y)
      }
      // fill (gradient or flat; two-tone first word; active word may recolor)
      if (!lineHollow) {
        if (s.gradient) {
          const g = ctx.createLinearGradient(0, y - s.fontSize, 0, y)
          g.addColorStop(0, s.gradient[0])
          g.addColorStop(1, s.gradient[1])
          ctx.fillStyle = g
        } else {
          ctx.fillStyle = opts.animation === 'wordPop' && isActive ? s.highlightColor : s.color
        }
        if (s.firstWordColor && lw.wordIndex === 0) ctx.fillStyle = s.firstWordColor
        if (opts.animation === 'wordHighlight' && isActive) ctx.fillStyle = '#ffffff'
        ctx.fillText(lw.text, x, y)
      }
      ctx.restore()

      x += ww + spaceW
      wordIdx++
    }
    ctx.restore() // per-line (linesUp) transform
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

// ─── Headline typography presets — display-grade titles ────────────────────

export interface HeadlinePreset {
  label: string
  sample: string
  style: Partial<TextStyle>
  animation: TextClip['animation']
  /** CSS approximation for the gallery card */
  css: React.CSSProperties
}

// (react import only for the CSSProperties type above)
import type React from 'react'

export const HEADLINE_PRESETS: HeadlinePreset[] = [
  {
    label: 'Masthead',
    sample: 'THE DROP',
    style: {
      fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 110, uppercase: true,
      letterSpacing: 6, lineHeight: 1.05, shadowBlur: 18,
    },
    animation: 'linesUp',
    css: { fontFamily: 'Georgia, serif', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' },
  },
  {
    label: 'Poster echo',
    sample: 'BIG NEWS',
    style: {
      fontFamily: 'Impact, "Arial Black", sans-serif', fontWeight: 900, fontSize: 118, uppercase: true,
      color: '#ffffff', echo: { x: 10, y: 10, color: '#6C5CE7' }, shadowBlur: 0, letterSpacing: 2,
    },
    animation: 'popIn',
    css: { fontFamily: 'Impact, sans-serif', fontWeight: 900, textTransform: 'uppercase', textShadow: '3px 3px 0 #6C5CE7' },
  },
  {
    label: 'Hollow outline',
    sample: 'MINIMAL',
    style: {
      fontFamily: '"Avenir Next", Futura, sans-serif', fontWeight: 800, fontSize: 112, uppercase: true,
      hollow: true, letterSpacing: 8, shadowBlur: 0,
    },
    animation: 'fadeIn',
    css: { fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, WebkitTextStroke: '1.3px currentColor', color: 'transparent' },
  },
  {
    label: 'Two-tone split',
    sample: 'REAL results',
    style: {
      fontWeight: 900, fontSize: 100, firstWordColor: '#6C5CE7', shadowBlur: 10, lineHeight: 1.08,
    },
    animation: 'linesUp',
    css: { fontWeight: 900 },
  },
  {
    label: 'Slant impact',
    sample: 'FASTER',
    style: {
      fontFamily: 'Impact, "Arial Black", sans-serif', fontWeight: 900, fontSize: 116, uppercase: true,
      skewDeg: 12, strokeWidth: 8, strokeColor: '#000000', letterSpacing: 2,
    },
    animation: 'slideUp',
    css: { fontFamily: 'Impact, sans-serif', fontWeight: 900, textTransform: 'uppercase', fontStyle: 'italic' },
  },
  {
    label: 'Stacked alt',
    sample: 'NEW RULES',
    style: {
      fontFamily: 'Futura, "Avenir Next", sans-serif', fontWeight: 800, fontSize: 104, uppercase: true,
      alternateLines: true, letterSpacing: 4, lineHeight: 1.06, shadowBlur: 0,
    },
    animation: 'linesUp',
    css: { fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 },
  },
  {
    label: 'Typewriter serif',
    sample: 'chapter one',
    style: {
      fontFamily: '"American Typewriter", Georgia, serif', fontWeight: 600, fontSize: 88,
      letterSpacing: 3, backgroundColor: 'rgba(0,0,0,0.55)', backgroundPadding: 26, cornerRadius: 4,
    },
    animation: 'typewriter',
    css: { fontFamily: 'Georgia, serif', fontWeight: 600, letterSpacing: 1 },
  },
  {
    label: 'Gradient slab',
    sample: 'LEVEL UP',
    style: {
      fontFamily: '"Arial Black", Impact, sans-serif', fontWeight: 900, fontSize: 112, uppercase: true,
      gradient: ['#ffd76b', '#ff5c7a'] as [string, string], strokeWidth: 6, strokeColor: '#2a0f24',
      letterSpacing: 2, skewDeg: 4,
    },
    animation: 'popIn',
    css: {
      fontWeight: 900, textTransform: 'uppercase',
      background: 'linear-gradient(180deg,#ffd76b,#ff5c7a)', WebkitBackgroundClip: 'text', color: 'transparent',
    },
  },
]
