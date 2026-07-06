import type { Easing, Keyframe } from '../types/model'

const easings: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  spring: (t) => 1 - Math.exp(-6 * t) * Math.cos(12 * t),
  bounce: (t) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
  hold: () => 0,
}

export function ease(easing: Easing, t: number): number {
  return easings[easing](Math.min(1, Math.max(0, t)))
}

/** Sample a keyframe track at time t (seconds relative to clip start). */
export function sampleKeyframes(kfs: Keyframe[], t: number): number {
  if (kfs.length === 0) return 0
  if (kfs.length === 1 || t <= kfs[0].t) return kfs[0].value
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      const p = span <= 0 ? 1 : (t - a.t) / span
      return a.value + (b.value - a.value) * ease(a.easing, p)
    }
  }
  return kfs[kfs.length - 1].value
}

/** Insert or replace a keyframe at time t, keeping the track sorted. */
export function setKeyframe(kfs: Keyframe[], t: number, value: number, easing: Easing = 'easeInOut'): Keyframe[] {
  const out = kfs.filter((k) => Math.abs(k.t - t) > 1 / 120)
  out.push({ t, value, easing })
  out.sort((a, b) => a.t - b.t)
  return out
}
