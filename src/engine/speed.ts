import type { AudioClip, Keyframe, VideoClip } from '../types/model'
import { sampleKeyframes } from './keyframes'

/**
 * Speed ramping.
 *
 * A ramp is a curve of absolute speed multipliers with keyframe times
 * normalized to 0..1 across the clip, so trimming never invalidates it.
 * Because speed varies, the source time a clip is showing is the *integral*
 * of that curve rather than a multiplication:
 *
 *   sourceTime(local) = offset + duration · ∫[0 … local/duration] speed(u) du
 *
 * The integral is evaluated numerically once per distinct curve and cached —
 * it is sampled for every frame of preview and export, so it has to be cheap.
 */

export type Ramped = VideoClip | AudioClip

/** Resolution of the cumulative table. 512 steps is well under a frame of error. */
const STEPS = 512

interface Table {
  /** cumulative[i] = ∫[0..i/STEPS] speed(u) du, in normalized clip units */
  cumulative: Float64Array
  /** ∫[0..1] speed(u) du — the average speed over the clip */
  average: number
}

const cache = new Map<string, Table>()

function keyOf(curve: Keyframe[]): string {
  let k = ''
  for (const p of curve) k += `${p.t.toFixed(4)},${p.value.toFixed(4)},${p.easing};`
  return k
}

function tableFor(curve: Keyframe[]): Table {
  const key = keyOf(curve)
  const hit = cache.get(key)
  if (hit) return hit
  const cumulative = new Float64Array(STEPS + 1)
  let acc = 0
  let prev = clampSpeed(sampleKeyframes(curve, 0))
  for (let i = 1; i <= STEPS; i++) {
    const u = i / STEPS
    const s = clampSpeed(sampleKeyframes(curve, u))
    acc += ((prev + s) / 2) * (1 / STEPS) // trapezoid
    cumulative[i] = acc
    prev = s
  }
  const table: Table = { cumulative, average: acc }
  if (cache.size > 64) cache.clear() // bounded; curves change as the user drags
  cache.set(key, table)
  return table
}

function clampSpeed(v: number): number {
  if (!isFinite(v)) return 1
  return Math.min(10, Math.max(0.05, v))
}

export function hasRamp(clip: Ramped): boolean {
  return !!clip.speedCurve && clip.speedCurve.length > 1
}

/** Speed multiplier at a point in the clip (seconds from its start). */
export function speedAt(clip: Ramped, local: number): number {
  if (!hasRamp(clip)) return clip.speed
  const u = clip.duration > 0 ? Math.min(1, Math.max(0, local / clip.duration)) : 0
  return clampSpeed(sampleKeyframes(clip.speedCurve!, u))
}

/** Source-media time shown at `local` seconds into the clip. */
export function sourceTimeAt(clip: Ramped, local: number): number {
  if (!hasRamp(clip)) return clip.offset + local * clip.speed
  const d = clip.duration
  if (d <= 0) return clip.offset
  const u = Math.min(1, Math.max(0, local / d))
  const { cumulative } = tableFor(clip.speedCurve!)
  const x = u * STEPS
  const i = Math.min(STEPS - 1, Math.floor(x))
  const frac = x - i
  const integral = cumulative[i] + (cumulative[i + 1] - cumulative[i]) * frac
  return clip.offset + d * integral
}

/** Total source media consumed across the whole clip. */
export function sourceSpanOf(clip: Ramped): number {
  if (!hasRamp(clip)) return clip.duration * clip.speed
  return clip.duration * tableFor(clip.speedCurve!).average
}

/** Average speed over the clip — what the ramp reads as "overall". */
export function averageSpeed(clip: Ramped): number {
  return hasRamp(clip) ? tableFor(clip.speedCurve!).average : clip.speed
}

/** Sampled speed values for Web Audio's `playbackRate.setValueCurveAtTime`. */
export function speedSamples(clip: Ramped, fromLocal: number, toLocal: number, count = 128): Float32Array {
  const out = new Float32Array(Math.max(2, count))
  const span = toLocal - fromLocal
  for (let i = 0; i < out.length; i++) {
    out[i] = speedAt(clip, fromLocal + (i / (out.length - 1)) * span)
  }
  return out
}

// ─── presets ─────────────────────────────────────────────────────────────────

export interface RampPreset {
  name: string
  sub: string
  /** normalized curve, absolute speed multipliers */
  curve: Keyframe[]
}

const kf = (t: number, value: number, easing: Keyframe['easing'] = 'easeInOut'): Keyframe => ({ t, value, easing })

export const RAMP_PRESETS: RampPreset[] = [
  {
    name: 'Slow-mo dip',
    sub: 'normal → 0.25× → normal',
    curve: [kf(0, 1), kf(0.35, 0.25), kf(0.65, 0.25), kf(1, 1)],
  },
  {
    name: 'Speed up',
    sub: 'accelerate to 3×',
    curve: [kf(0, 1), kf(1, 3)],
  },
  {
    name: 'Slow down',
    sub: 'decelerate to 0.3×',
    curve: [kf(0, 1.6), kf(1, 0.3)],
  },
  {
    name: 'Jet cut',
    sub: '4× rush, then land',
    curve: [kf(0, 4), kf(0.6, 4), kf(0.85, 0.6), kf(1, 1)],
  },
  {
    name: 'Bullet time',
    sub: 'fast → freeze-ish → fast',
    curve: [kf(0, 2.5), kf(0.4, 0.1), kf(0.6, 0.1), kf(1, 2.5)],
  },
  {
    name: 'Montage pulse',
    sub: 'rhythmic in-and-out',
    curve: [kf(0, 1), kf(0.25, 2.2), kf(0.5, 1), kf(0.75, 2.2), kf(1, 1)],
  },
]

/**
 * Apply a ramp while keeping the same source material on screen: the clip's
 * timeline duration is rescaled so the integral still consumes exactly the
 * source range it consumed before.
 */
export function applyRamp<T extends Ramped>(clip: T, curve: Keyframe[]): T {
  const sourceSpan = sourceSpanOf(clip)
  const avg = tableFor(curve).average
  const duration = Math.max(0.05, sourceSpan / Math.max(avg, 0.0001))
  return { ...clip, speedCurve: curve.map((k) => ({ ...k })), duration }
}

/** Drop the ramp, collapsing to the constant speed it averaged. */
export function clearRamp<T extends Ramped>(clip: T): T {
  if (!hasRamp(clip)) return clip
  const avg = averageSpeed(clip)
  const next = { ...clip, speed: clampSpeed(avg) }
  delete (next as { speedCurve?: Keyframe[] }).speedCurve
  return next
}

/** Points used when resampling a sliced ramp — dense enough to keep the integral exact. */
const SLICE_POINTS = 33

/**
 * Re-normalize a ramp when a clip is cut, so each piece keeps the portion of
 * the curve it actually covers. `from`/`to` are fractions of the original.
 *
 * The slice is densely resampled with *linear* segments rather than carrying
 * the original keyframes across. Re-normalizing eased keyframes would restretch
 * the easing over a different span and quietly change the curve's shape — which
 * showed up as ~1.4% of source material vanishing across a split, so the two
 * halves no longer joined frame-accurately.
 */
export function sliceRamp(curve: Keyframe[], from: number, to: number): Keyframe[] | undefined {
  const span = to - from
  if (span <= 0.001) return undefined
  const out: Keyframe[] = []
  for (let i = 0; i < SLICE_POINTS; i++) {
    const u = i / (SLICE_POINTS - 1)
    out.push({ t: u, value: clampSpeed(sampleKeyframes(curve, from + u * span)), easing: 'linear' })
  }
  return out
}
