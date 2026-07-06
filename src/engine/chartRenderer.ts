import type { ChartClip, ChartSpec } from '../types/model'
import { ease } from './keyframes'
import { roundRect } from './textRenderer'

/**
 * Animated chart overlays for social video (likes/follower growth, bar races,
 * counters). Drawn on canvas as a pure function of `t`, so preview == export.
 *
 * Palette: validated categorical slots (dark-surface steps — overlays usually
 * sit on video, which reads as a dark/busy surface; every mark also carries a
 * soft shadow + labels so identity never rides on color alone).
 */
export const CHART_PALETTE = [
  '#3987e5', // blue
  '#199e70', // aqua
  '#c98500', // yellow
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
  '#d55181', // magenta
  '#d95926', // orange
] as const

const INK = '#ffffff'
const INK_MUTED = 'rgba(255,255,255,0.72)'
const GRID = 'rgba(255,255,255,0.16)'

export function drawChartClip(ctx: CanvasRenderingContext2D, clip: ChartClip, t: number, W: number, H: number) {
  const spec = clip.spec
  // entrance progress: charts animate in over the first ~40% of the clip (capped at 1.6s)
  const inDur = spec.animateIn === 'none' ? 0.0001 : Math.min(1.6, clip.duration * 0.4)
  const p = ease('easeOut', Math.min(1, t / inDur))

  // chart box: centered card occupying ~80% width; positioned via clip transform
  const cw = W * 0.8
  const ch = spec.type === 'counter' || spec.type === 'progress' ? W * 0.32 : cw * 0.72
  const cx = (W - cw) / 2
  const cy = (H - ch) / 2

  ctx.save()
  if (spec.backgroundColor) {
    ctx.fillStyle = spec.backgroundColor
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 30
    roundRect(ctx, cx, cy, cw, ch, 28)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  const pad = cw * 0.08
  const inner = { x: cx + pad, y: cy + pad, w: cw - pad * 2, h: ch - pad * 2 }

  // title
  if (spec.title) {
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(cw * 0.055)}px ${spec.fontFamily}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 8
    ctx.fillText(spec.title, inner.x, inner.y)
    ctx.shadowBlur = 0
    inner.y += cw * 0.09
    inner.h -= cw * 0.09
  }

  switch (spec.type) {
    case 'line':
    case 'area':
    case 'sparkline':
      drawLine(ctx, spec, inner, p, spec.type)
      break
    case 'bar':
      drawBars(ctx, spec, inner, p)
      break
    case 'barRace':
      drawBarRace(ctx, spec, inner, t, clip.duration)
      break
    case 'counter':
      drawCounter(ctx, spec, inner, p)
      break
    case 'donut':
      drawDonut(ctx, spec, inner, p)
      break
    case 'progress':
      drawProgress(ctx, spec, inner, p)
      break
  }
  ctx.restore()
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return Math.round(v).toLocaleString()
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  r: { x: number; y: number; w: number; h: number },
  p: number,
  variant: 'line' | 'area' | 'sparkline',
) {
  const data = spec.data
  if (data.length < 2) return
  const max = Math.max(...data.map((d) => d.value), 1)
  const min = Math.min(...data.map((d) => d.value), 0)
  const plotH = r.h - (variant === 'sparkline' ? 0 : r.w * 0.06)
  const px = (i: number) => r.x + (i / (data.length - 1)) * r.w
  const py = (v: number) => r.y + plotH - ((v - min) / (max - min || 1)) * plotH

  // hairline grid (skip for sparkline)
  if (variant !== 'sparkline') {
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1
    for (let g = 0; g <= 3; g++) {
      const gy = r.y + (plotH / 3) * g
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke()
    }
  }

  // 'draw' animation: reveal along x
  const revealed = spec.animateIn === 'draw' ? p : 1
  const lastIdx = Math.max(1, Math.min(data.length - 1, revealed * (data.length - 1)))

  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y - r.w * 0.1, r.w * (spec.animateIn === 'draw' ? revealed : 1) + 2, plotH + r.w * 0.2)
  ctx.clip()

  // area fill
  if (variant === 'area' || variant === 'sparkline') {
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + plotH)
    g.addColorStop(0, spec.color + 'aa')
    g.addColorStop(1, spec.color + '00')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(px(0), py(data[0].value))
    for (let i = 1; i < data.length; i++) ctx.lineTo(px(i), py(data[i].value))
    ctx.lineTo(px(data.length - 1), r.y + plotH)
    ctx.lineTo(px(0), r.y + plotH)
    ctx.closePath()
    ctx.fill()
  }

  // line
  ctx.strokeStyle = spec.color
  ctx.lineWidth = Math.max(3, r.w * 0.008)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 6
  ctx.beginPath()
  ctx.moveTo(px(0), py(data[0].value))
  for (let i = 1; i < data.length; i++) ctx.lineTo(px(i), py(data[i].value))
  ctx.stroke()
  ctx.restore()

  // leading dot + value label at reveal point
  const i0 = Math.floor(lastIdx)
  const frac = lastIdx - i0
  const i1 = Math.min(data.length - 1, i0 + 1)
  const vx = px(i0) + (px(i1) - px(i0)) * frac
  const vv = data[i0].value + (data[i1].value - data[i0].value) * frac
  const vy = py(vv)
  ctx.fillStyle = spec.accentColor || spec.color
  ctx.beginPath()
  ctx.arc(vx, vy, Math.max(6, r.w * 0.014), 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.stroke()
  if (spec.showValues) {
    ctx.fillStyle = INK
    ctx.font = `800 ${Math.round(r.w * 0.06)}px ${spec.fontFamily}`
    ctx.textAlign = vx > r.x + r.w * 0.75 ? 'right' : 'left'
    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 8
    ctx.fillText(spec.prefix + fmt(vv) + spec.suffix, vx + (vx > r.x + r.w * 0.75 ? -14 : 14), vy - 10)
    ctx.shadowBlur = 0
  }

  // x labels (first/last only — recessive)
  if (variant !== 'sparkline') {
    ctx.fillStyle = INK_MUTED
    ctx.font = `500 ${Math.round(r.w * 0.035)}px ${spec.fontFamily}`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(data[0].label, r.x, r.y + plotH + 8)
    ctx.textAlign = 'right'
    ctx.fillText(data[data.length - 1].label, r.x + r.w, r.y + plotH + 8)
  }
}

