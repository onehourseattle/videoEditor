import type { Clip, Project, Track } from '../types/model'
import { defaultTextStyle, defaultTransform } from '../types/model'
import { defaultChartSpec } from '../engine/chartRenderer'
import { uid } from '../utils/id'

/**
 * Schema versioning + sanitizing migration. EVERY external project JSON
 * (autosave record, .cutroom.json file, .cutroompkg archive, template) passes
 * through here, so a malformed or older-version project can never crash the
 * editor — bad clips are repaired or dropped, never trusted.
 */
export const SCHEMA_VERSION = 2

const MAX_TIME = 24 * 3600 // clamp any time field to 24h — no Infinity escapes

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && isFinite(v) ? v : fallback
  return Math.min(max, Math.max(min, n))
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function keyframes(v: unknown, fallbackValue: number): { t: number; value: number; easing: 'linear' }[] {
  if (Array.isArray(v) && v.length) {
    const kfs = v
      .filter((k) => k && typeof k === 'object')
      .map((k) => ({
        t: num((k as { t: unknown }).t, 0, 0, MAX_TIME),
        value: num((k as { value: unknown }).value, fallbackValue, -1e6, 1e6),
        easing: (typeof (k as { easing: unknown }).easing === 'string' ? (k as { easing: string }).easing : 'linear') as 'linear',
      }))
      .sort((a, b) => a.t - b.t)
    if (kfs.length) return kfs
  }
  return [{ t: 0, value: fallbackValue, easing: 'linear' }]
}

const CLIP_KINDS = new Set(['video', 'image', 'audio', 'text', 'caption', 'chart', 'sticker', 'shape'])
const CHART_TYPES = new Set(['line', 'area', 'bar', 'barRace', 'counter', 'donut', 'progress', 'sparkline'])

function migrateClip(raw: unknown): Clip | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (!CLIP_KINDS.has(c.kind as string)) return null

  const base = {
    id: str(c.id, uid('clip')),
    start: num(c.start, 0, 0, MAX_TIME),
    duration: num(c.duration, 1, 0.05, MAX_TIME),
    name: str(c.name, String(c.kind)),
    transform: {
      x: keyframes((c.transform as Record<string, unknown> | undefined)?.x, 0),
      y: keyframes((c.transform as Record<string, unknown> | undefined)?.y, 0),
      scale: keyframes((c.transform as Record<string, unknown> | undefined)?.scale, 1),
      rotation: keyframes((c.transform as Record<string, unknown> | undefined)?.rotation, 0),
      opacity: keyframes((c.transform as Record<string, unknown> | undefined)?.opacity, 1),
    },
    effects: Array.isArray(c.effects)
      ? c.effects
          .filter((e) => e && typeof e === 'object' && typeof (e as { type: unknown }).type === 'string')
          .map((e) => ({
            id: str((e as Record<string, unknown>).id, uid('fx')),
            type: (e as { type: string }).type as Clip['effects'][number]['type'],
            enabled: (e as Record<string, unknown>).enabled !== false,
            params: typeof (e as Record<string, unknown>).params === 'object' && (e as Record<string, unknown>).params
              ? ((e as Record<string, unknown>).params as Record<string, number | string>)
              : {},
          }))
      : [],
    transition:
      c.transition && typeof c.transition === 'object' && typeof (c.transition as Record<string, unknown>).type === 'string'
        ? {
            type: (c.transition as { type: string }).type as NonNullable<Clip['transition']>['type'],
            duration: num((c.transition as Record<string, unknown>).duration, 0.5, 0.1, 5),
          }
        : undefined,
  }

  switch (c.kind) {
    case 'video':
    case 'audio': {
      if (typeof c.assetId !== 'string') return null
      const media = {
        ...base,
        assetId: c.assetId,
        offset: num(c.offset, 0, 0, MAX_TIME),
        speed: num(c.speed, 1, 0.1, 4),
        volume: num(c.volume, 1, 0, 2),
        muted: c.muted === true,
        gain: Array.isArray(c.gain) && c.gain.length > 1 ? keyframes(c.gain, 1) : undefined,
      }
      return c.kind === 'video'
        ? { ...media, kind: 'video' }
        : { ...media, kind: 'audio', fadeIn: num(c.fadeIn, 0, 0, 60), fadeOut: num(c.fadeOut, 0, 0, 60) }
    }
    case 'image':
      return typeof c.assetId === 'string' ? { ...base, kind: 'image', assetId: c.assetId } : null
    case 'text':
      return {
        ...base,
        kind: 'text',
        text: str(c.text, 'Text'),
        style: { ...defaultTextStyle(), ...(typeof c.style === 'object' && c.style ? c.style : {}) },
        animation: str(c.animation, 'none') as Extract<Clip, { kind: 'text' }>['animation'],
        animationDuration: num(c.animationDuration, 0.5, 0, 10),
        placement: c.placement === 'behind' ? 'behind' : undefined,
      }
    case 'caption':
      return {
        ...base,
        kind: 'caption',
        words: Array.isArray(c.words)
          ? c.words
              .filter((w) => w && typeof (w as { text: unknown }).text === 'string')
              .map((w) => ({
                text: (w as { text: string }).text,
                start: num((w as Record<string, unknown>).start, 0, 0, MAX_TIME),
                end: num((w as Record<string, unknown>).end, 0.1, 0, MAX_TIME),
              }))
          : [],
        style: { ...defaultTextStyle(), ...(typeof c.style === 'object' && c.style ? c.style : {}) },
        animation: str(c.animation, 'wordPop') as Extract<Clip, { kind: 'caption' }>['animation'],
        wordsPerPage: num(c.wordsPerPage, 4, 1, 12),
      }
    case 'chart': {
      const rawSpec = (typeof c.spec === 'object' && c.spec ? c.spec : {}) as Record<string, unknown>
      const type = CHART_TYPES.has(rawSpec.type as string) ? (rawSpec.type as Parameters<typeof defaultChartSpec>[0]) : 'line'
      const spec = { ...defaultChartSpec(type), ...rawSpec, type }
      spec.data = (Array.isArray(spec.data) ? (spec.data as unknown[]) : [])
        .filter((d) => d && typeof d === 'object')
        .map((d) => ({
          label: str((d as Record<string, unknown>).label, ''),
          value: num((d as Record<string, unknown>).value, 0, -1e12, 1e12),
        }))
      return { ...base, kind: 'chart', spec }
    }
    case 'sticker':
      return {
        ...base,
        kind: 'sticker',
        emoji: str(c.emoji, '⭐️'),
        animation: str(c.animation, 'pulse') as Extract<Clip, { kind: 'sticker' }>['animation'],
      }
    case 'shape':
      return {
        ...base,
        kind: 'shape',
        shape: (['rect', 'circle', 'arrow', 'line'].includes(c.shape as string) ? c.shape : 'rect') as Extract<Clip, { kind: 'shape' }>['shape'],
        fill: str(c.fill, 'rgba(108,92,231,0.85)'),
        stroke: str(c.stroke, '#ffffff'),
        strokeWidth: num(c.strokeWidth, 0, 0, 200),
        width: num(c.width, 0.4, 0.01, 4),
        height: num(c.height, 0.2, 0.01, 4),
      }
    default:
      return null
  }
}

