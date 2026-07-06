import { assetStore } from '../state/assetStore'

/** Shared audio decode → mono Float32 samples for DSP features. */
export async function getMonoSamples(assetId: string): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const buffer = await assetStore.getAudioBuffer(assetId, ctx)
  if (!buffer) return null
  const mono = new Float32Array(buffer.length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch)
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels
  }
  return { samples: mono, sampleRate: buffer.sampleRate }
}

/** RMS energy per window (windowSec), returned as one value per window. */
export function rmsWindows(samples: Float32Array, sampleRate: number, windowSec = 0.05): Float32Array {
  const win = Math.max(1, Math.floor(sampleRate * windowSec))
  const n = Math.floor(samples.length / win)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * win
    for (let j = 0; j < win; j++) sum += samples[base + j] * samples[base + j]
    out[i] = Math.sqrt(sum / win)
  }
  return out
}

export interface TimeRange {
  start: number
  end: number
}

/** Merge ranges that are closer than `gap` seconds and drop ones shorter than `minLen`. */
export function cleanRanges(ranges: TimeRange[], gap: number, minLen: number): TimeRange[] {
  if (!ranges.length) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: TimeRange[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start - last.end <= gap) last.end = Math.max(last.end, sorted[i].end)
    else merged.push({ ...sorted[i] })
  }
  return merged.filter((r) => r.end - r.start >= minLen)
}
