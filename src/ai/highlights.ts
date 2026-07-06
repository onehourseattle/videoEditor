import { getMonoSamples, rmsWindows, type TimeRange } from './audioAnalysis'

export interface Highlight extends TimeRange {
  score: number
}

/**
 * Find the most energetic moments (laughter, shouting, music drops, action).
 * Scores 1s windows by loudness + loudness *variance* (spiky beats flat), then
 * greedily picks non-overlapping segments of `segmentLen` seconds.
 */
export async function findHighlights(
  assetId: string,
  count = 3,
  segmentLen = 5,
): Promise<Highlight[]> {
  const audio = await getMonoSamples(assetId)
  if (!audio) return []
  const winSec = 0.25
  const rms = rmsWindows(audio.samples, audio.sampleRate, winSec)
  const perSeg = Math.max(1, Math.round(segmentLen / winSec))
  if (rms.length < perSeg) return []

  const scores: Highlight[] = []
  for (let i = 0; i + perSeg <= rms.length; i += Math.max(1, Math.floor(perSeg / 4))) {
    let mean = 0
    for (let j = 0; j < perSeg; j++) mean += rms[i + j]
    mean /= perSeg
    let variance = 0
    for (let j = 0; j < perSeg; j++) variance += (rms[i + j] - mean) ** 2
    variance /= perSeg
    scores.push({
      start: i * winSec,
      end: (i + perSeg) * winSec,
      score: mean + Math.sqrt(variance) * 2,
    })
  }

  scores.sort((a, b) => b.score - a.score)
  const picked: Highlight[] = []
  for (const s of scores) {
    if (picked.length >= count) break
    if (picked.every((p) => s.end <= p.start || s.start >= p.end)) picked.push(s)
  }
  return picked.sort((a, b) => a.start - b.start)
}
