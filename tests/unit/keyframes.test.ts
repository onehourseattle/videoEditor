import { describe, expect, it } from 'vitest'
import { sampleKeyframes, setKeyframe, ease } from '../../src/engine/keyframes'

describe('keyframe sampling', () => {
  it('holds single keyframe value everywhere', () => {
    const kfs = [{ t: 0, value: 5, easing: 'linear' as const }]
    expect(sampleKeyframes(kfs, -1)).toBe(5)
    expect(sampleKeyframes(kfs, 100)).toBe(5)
  })

  it('interpolates linearly between keyframes', () => {
    const kfs = [
      { t: 0, value: 0, easing: 'linear' as const },
      { t: 2, value: 10, easing: 'linear' as const },
    ]
    expect(sampleKeyframes(kfs, 1)).toBeCloseTo(5)
    expect(sampleKeyframes(kfs, 3)).toBe(10) // clamps past the end
  })

  it('hold easing freezes the segment start value', () => {
    const kfs = [
      { t: 0, value: 1, easing: 'hold' as const },
      { t: 2, value: 9, easing: 'linear' as const },
    ]
    expect(sampleKeyframes(kfs, 1.99)).toBe(1)
  })

  it('setKeyframe keeps the track sorted and replaces near-duplicates', () => {
    let kfs = [{ t: 0, value: 0, easing: 'linear' as const }]
    kfs = setKeyframe(kfs, 2, 10)
    kfs = setKeyframe(kfs, 1, 5)
    kfs = setKeyframe(kfs, 2.001, 20) // within 1/120s of t=2 → replaces
    expect(kfs.map((k) => k.t)).toEqual([0, 1, 2.001])
    expect(kfs[2].value).toBe(20)
  })

  it('all easings map 0→0-ish and 1→1-ish', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce'] as const) {
      expect(ease(e, 0)).toBeCloseTo(0, 1)
      expect(ease(e, 1)).toBeCloseTo(1, 1)
    }
  })
})