function drawBars(ctx: CanvasRenderingContext2D, spec: ChartSpec, r: { x: number; y: number; w: number; h: number }, p: number) {
  const data = spec.data
  if (!data.length) return
  const max = Math.max(...data.map((d) => d.value), 1)
  const labelH = r.w * 0.06
  const plotH = r.h - labelH
  const gap = Math.max(2, r.w * 0.02) // 2px+ surface gap between fills
  const bw = (r.w - gap * (data.length - 1)) / data.length

  data.forEach((d, i) => {
    // 'rise' staggers bars; 'pop' scales them in
    const stagger = spec.animateIn === 'rise' ? Math.min(1, Math.max(0, p * data.length - i * 0.6)) : p
    const bp = ease('easeOut', stagger)
    const bh = (d.value / max) * plotH * (spec.animateIn === 'none' ? 1 : bp)
    const x = r.x + i * (bw + gap)
    const y = r.y + plotH - bh
    ctx.fillStyle = spec.color
    roundRect(ctx, x, y, bw, Math.max(bh, 2), Math.min(8, bw / 3)) // rounded data-end
    ctx.fill()
    // value label on top (selective: only if few bars or showValues)
    if (spec.showValues && data.length <= 8) {
      ctx.fillStyle = INK
      ctx.font = `700 ${Math.round(r.w * 0.038)}px ${spec.fontFamily}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.shadowColor = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur = 6
      ctx.fillText(spec.prefix + fmt(d.value * bp) + spec.suffix, x + bw / 2, y - 6)
      ctx.shadowBlur = 0
    }
    ctx.fillStyle = INK_MUTED
    ctx.font = `500 ${Math.round(r.w * 0.032)}px ${spec.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(d.label, x + bw / 2, r.y + plotH + 8)
  })
}

function drawBarRace(ctx: CanvasRenderingContext2D, spec: ChartSpec, r: { x: number; y: number; w: number; h: number }, t: number, duration: number) {
  // Bars grow over the clip duration and re-rank live; each entity keeps its color slot.
  const data = spec.data
  if (!data.length) return
  const p = ease('easeInOut', Math.min(1, t / Math.max(0.001, duration * 0.85)))
  const rows = Math.min(data.length, 6)
  const rowH = r.h / rows
  const barH = rowH * 0.62

  // grow each value with a per-entity curve so ranks swap during the race
  const grown = data.map((d, i) => ({
    ...d,
    slot: i, // color follows the entity, not its rank
    current: d.value * ease('easeInOut', Math.min(1, p * (1.1 + 0.35 * Math.sin(i * 2.1)))),
  }))
  const ranked = [...grown].sort((a, b) => b.current - a.current).slice(0, rows)
  const max = Math.max(...ranked.map((d) => d.current), 1)

  ranked.forEach((d, rank) => {
    const y = r.y + rank * rowH
    const bw = Math.max(4, (d.current / max) * (r.w * 0.78))
    ctx.fillStyle = CHART_PALETTE[d.slot % CHART_PALETTE.length]
    roundRect(ctx, r.x, y + (rowH - barH) / 2, bw, barH, 8)
    ctx.fill()
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(barH * 0.5)}px ${spec.fontFamily}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 5
    ctx.fillText(d.label, r.x + 12, y + rowH / 2)
    ctx.textAlign = 'left'
    ctx.fillStyle = INK_MUTED
    ctx.font = `600 ${Math.round(barH * 0.42)}px ${spec.fontFamily}`
    ctx.fillText(spec.prefix + fmt(d.current) + spec.suffix, r.x + bw + 12, y + rowH / 2)
    ctx.shadowBlur = 0
  })
}

function drawCounter(ctx: CanvasRenderingContext2D, spec: ChartSpec, r: { x: number; y: number; w: number; h: number }, p: number) {
  // hero number: counts from first data value (or 0) to last
  const from = spec.data.length > 1 ? spec.data[0].value : 0
  const to = spec.data.length ? spec.data[spec.data.length - 1].value : 0
  const v = from + (to - from) * ease('easeOut', p)
  const pop = spec.animateIn === 'pop' ? 0.9 + 0.1 * ease('spring', p) : 1

  ctx.save()
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
  ctx.scale(pop, pop)
  ctx.fillStyle = spec.color
  ctx.font = `800 ${Math.round(r.w * 0.17)}px ${spec.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 12
  ctx.fillText(spec.prefix + fmt(v) + spec.suffix, 0, spec.title ? r.w * 0.01 : 0)
  ctx.restore()
}

function drawDonut(ctx: CanvasRenderingContext2D, spec: ChartSpec, r: { x: number; y: number; w: number; h: number }, p: number) {
  const data = spec.data.slice(0, 8)
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  const cx = r.x + r.h * 0.5
  const cy = r.y + r.h / 2
  const rad = r.h * 0.42
  const thick = rad * 0.38
  let angle = -Math.PI / 2
  const sweepTotal = Math.PI * 2 * ease('easeInOut', p)
  let used = 0

  data.forEach((d, i) => {
    const frac = d.value / total
    const sweep = Math.max(0, Math.min(frac * Math.PI * 2, sweepTotal - used))
    if (sweep > 0.004) {
      ctx.strokeStyle = CHART_PALETTE[i % CHART_PALETTE.length]
      ctx.lineWidth = thick
      ctx.lineCap = 'butt'
      ctx.beginPath()
      // 2px-equivalent gap between segments
      ctx.arc(cx, cy, rad, angle + 0.02, angle + sweep - 0.02)
      ctx.stroke()
    }
    angle += frac * Math.PI * 2
    used += frac * Math.PI * 2
  })

  // direct labels (legend substitute — identity never rides on color alone)
  ctx.font = `600 ${Math.round(r.w * 0.038)}px ${spec.fontFamily}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const lx = r.x + r.h + r.w * 0.06
  data.forEach((d, i) => {
    const ly = cy - ((data.length - 1) / 2) * (r.w * 0.055) + i * (r.w * 0.055)
    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length]
    ctx.beginPath()
    ctx.arc(lx, ly, r.w * 0.012, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = INK
    ctx.fillText(`${d.label}  ${Math.round((d.value / total) * 100)}%`, lx + r.w * 0.03, ly)
  })
}

function drawProgress(ctx: CanvasRenderingContext2D, spec: ChartSpec, r: { x: number; y: number; w: number; h: number }, p: number) {
  const target = spec.data.length ? spec.data[spec.data.length - 1].value : 100
  const maxV = Math.max(...spec.data.map((d) => d.value), target, 1)
  const frac = ease('easeInOut', p) * (target / maxV)
  const barH = Math.max(14, r.h * 0.22)
  const y = r.y + r.h / 2 - barH / 2

  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  roundRect(ctx, r.x, y, r.w, barH, barH / 2)
  ctx.fill()
  ctx.fillStyle = spec.color
  roundRect(ctx, r.x, y, Math.max(barH, r.w * frac), barH, barH / 2)
  ctx.fill()
  if (spec.showValues) {
    ctx.fillStyle = INK
    ctx.font = `800 ${Math.round(r.w * 0.06)}px ${spec.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 8
    ctx.fillText(spec.prefix + fmt(target * ease('easeInOut', p)) + spec.suffix, r.x + r.w / 2, y - 10)
    ctx.shadowBlur = 0
  }
}

// ─── Presets for the Charts panel ────────────────────────────────────────────

export function defaultChartSpec(type: ChartSpec['type']): ChartSpec {
  const base: ChartSpec = {
    type,
    title: '',
    data: [],
    color: CHART_PALETTE[0],
    accentColor: CHART_PALETTE[5],
    backgroundColor: 'rgba(10,10,14,0.55)',
    showValues: true,
    prefix: '',
    suffix: '',
    animateIn: 'draw',
    fontFamily: 'Inter, -apple-system, sans-serif',
  }
  switch (type) {
    case 'line':
    case 'area':
      return {
        ...base,
        title: 'Followers',
        animateIn: 'draw',
        data: [
          { label: 'Mon', value: 1200 }, { label: 'Tue', value: 1850 }, { label: 'Wed', value: 1700 },
          { label: 'Thu', value: 2600 }, { label: 'Fri', value: 4100 }, { label: 'Sat', value: 6900 },
          { label: 'Sun', value: 9800 },
        ],
      }
    case 'sparkline':
      return { ...base, backgroundColor: '', animateIn: 'draw', data: defaultChartSpec('line').data }
    case 'bar':
      return {
        ...base,
        title: 'Views by platform',
        animateIn: 'rise',
        data: [
          { label: 'TikTok', value: 48200 }, { label: 'Reels', value: 31500 },
          { label: 'Shorts', value: 27400 }, { label: 'X', value: 9100 },
        ],
      }
    case 'barRace':
      return {
        ...base,
        title: 'Top creators',
        animateIn: 'rise',
        data: [
          { label: '@alex', value: 92000 }, { label: '@sam', value: 79000 }, { label: '@jo', value: 65000 },
          { label: '@kai', value: 58000 }, { label: '@max', value: 41000 },
        ],
      }
    case 'counter':
      return {
        ...base,
        title: 'Likes',
        animateIn: 'pop',
        prefix: '',
        suffix: ' ❤️',
        data: [{ label: 'from', value: 0 }, { label: 'to', value: 128000 }],
      }
    case 'donut':
      return {
        ...base,
        title: 'Audience',
        animateIn: 'draw',
        data: [
          { label: '18–24', value: 44 }, { label: '25–34', value: 31 },
          { label: '35–44', value: 15 }, { label: '45+', value: 10 },
        ],
      }
    case 'progress':
      return {
        ...base,
        title: 'Goal: 100K subs',
        animateIn: 'draw',
        suffix: '',
        data: [{ label: 'goal', value: 100000 }, { label: 'now', value: 84000 }],
      }
  }
}