/** Parse + repair any external project JSON. Throws only if it isn't a project at all. */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Not a CutRoom project')
  const p = raw as Record<string, unknown>
  if (!Array.isArray(p.tracks)) throw new Error('Not a CutRoom project (no tracks)')

  const tracks: Track[] = p.tracks
    .filter((t) => t && typeof t === 'object')
    .map((t) => {
      const tr = t as Record<string, unknown>
      const kind = (['video', 'audio', 'overlay'].includes(tr.kind as string) ? tr.kind : 'overlay') as Track['kind']
      return {
        id: str(tr.id, uid('track')),
        kind,
        name: str(tr.name, kind),
        muted: tr.muted === true,
        locked: tr.locked === true,
        hidden: tr.hidden === true,
        clips: (Array.isArray(tr.clips) ? tr.clips : [])
          .map(migrateClip)
          .filter((c): c is Clip => c !== null)
          .sort((a, b) => a.start - b.start),
      }
    })

  const assets: Project['assets'] = {}
  if (p.assets && typeof p.assets === 'object') {
    for (const [id, a] of Object.entries(p.assets as Record<string, unknown>)) {
      if (!a || typeof a !== 'object') continue
      const asset = a as Record<string, unknown>
      const type = (['video', 'audio', 'image'].includes(asset.type as string) ? asset.type : 'video') as 'video' | 'audio' | 'image'
      assets[id] = {
        id,
        name: str(asset.name, 'media'),
        type,
        duration: num(asset.duration, 0, 0, MAX_TIME),
        width: num(asset.width, 0, 0, 16384),
        height: num(asset.height, 0, 0, 16384),
        url: '', // session-scoped; always rehydrated from IndexedDB
        thumbnail: typeof asset.thumbnail === 'string' && asset.thumbnail.startsWith('data:') ? asset.thumbnail : undefined,
      }
    }
  }

  return {
    id: str(p.id, uid('proj')),
    name: str(p.name, 'Untitled project'),
    width: Math.round(num(p.width, 1080, 16, 8192)),
    height: Math.round(num(p.height, 1920, 16, 8192)),
    fps: Math.round(num(p.fps, 30, 1, 120)),
    schemaVersion: SCHEMA_VERSION,
    tracks: tracks.length ? tracks : [],
    assets,
  }
}
