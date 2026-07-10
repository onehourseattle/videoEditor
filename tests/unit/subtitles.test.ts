import { describe, expect, it } from 'vitest'
import { toSrt, parseSubtitles, cuesToCaptionClips } from '../../src/utils/subtitles'
import { emptyProject, addClipToTrack } from '../../src/state/store'

describe('subtitle round-trip', () => {
  it('emits carry-safe timestamps (never ms=1000)', () => {
    let p = emptyProject()
    const track = p.tracks.find((t) => t.kind === 'overlay')!
    const [clip] = cuesToCaptionClips([{ start: 0.9996, end: 2.9999, text: 'carry check words here' }])
    p = addClipToTrack(p, track.id, clip)
    const srt = toSrt(p)
    expect(/\d,\d{4}/.test(srt)).toBe(false)
    expect(srt).toContain('-->')
  })

  it('parses SRT and VTT, tolerating tags and CRLF', () => {
    const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\nhello <b>world</b>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nagain\r\n'
    const cues = parseSubtitles(srt)
    expect(cues).toHaveLength(2)
    expect(cues[0].text).toBe('hello world')
    expect(cues[0].start).toBeCloseTo(1.5)

    const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nvtt line\n'
    const cues2 = parseSubtitles(vtt)
    expect(cues2).toHaveLength(1)
    expect(cues2[0].end).toBeCloseTo(2)
  })

  it('cue → clip → SRT round-trips text', () => {
    let p = emptyProject()
    const track = p.tracks.find((t) => t.kind === 'overlay')!
    for (const clip of cuesToCaptionClips(parseSubtitles('1\n00:00:00,000 --> 00:00:02,000\nround trip works\n'))) {
      p = addClipToTrack(p, track.id, clip)
    }
    expect(toSrt(p)).toContain('round trip works')
  })
})
