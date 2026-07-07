import type { CaptionClip, Project } from '../types/model'
import { defaultTextStyle, defaultTransform } from '../types/model'
import { uid } from '../utils/id'

/** SRT / WebVTT round-trip for caption clips — repurposing and accessibility. */

interface Cue {
  start: number
  end: number
  text: string
}

function pad(n: number, len = 2): string {
  return Math.floor(n).toString().padStart(len, '0')
}

function stamp(t: number, msSep: ',' | '.'): string {
  // round to total ms FIRST so 0.9996s carries into the seconds field
  const total = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const ms = total % 1000
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${pad(ms, 3)}`
}

/** Caption clips → cue list (one cue per on-screen page). */
export function projectCues(project: Project): Cue[] {
  const cues: Cue[] = []
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== 'caption' || !clip.words.length) continue
      const per = Math.max(1, clip.wordsPerPage)
      for (let i = 0; i < clip.words.length; i += per) {
        const page = clip.words.slice(i, i + per)
        cues.push({
          start: clip.start + page[0].start,
          end: clip.start + page[page.length - 1].end,
          text: page.map((w) => w.text).join(' '),
        })
      }
    }
  }
  return cues.sort((a, b) => a.start - b.start)
}

export function toSrt(project: Project): string {
  return projectCues(project)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n')
}

export function toVtt(project: Project): string {
  return (
    'WEBVTT\n\n' +
    projectCues(project)
      .map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`)
      .join('\n')
  )
}

function parseStamp(s: string): number | null {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/)
  if (!m) return null
  const [, h, min, sec, ms] = m
  return (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec)) + Number(ms.padEnd(3, '0').slice(0, 3)) / 1000
}

/** Parse SRT or WebVTT text into cues (tolerant of both formats). */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/^WEBVTT.*?\n\n/s, '').replace(/\r/g, '').split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    const timeIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeIdx === -1) continue
    const [from, to] = lines[timeIdx].split('-->')
    const start = parseStamp(from)
    const end = parseStamp(to)
    if (start === null || end === null || end <= start) continue
    const cueText = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (cueText) cues.push({ start, end, text: cueText })
  }
  return cues
}

/** Cues → caption clips (words evenly timed within each cue). */
export function cuesToCaptionClips(cues: Cue[]): CaptionClip[] {
  return cues.map((cue) => {
    const words = cue.text.split(/\s+/).filter(Boolean)
    const per = (cue.end - cue.start) / Math.max(1, words.length)
    const transform = defaultTransform()
    transform.y = [{ t: 0, value: 560, easing: 'linear' }]
    return {
      id: uid('clip'),
      kind: 'caption',
      name: cue.text.slice(0, 24),
      start: cue.start,
      duration: cue.end - cue.start,
      words: words.map((text, i) => ({ text, start: i * per, end: (i + 1) * per })),
      style: { ...defaultTextStyle(), fontSize: 64 },
      animation: 'wordPop',
      wordsPerPage: Math.min(words.length, 5),
      transform,
      effects: [],
    }
  })
}

export function downloadText(filename: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
