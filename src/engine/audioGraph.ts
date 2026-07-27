import type { AudioClip, Project, VideoClip } from '../types/model'
import { assetStore } from '../state/assetStore'
import { sampleKeyframes } from './keyframes'
import { hasRamp, sourceTimeAt, speedSamples } from './speed'

type AudibleClip = (VideoClip | AudioClip) & { trackMuted: boolean }

function audibleClips(project: Project): AudibleClip[] {
  const out: AudibleClip[] = []
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if ((clip.kind === 'video' || clip.kind === 'audio') && !clip.muted && clip.volume > 0) {
        out.push({ ...clip, trackMuted: track.muted })
      }
    }
  }
  return out.filter((c) => !c.trackMuted)
}

/**
 * Schedule the project's audio into any AudioContext (realtime preview) or
 * OfflineAudioContext (export). `from` = timeline seconds to start at,
 * `when` = context time at which timeline `from` should sound.
 * Returns the created source nodes so the caller can stop them.
 */
export async function scheduleAudio(
  ctx: BaseAudioContext,
  destination: AudioNode,
  project: Project,
  from: number,
  when: number,
): Promise<AudioScheduledSourceNode[]> {
  const sources: AudioScheduledSourceNode[] = []
  for (const clip of audibleClips(project)) {
    const buffer = await assetStore.getAudioBuffer(clip.assetId, ctx)
    if (!buffer) continue

    const clipEnd = clip.start + clip.duration
    if (clipEnd <= from) continue

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = clip.speed

    const gain = ctx.createGain()
    gain.gain.value = clip.volume
    src.connect(gain)
    gain.connect(destination)

    // volume envelope (ducking, manual keyframes) — sampled onto the gain param
    if (clip.gain && clip.gain.length > 1) {
      const startCtx = when + Math.max(0, clip.start - from)
      const skip = Math.max(0, from - clip.start)
      const span = clip.duration - skip
      if (span > 0.05) {
        const steps = Math.min(512, Math.max(8, Math.ceil(span / 0.05)))
        const curve = new Float32Array(steps)
        for (let i = 0; i < steps; i++) {
          const local = skip + (i / (steps - 1)) * span
          curve[i] = Math.max(0.0001, clip.volume * sampleKeyframes(clip.gain, local))
        }
        gain.gain.setValueCurveAtTime(curve, startCtx, span)
      }
    } else if (clip.kind === 'audio') {
      // fades (audio clips only; envelope supersedes them)
      const startCtx = when + Math.max(0, clip.start - from)
      if (clip.fadeIn > 0) {
        gain.gain.setValueAtTime(0.0001, startCtx)
        gain.gain.linearRampToValueAtTime(clip.volume, startCtx + clip.fadeIn)
      }
      if (clip.fadeOut > 0) {
        const endCtx = when + (clipEnd - from)
        gain.gain.setValueAtTime(clip.volume, Math.max(startCtx, endCtx - clip.fadeOut))
        gain.gain.linearRampToValueAtTime(0.0001, endCtx)
      }
    }

    // where inside the source we need to start
    const skipIntoClip = Math.max(0, from - clip.start) // timeline seconds already elapsed
    const playSpan = clip.duration - skipIntoClip // timeline seconds still to play
    const sourceOffset = sourceTimeAt(clip, skipIntoClip)
    // source-domain seconds consumed: an integral once a ramp is involved
    const remaining = hasRamp(clip)
      ? sourceTimeAt(clip, clip.duration) - sourceOffset
      : playSpan * clip.speed
    if (remaining <= 0 || sourceOffset >= buffer.duration) continue

    const startAt = when + Math.max(0, clip.start - from)
    // a ramp automates playbackRate so pitch and timing track the curve
    if (hasRamp(clip) && playSpan > 0.05) {
      const samples = speedSamples(clip, skipIntoClip, clip.duration, 128)
      src.playbackRate.setValueCurveAtTime(samples, startAt, playSpan)
    }
    src.start(startAt, sourceOffset, Math.min(remaining, buffer.duration - sourceOffset))
    sources.push(src)
  }
  return sources
}
