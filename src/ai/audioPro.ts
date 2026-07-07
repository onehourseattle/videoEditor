import type { AudioClip, Keyframe, Project, VideoClip } from '../types/model'
import { getMonoSamples, rmsWindows } from './audioAnalysis'
import { assetStore } from '../state/assetStore'

/**
 * Professional audio, all local DSP:
 *  - auto-ducking: music dips under speech
 *  - integrated loudness (simplified ITU-R BS.1770) + normalization gain
 *  - spectral-gate noise reduction
 */

// ─── auto-ducking ─────────────────────────────────────────────────────────────

export interface DuckOptions {
  /** gain while speech is present */
  duckTo: number
  attack: number
  release: number
}

export const DEFAULT_DUCK: DuckOptions = { duckTo: 0.25, attack: 0.15, release: 0.4 }

/**
 * Build a speech-activity timeline from every audible VIDEO clip (voice lives
 * in footage; music lives on audio tracks), then produce gain keyframes for a
 * music clip that duck it under the speech.
 */
export async function speechActivity(project: Project, windowSec = 0.1): Promise<{ t: number; active: boolean }[]> {
  const spans: { start: number; end: number; clip: VideoClip }[] = []
  for (const track of project.tracks) {
    if (track.muted) continue
    for (const clip of track.clips) {
      if (clip.kind === 'video' && !clip.muted && clip.volume > 0) {
        spans.push({ start: clip.start, end: clip.start + clip.duration, clip })
      }
    }
  }
  if (!spans.length) return []
  const end = Math.max(...spans.map((s) => s.end))
  const n = Math.ceil(end / windowSec)
  const active = new Array<boolean>(n).fill(false)

  for (const span of spans) {
    const audio = await getMonoSamples(span.clip.assetId)
    if (!audio) continue
    const rms = rmsWindows(audio.samples, audio.sampleRate, windowSec)
    const sorted = [...rms].sort((a, b) => a - b)
    const loud = sorted[Math.floor(sorted.length * 0.85)] || 0.01
    const threshold = Math.max(0.006, loud * 0.25)
    for (let i = 0; i < n; i++) {
      const t = i * windowSec
      if (t < span.start || t >= span.end) continue
      const srcT = span.clip.offset + (t - span.start) * span.clip.speed
      const idx = Math.floor(srcT / windowSec)
      if (rms[idx] !== undefined && rms[idx] > threshold) active[i] = true
    }
  }
  return active.map((a, i) => ({ t: i * windowSec, active: a }))
}

/** Gain keyframes (clip-relative) ducking `music` wherever speech is active. */
export function duckKeyframes(
  music: AudioClip,
  activity: { t: number; active: boolean }[],
  opts: DuckOptions = DEFAULT_DUCK,
): Keyframe[] {
  if (!activity.length) return []
  // collapse activity into speech segments overlapping the music clip
  const segs: { start: number; end: number }[] = []
  let cur: { start: number; end: number } | null = null
  for (const { t, active } of activity) {
    if (active) {
      if (!cur) cur = { start: t, end: t + 0.1 }
      else cur.end = t + 0.1
    } else if (cur) {
      segs.push(cur)
      cur = null
    }
  }
  if (cur) segs.push(cur)

  const clipEnd = music.start + music.duration
  const kfs: Keyframe[] = [{ t: 0, value: 1, easing: 'easeInOut' }]
  for (const seg of segs) {
    // merge segments separated by less than the release time
    const s = Math.max(music.start, seg.start - opts.attack)
    const e = Math.min(clipEnd, seg.end + opts.release)
    if (e <= music.start || s >= clipEnd) continue
    const sL = s - music.start
    const eL = e - music.start
    kfs.push({ t: Math.max(0, sL), value: 1, easing: 'easeInOut' })
    kfs.push({ t: Math.min(music.duration, sL + opts.attack), value: opts.duckTo, easing: 'easeInOut' })
    kfs.push({ t: Math.max(0, eL - opts.release), value: opts.duckTo, easing: 'easeInOut' })
    kfs.push({ t: Math.min(music.duration, eL), value: 1, easing: 'easeInOut' })
  }
  kfs.push({ t: music.duration, value: 1, easing: 'easeInOut' })
  // sort + dedupe + resolve overlaps by taking the minimum gain at each time
  const sorted = kfs.sort((a, b) => a.t - b.t)
  const out: Keyframe[] = []
  for (const k of sorted) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.t - k.t) < 0.02) prev.value = Math.min(prev.value, k.value)
    else out.push({ ...k })
  }
  return out.length > 2 ? out : []
}

// ─── loudness (simplified BS.1770) ───────────────────────────────────────────

/**
 * Integrated loudness in LUFS. Applies the K-weighting pre-filter (high shelf
 * + high-pass biquads at 48k coefficients scaled to the buffer rate is close
 * enough for normalization purposes), then mean-square over the whole mix
 * with a simple -70 LUFS absolute gate.
 */
export function measureLufs(buffer: AudioBuffer): number {
  const n = buffer.length
  let sum = 0
  let counted = 0
  const blockLen = Math.round(buffer.sampleRate * 0.4)
  for (let ch = 0; ch < Math.min(2, buffer.numberOfChannels); ch++) {
    const x = kWeight(buffer.getChannelData(ch), buffer.sampleRate)
    for (let b = 0; b + blockLen <= n; b += blockLen) {
      let ms = 0
      for (let i = 0; i < blockLen; i++) ms += x[b + i] * x[b + i]
      ms /= blockLen
      const lufs = -0.691 + 10 * Math.log10(ms + 1e-12)
      if (lufs > -70) {
        sum += ms
        counted++
      }
    }
  }
  if (!counted) return -70
  return -0.691 + 10 * Math.log10(sum / counted + 1e-12)
}

