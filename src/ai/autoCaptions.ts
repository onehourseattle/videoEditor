import type { CaptionClip, CaptionWord, TextStyle, VideoClip } from '../types/model'
import { defaultTextStyle, defaultTransform } from '../types/model'
import { uid } from '../utils/id'
import type { TranscriptWord } from './transcribe'

/**
 * Turn a source-time transcript into caption clips aligned to a video clip on
 * the timeline (accounting for the clip's offset/speed), grouped into pages.
 */
export function captionsFromTranscript(
  words: TranscriptWord[],
  clip: VideoClip,
  style?: Partial<TextStyle>,
  wordsPerPage = 4,
): CaptionClip[] {
  // keep only words that fall inside the clip's used source range
  const srcStart = clip.offset
  const srcEnd = clip.offset + clip.duration * clip.speed
  const inRange = words.filter((w) => w.end > srcStart && w.start < srcEnd)
  if (!inRange.length) return []

  const toTimeline = (srcT: number) => clip.start + (srcT - clip.offset) / clip.speed

  // one caption clip per ~12 words keeps clips draggable without being confetti
  const clips: CaptionClip[] = []
  const perClip = wordsPerPage * 3
  for (let i = 0; i < inRange.length; i += perClip) {
    const group = inRange.slice(i, i + perClip)
    const start = Math.max(clip.start, toTimeline(group[0].start))
    const end = Math.min(clip.start + clip.duration, toTimeline(group[group.length - 1].end) + 0.25)
    if (end - start < 0.2) continue
    const captionWords: CaptionWord[] = group.map((w) => ({
      text: w.text,
      start: Math.max(0, toTimeline(w.start) - start),
      end: Math.max(0.05, toTimeline(w.end) - start),
    }))
    clips.push({
      id: uid('clip'),
      kind: 'caption',
      name: group.map((w) => w.text).join(' ').slice(0, 24),
      start,
      duration: end - start,
      words: captionWords,
      style: { ...defaultTextStyle(), fontSize: 64, ...style },
      animation: 'wordPop',
      wordsPerPage,
      transform: shiftedDown(),
      effects: [],
    })
  }
  return clips
}

/** Captions sit in the lower third by default. */
function shiftedDown() {
  const t = defaultTransform()
  t.y = [{ t: 0, value: 560, easing: 'linear' }]
  return t
}
