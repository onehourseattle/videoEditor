import { getMonoSamples } from './audioAnalysis'
import { fft, hannWindow } from './fftUtil'

/**
 * Beat detection via spectral-flux onset strength + adaptive peak picking.
 * Pure DSP, runs locally in milliseconds. Returns beat times in source seconds.
 */
export async function detectBeats(assetId: string): Promise<number[]> {
  const audio = await getMonoSamples(assetId)
  if (!audio) return []
  const { samples, sampleRate } = audio

  const frame = 1024
  const hop = 512
  const nFrames = Math.floor((samples.length - frame) / hop)
  if (nFrames < 4) return []

  // magnitude spectrum per frame via a small radix-2 FFT
  const flux = new Float32Array(nFrames)
  let prevMag: Float32Array | null = null
  const re = new Float32Array(frame)
  const im = new Float32Array(frame)
  const window = hannWindow(frame)

  for (let f = 0; f < nFrames; f++) {
    const base = f * hop
    for (let i = 0; i < frame; i++) {
      re[i] = samples[base + i] * window[i]
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float32Array(frame / 2)
    for (let i = 0; i < frame / 2; i++) mag[i] = Math.hypot(re[i], im[i])
    if (prevMag) {
      let s = 0
      for (let i = 0; i < mag.length; i++) {
        const d = mag[i] - prevMag[i]
        if (d > 0) s += d // half-wave rectified flux
      }
      flux[f] = s
    }
    prevMag = mag
  }

  // adaptive threshold: local mean over ±0.5s
  const fps = sampleRate / hop
  const half = Math.round(fps * 0.5)
  const beats: number[] = []
  let lastBeat = -1
  const minGap = 0.22 // max ~270 BPM
  for (let f = 1; f < nFrames - 1; f++) {
    let mean = 0
    let n = 0
    for (let k = Math.max(0, f - half); k < Math.min(nFrames, f + half); k++) { mean += flux[k]; n++ }
    mean /= n || 1
    const isPeak = flux[f] > flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] > mean * 1.5
    const t = (f * hop) / sampleRate
    if (isPeak && t - lastBeat >= minGap) {
      beats.push(t)
      lastBeat = t
    }
  }
  return beats
}

/** Estimate BPM from detected beats via inter-onset-interval histogram. */
export function estimateBpm(beats: number[]): number | null {
  if (beats.length < 4) return null
  const intervals: number[] = []
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1])
  intervals.sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]
  if (!median) return null
  let bpm = 60 / median
  while (bpm > 200) bpm /= 2
  while (bpm < 60) bpm *= 2
  return Math.round(bpm)
}
