import type { Project, TextClip, ChartClip, StickerClip } from '../types/model'
import { defaultTextStyle, defaultTransform } from '../types/model'
import { emptyProject } from './store'
import { defaultChartSpec } from '../engine/chartRenderer'
import { uid } from '../utils/id'

/**
 * Built-in starting points — never a blank canvas. Each returns a fresh 9:16
 * project with overlays laid out; the user drops footage on the Video track.
 */

function text(t: string, start: number, duration: number, opts: Partial<TextClip> & { y?: number } = {}): TextClip {
  const transform = defaultTransform()
  if (opts.y !== undefined) transform.y = [{ t: 0, value: opts.y, easing: 'linear' }]
  return {
    id: uid('clip'), kind: 'text', name: t.slice(0, 20), start, duration, text: t,
    style: { ...defaultTextStyle(), ...(opts.style ?? {}) },
    animation: opts.animation ?? 'popIn', animationDuration: 0.4,
    transform, effects: [],
  }
}

export const BUILTIN_TEMPLATES: { name: string; sub: string; build: () => Project }[] = [
  {
    name: 'Hook → value → CTA',
    sub: 'the classic short structure',
    build: () => {
      const p = emptyProject()
      p.name = 'Hook → value → CTA'
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!
      overlay.clips.push(
        text('WAIT FOR IT…', 0, 2.2, { animation: 'shake', y: -520, style: { ...defaultTextStyle(), fontSize: 92, uppercase: true, strokeWidth: 10 } }),
        text('Drop your footage on the Video track ↓', 2.2, 8, { animation: 'fadeIn', y: 0, style: { ...defaultTextStyle(), fontSize: 48, backgroundColor: 'rgba(0,0,0,0.7)' } }),
        text('FOLLOW FOR MORE 🔥', 12, 3, { animation: 'popIn', y: 540, style: { ...defaultTextStyle(), fontSize: 66, strokeWidth: 8 } }),
      )
      const sticker: StickerClip = {
        id: uid('clip'), kind: 'sticker', name: '🔥', emoji: '🔥', start: 12, duration: 3,
        animation: 'pulse', transform: defaultTransform(), effects: [],
      }
      sticker.transform.x = [{ t: 0, value: 360, easing: 'linear' }]
      sticker.transform.y = [{ t: 0, value: 320, easing: 'linear' }]
      overlay.clips.push(sticker)
      return p
    },
  },
  {
    name: 'Podcast clip',
    sub: 'captions + progress bar',
    build: () => {
      const p = emptyProject()
      p.name = 'Podcast clip'
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!
      const progress: ChartClip = {
        id: uid('clip'), kind: 'chart', name: 'progress', start: 0, duration: 30,
        spec: { ...defaultChartSpec('progress'), title: '', backgroundColor: '', showValues: false },
        transform: defaultTransform(), effects: [],
      }
      progress.transform.y = [{ t: 0, value: -820, easing: 'linear' }]
      progress.transform.scale = [{ t: 0, value: 0.5, easing: 'linear' }]
      overlay.clips.push(
        progress,
        text('🎙 EPISODE 12', 0, 30, { animation: 'fadeIn', y: -700, style: { ...defaultTextStyle(), fontSize: 42, color: '#c9c9d6', shadowBlur: 6 } }),
        text('Generate captions in the 💬 tab', 1, 5, { animation: 'fadeIn', y: 560, style: { ...defaultTextStyle(), fontSize: 44, backgroundColor: 'rgba(0,0,0,0.7)' } }),
      )
      return p
    },
  },
  {
    name: 'Product promo',
    sub: 'title, price counter, arrow',
    build: () => {
      const p = emptyProject()
      p.name = 'Product promo'
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!
      const counter: ChartClip = {
        id: uid('clip'), kind: 'chart', name: 'price', start: 3, duration: 5,
        spec: {
          ...defaultChartSpec('counter'), title: 'ONLY', prefix: '$', suffix: '',
          data: [{ label: 'from', value: 99 }, { label: 'to', value: 39 }], animateIn: 'pop',
        },
        transform: defaultTransform(), effects: [],
      }
      counter.transform.y = [{ t: 0, value: 300, easing: 'linear' }]
      overlay.clips.push(
        text('THE UPGRADE YOU NEED', 0, 3, { animation: 'wordPop', y: -480, style: { ...defaultTextStyle(), fontSize: 78, uppercase: true, strokeWidth: 8 } }),
        counter,
        text('LINK IN BIO ↓', 8, 4, { animation: 'bounceIn', y: 520, style: { ...defaultTextStyle(), fontSize: 72, uppercase: true, gradient: ['#ff8a5c', '#ff2d95'] } }),
      )
      return p
    },
  },
]