function kWeight(input: Float32Array, sampleRate: number): Float32Array {
  // stage 1: high shelf (+4 dB above ~1.5kHz), stage 2: high-pass ~38Hz.
  // Reference coefficients are for 48kHz; we re-derive approximately for other rates.
  const out1 = biquad(input, shelfCoeffs(sampleRate))
  return biquad(out1, highpassCoeffs(sampleRate))
}

function shelfCoeffs(fs: number) {
  const f0 = 1681.97, G = 3.9998, Q = 0.7072
  const K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667)
  const a0 = 1 + K / Q + K * K
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
}

function highpassCoeffs(fs: number) {
  const f0 = 38.135, Q = 0.5003
  const K = Math.tan((Math.PI * f0) / fs)
  const a0 = 1 + K / Q + K * K
  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
}

function biquad(x: Float32Array, c: { b0: number; b1: number; b2: number; a1: number; a2: number }): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

/** Gain (linear) to reach `target` LUFS, capped so peaks stay under -1 dBFS. */
export function normalizationGain(buffer: AudioBuffer, targetLufs = -14): { gain: number; measured: number } {
  const measured = measureLufs(buffer)
  let gain = Math.pow(10, (targetLufs - measured) / 20)
  let peak = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch)
    for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]))
  }
  const ceiling = Math.pow(10, -1 / 20) // -1 dBFS
  if (peak * gain > ceiling) gain = ceiling / (peak || 1)
  return { gain, measured }
}

export function applyGain(buffer: AudioBuffer, gain: number) {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch)
    for (let i = 0; i < d.length; i++) d[i] *= gain
  }
}

// ─── noise reduction (spectral gate) ─────────────────────────────────────────

import { fft, ifft, hannWindow } from './fftUtil'

/**
 * Spectral-gate noise reduction: learn the noise floor per frequency bin from
 * the quietest 10% of frames, then subtract it (with over-subtraction) from
 * every frame. STFT 1024 / hop 256, Hann analysis + overlap-add synthesis.
 * Returns a processed copy; the asset store keeps the original for undo.
 */
export async function denoiseAsset(assetId: string, strength = 1.0): Promise<AudioBuffer | null> {
  const probe = new OfflineAudioContext(1, 1, 16000)
  const original = await assetStore.getAudioBuffer(assetId, probe)
  if (!original) return null

  const frame = 1024
  const hop = 256
  const win = hannWindow(frame)
  const out = new OfflineAudioContext(
    original.numberOfChannels, original.length, original.sampleRate,
  ).createBuffer(original.numberOfChannels, original.length, original.sampleRate)

  for (let ch = 0; ch < original.numberOfChannels; ch++) {
    const x = original.getChannelData(ch)
    const nFrames = Math.max(1, Math.floor((x.length - frame) / hop))

    // pass 1: magnitude spectra + per-frame energy to find quiet frames
    const mags: Float32Array[] = []
    const energies: number[] = []
    const re = new Float32Array(frame)
    const im = new Float32Array(frame)
    for (let f = 0; f < nFrames; f++) {
      const base = f * hop
      for (let i = 0; i < frame; i++) { re[i] = (x[base + i] ?? 0) * win[i]; im[i] = 0 }
      fft(re, im)
      const mag = new Float32Array(frame / 2 + 1)
      let e = 0
      for (let i = 0; i <= frame / 2; i++) { mag[i] = Math.hypot(re[i], im[i]); e += mag[i] }
      mags.push(mag)
      energies.push(e)
    }
    const order = energies.map((e, i) => i).sort((a, b) => energies[a] - energies[b])
    const quiet = order.slice(0, Math.max(1, Math.floor(nFrames * 0.1)))
    const noise = new Float32Array(frame / 2 + 1)
    for (const qi of quiet) for (let i = 0; i < noise.length; i++) noise[i] += mags[qi][i]
    for (let i = 0; i < noise.length; i++) noise[i] = (noise[i] / quiet.length) * (1.5 * strength)

    // pass 2: subtract + resynthesize (overlap-add)
    const y = out.getChannelData(ch)
    const norm = new Float32Array(x.length)
    for (let f = 0; f < nFrames; f++) {
      const base = f * hop
      for (let i = 0; i < frame; i++) { re[i] = (x[base + i] ?? 0) * win[i]; im[i] = 0 }
      fft(re, im)
      for (let i = 0; i < frame; i++) {
        const bin = i <= frame / 2 ? i : frame - i
        const mag = Math.hypot(re[i], im[i])
        const scale = mag > 1e-9 ? Math.max(0, mag - noise[bin]) / mag : 0
        re[i] *= scale
        im[i] *= scale
      }
      ifft(re, im)
      for (let i = 0; i < frame && base + i < y.length; i++) {
        y[base + i] += re[i] * win[i]
        norm[base + i] += win[i] * win[i]
      }
    }
    for (let i = 0; i < y.length; i++) if (norm[i] > 1e-6) y[i] /= norm[i]
  }
  return out
}
