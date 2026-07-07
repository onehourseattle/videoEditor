import type { AssetMeta, AudioClip, Clip, ImageClip, Track, VideoClip } from '../types/model'
import { defaultTransform } from '../types/model'
import { uid } from '../utils/id'

export function makeClipFromAsset(asset: AssetMeta, start: number): Clip {
  if (asset.type === 'audio') {
    const clip: AudioClip = {
      id: uid('clip'), kind: 'audio', assetId: asset.id, name: asset.name,
      start, duration: asset.duration, offset: 0, speed: 1, volume: 1, muted: false,
      fadeIn: 0, fadeOut: 0, transform: defaultTransform(), effects: [],
    }
    return clip
  }
  if (asset.type === 'video') {
    const clip: VideoClip = {
      id: uid('clip'), kind: 'video', assetId: asset.id, name: asset.name,
      start, duration: asset.duration, offset: 0, speed: 1, volume: 1, muted: false,
      transform: defaultTransform(), effects: [],
    }
    return clip
  }
  const clip: ImageClip = {
    id: uid('clip'), kind: 'image', assetId: asset.id, name: asset.name,
    start, duration: 4, transform: defaultTransform(), effects: [],
  }
  return clip
}

/** Which track kinds a clip may live on. */
export function trackAccepts(clip: Pick<Clip, 'kind'>, track: Pick<Track, 'kind'>): boolean {
  if (clip.kind === 'audio') return track.kind === 'audio'
  return track.kind === 'video' || track.kind === 'overlay'
}

export const ASSET_DRAG_MIME = 'application/x-cutroom-asset'
