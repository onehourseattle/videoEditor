import { getMonoSamples, rmsWindows, cleanRanges, type TimeRange } from './audioAnalysis'

export interface SilenceOptions {
  /** relative threshold: fraction of the clip's median speech level (0..1) */
  threshold: number
  /** minimum silence length worth cutting, seconds */
  minSilence: number
  /** breathing room kept on each side of a cut, seconds */
  padding: number
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = { threshold: 0.18, minSilence: 0.45, padding: 0.12 }

/**
 * Detect silences in an asset's audio. Threshold adapts to the recording:
 * it's a fraction of the 80th-percentile loudness, so quiet recordings work
 * without manual tuning. Returns ranges in SOURCE time.
 */
export async function detectSilences(assetId: string, opts: SilenceOptions = DEFAULT_SILENCE_OPTIONS): Promise<TimeRange[]> {
  const audio = await getMonoSamples(assetId)
  if (!audio) return []
  const windowSec = 0.03
  const rms = rmsWindows(audio.samples, audio.sampleRate, windowSec)
  if (!rms.length) return []

  const sorted = [...rms].sort((a, b) => a - b)
  const loud = sorted[Math.floor(sorted.length * 0.8)] || 0.01
  const cut = Math.max(0.004, loud * opts.threshold)

  const ranges: TimeRange[] = []
  let silentFrom = -1
  for (let i = 0; i < rms.length; i++) {
    const t = i * windowSec
    if (rms[i] < cut) {
      if (silentFrom < 0) silentFrom = t
    } else if (silentFrom >= 0) {
      ranges.push({ start: silentFrom, end: t })
      silentFrom = -1
    }
  }
  if (silentFrom >= 0) ranges.push({ start: silentFrom, end: rms.length * windowSec })

  return cleanRanges(ranges, 0.1, opts.minSilence).map((r) => ({
    start: r.start + opts.padding,
    end: Math.max(r.start + opts.padding, r.end - opts.padding),
  })).filter((r) => r.end - r.start >= opts.minSilence * 0.5)
}
