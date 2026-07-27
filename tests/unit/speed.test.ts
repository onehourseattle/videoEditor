import { describe, it, expect } from 'vitest'
import type { VideoClip } from '../../src/types/model'
import { defaultTransform } from '../../src/types/model'
import {
  sourceTimeAt, sourceSpanOf, averageSpeed, hasRamp, applyRamp, clearRamp, sliceRamp, speedAt,
  RAMP_PRESETS,
} from '../../src/engine/speed'

function clip(over: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'c1', kind: 'video', assetId: 'a1', name: 'clip',
    start: 0, duration: 10, offset: 2, speed: 1, volume: 1, muted: false,
    transform: defaultTransform(), effects: [],
    ...over,
  }
}

const kf = (t: number, value: number) => ({ t, value, easing: 'linear' as const })

describe('speed without a ramp', () => {
  it('maps source time linearly', () => {
    const c = clip({ speed: 2, offset: 3 })
    expect(sourceTimeAt(c, 0)).toBe(3)
    expect(sourceTimeAt(c, 5)).toBe(13)
    expect(sourceSpanOf(c)).toBe(20)
    expect(hasRamp(c)).toBe(false)
  })
})

describe('speed ramps', () => {
  it('a constant curve matches the equivalent scalar speed', () => {
    const c = clip({ speedCurve: [kf(0, 2), kf(1, 2)], offset: 3 })
    expect(sourceTimeAt(c, 0)).toBeCloseTo(3, 5)
    expect(sourceTimeAt(c, 5)).toBeCloseTo(13, 2)
    expect(sourceSpanOf(c)).toBeCloseTo(20, 2)
    expect(averageSpeed(c)).toBeCloseTo(2, 3)
  })

  it('integrates a linear ramp (0→2 averages 1)', () => {
    const c = clip({ speedCurve: [kf(0, 0.05), kf(1, 2)], offset: 0, duration: 10 })
    // ∫ of a line from ~0 to 2 over the clip ≈ mean 1.025 × 10
    expect(averageSpeed(c)).toBeCloseTo(1.025, 2)
    expect(sourceSpanOf(c)).toBeCloseTo(10.25, 1)
    // half way through, only a quarter of the source has been consumed
    expect(sourceTimeAt(c, 5)).toBeLessThan(sourceSpanOf(c) / 2)
  })

  it('source time is strictly increasing (never rewinds mid-clip)', () => {
    for (const preset of RAMP_PRESETS) {
      const c = applyRamp(clip(), preset.curve)
      let prev = -Infinity
      for (let i = 0; i <= 100; i++) {
        const st = sourceTimeAt(c, (i / 100) * c.duration)
        expect(st).toBeGreaterThan(prev)
        prev = st
      }
    }
  })

  it('clamps absurd speeds instead of producing NaN', () => {
    const c = clip({ speedCurve: [kf(0, 0), kf(1, 1e6)] })
    expect(Number.isFinite(sourceTimeAt(c, 5))).toBe(true)
    expect(speedAt(c, 0)).toBeGreaterThanOrEqual(0.05)
    expect(speedAt(c, c.duration)).toBeLessThanOrEqual(10)
  })
})

describe('applying and clearing ramps', () => {
  it('preserves the source range it was showing', () => {
    const before = clip({ speed: 1, duration: 10, offset: 2 })
    const spanBefore = sourceSpanOf(before)
    for (const preset of RAMP_PRESETS) {
      const after = applyRamp(before, preset.curve)
      expect(sourceSpanOf(after)).toBeCloseTo(spanBefore, 1)
      expect(after.duration).toBeGreaterThan(0)
    }
  })

  it('clearing collapses to the average speed and drops the curve', () => {
    const ramped = applyRamp(clip(), RAMP_PRESETS[0].curve)
    const cleared = clearRamp(ramped)
    expect(cleared.speedCurve).toBeUndefined()
    expect(cleared.speed).toBeCloseTo(averageSpeed(ramped), 2)
  })
})

describe('slicing ramps at a cut', () => {
  it('the two halves together cover the original curve', () => {
    const curve = RAMP_PRESETS[0].curve
    const left = sliceRamp(curve, 0, 0.5)!
    const right = sliceRamp(curve, 0.5, 1)!
    // the halves meet at the cut with the same instantaneous speed
    expect(left[left.length - 1].value).toBeCloseTo(right[0].value, 4)
    // and match the original at their outer edges
    expect(left[0].value).toBeCloseTo(curve[0].value, 4)
    expect(right[right.length - 1].value).toBeCloseTo(curve[curve.length - 1].value, 4)
  })

  it('a degenerate slice returns nothing rather than a broken curve', () => {
    expect(sliceRamp(RAMP_PRESETS[0].curve, 0.5, 0.5)).toBeUndefined()
  })

  it('splitting a ramped clip preserves total source consumed', () => {
    const whole = applyRamp(clip({ duration: 10, offset: 0 }), RAMP_PRESETS[5].curve)
    const cut = 0.4
    const local = cut * whole.duration
    const left = { ...whole, duration: local, speedCurve: sliceRamp(whole.speedCurve!, 0, cut) }
    const right = {
      ...whole,
      duration: whole.duration - local,
      offset: sourceTimeAt(whole, local),
      speedCurve: sliceRamp(whole.speedCurve!, cut, 1),
    }
    expect(sourceSpanOf(left) + sourceSpanOf(right)).toBeCloseTo(sourceSpanOf(whole), 1)
    // and the right half starts exactly where the left one ended
    expect(right.offset).toBeCloseTo(whole.offset + sourceSpanOf(left), 1)
  })
})
