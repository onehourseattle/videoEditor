import type { AudioClip, Project, VideoClip } from '../types/model'
import { assetStore } from '../state/assetStore'

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

    // fades (audio clips only)
    if (clip.kind === 'audio') {
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
    const sourceOffset = clip.offset + skipIntoClip * clip.speed
    const remaining = (clip.duration - skipIntoClip) * clip.speed // source-domain seconds
    if (remaining <= 0 || sourceOffset >= buffer.duration) continue

    const startAt = when + Math.max(0, clip.start - from)
    src.start(startAt, sourceOffset, Math.min(remaining, buffer.duration - sourceOffset))
    sources.push(src)
  }
  return sources
}
