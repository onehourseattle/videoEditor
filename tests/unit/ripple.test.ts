import { describe, expect, it } from 'vitest'
import { splitClipAt, rippleDeleteRange, rippleDeleteAllTracks, emptyProject, addClipToTrack } from '../../src/state/store'
import type { CaptionClip, Project, VideoClip } from '../../src/types/model'
import { defaultTextStyle, defaultTransform } from '../../src/types/model'

function video(start: number, duration: number, offset = 0, speed = 1): VideoClip {
  return {
    id: `v_${start}`, kind: 'video', assetId: 'a1', name: 'v', start, duration, offset, speed,
    volume: 1, muted: false, transform: defaultTransform(), effects: [],
    gain: [
      { t: 0, value: 1, easing: 'linear' },
      { t: duration / 2, value: 0.3, easing: 'linear' },
      { t: duration, value: 0.5, easing: 'linear' },
    ],
  }
}

function caption(start: number, duration: number): CaptionClip {
  return {
    id: `c_${start}`, kind: 'caption', name: 'c', start, duration,
    words: [
      { text: 'one', start: 0, end: 1 },
      { text: 'two', start: 1, end: 2 },
      { text: 'three', start: 2, end: 3 },
    ],
    style: defaultTextStyle(), animation: 'wordPop', wordsPerPage: 4,
    transform: defaultTransform(), effects: [],
  }
}

function projWith(...clips: Parameters<typeof addClipToTrack>[2][]): Project {
  let p = emptyProject()
  const videoTrack = p.tracks.find((t) => t.kind === 'video')!
  for (const c of clips) p = addClipToTrack(p, videoTrack.id, c)
  return p
}

describe('splitClipAt', () => {
  it('splits source offset by speed and divides gain keyframes', () => {
    const p = projWith(video(0, 4, 10, 2))
    const out = splitClipAt(p, 'v_0', 1)
    const clips = out.tracks.find((t) => t.kind === 'video')!.clips
    expect(clips).toHaveLength(2)
    expect(clips[0].duration).toBe(1)
    const right = clips[1] as VideoClip
    expect(right.start).toBe(1)
    expect(right.offset).toBe(12) // 10 + 1s * 2x
    // gain keyframes at t=2,4 shift into clip-relative time t=1,3
    expect(right.gain?.map((k) => k.t)).toEqual([1, 3])
  })

  it('splits caption words across the cut', () => {
    const p = projWith(caption(0, 3))
    const out = splitClipAt(p, 'c_0', 1.5)
    const clips = out.tracks.find((t) => t.kind === 'video')!.clips as CaptionClip[]
    expect(clips[0].words.map((w) => w.text)).toEqual(['one', 'two'])
    expect(clips[1].words.map((w) => w.text)).toEqual(['two', 'three'])
    expect(clips[1].words[1].start).toBeCloseTo(0.5) // 2 - 1.5
  })
})

describe('rippleDeleteRange', () => {
  it('closes the gap and re-times caption words in the right part', () => {
    const p = projWith(caption(0, 3))
    const out = rippleDeleteRange(p, p.tracks.find((t) => t.kind === 'video')!.id, 0.5, 1.5)
    const clips = out.tracks.find((t) => t.kind === 'video')!.clips as CaptionClip[]
    expect(clips).toHaveLength(2)
    // left keeps words starting before the cut; right shifts by 1.5
    expect(clips[0].words.map((w) => w.text)).toEqual(['one'])
    expect(clips[1].words.map((w) => w.text)).toEqual(['two', 'three'])
    expect(clips[1].words[0].end).toBeCloseTo(0.5) // 2 - 1.5
    expect(clips[1].start).toBeCloseTo(0.5)
  })

  it('shifts later clips left by the removed duration', () => {
    const p = projWith(video(0, 2), video(3, 2))
    const out = rippleDeleteRange(p, p.tracks.find((t) => t.kind === 'video')!.id, 2, 3)
    const clips = out.tracks.find((t) => t.kind === 'video')!.clips
    expect(clips[1].start).toBe(2)
  })
})

describe('rippleDeleteAllTracks', () => {
  it('ripples every track together', () => {
    let p = emptyProject()
    const vt = p.tracks.find((t) => t.kind === 'video')!
    const ot = p.tracks.find((t) => t.kind === 'overlay')!
    p = addClipToTrack(p, vt.id, video(0, 5))
    p = addClipToTrack(p, ot.id, caption(2, 3))
    const out = rippleDeleteAllTracks(p, 1, 2)
    const v = out.tracks.find((t) => t.id === vt.id)!.clips
    const c = out.tracks.find((t) => t.id === ot.id)!.clips
    expect(v.reduce((acc, cl) => Math.max(acc, cl.start + cl.duration), 0)).toBeCloseTo(4)
    expect(c[0].start).toBeCloseTo(1) // caption slid left with the cut
  })
})
