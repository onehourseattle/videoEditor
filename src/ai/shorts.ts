import type { Project, VideoClip } from '../types/model'
import { emptyProject } from '../state/store'
import { saveProjectRecord } from '../state/persistence'
import { findHighlights } from './highlights'
import { detectSilences } from './silence'
import { uid } from '../utils/id'
import { defaultTransform } from '../types/model'

export interface ShortSegment {
  /** source time, seconds */
  start: number
  end: number
  score: number
}

/**
 * Long video → N short candidates: energy-scored windows whose edges are
 * snapped outward to the nearest silence so cuts land on breath boundaries,
 * not mid-word. Pure local DSP.
 */
export async function findShortSegments(
  assetId: string,
  targetLen = 30,
  count = 3,
): Promise<ShortSegment[]> {
  const [highs, silences] = await Promise.all([
    findHighlights(assetId, count, targetLen),
    detectSilences(assetId, { threshold: 0.18, minSilence: 0.3, padding: 0.05 }),
  ])
  const cuts = silences.flatMap((s) => [s.start, s.end]).sort((a, b) => a - b)
  const snap = (t: number, dir: -1 | 1) => {
    let best = t
    let bestD = 2.5 // only snap within 2.5s
    for (const c of cuts) {
      const d = (c - t) * dir
      if (d >= 0 && d < bestD) { best = c; bestD = d }
    }
    return best
  }
  return highs
    .map((h) => ({ start: Math.max(0, snap(h.start, -1)), end: snap(h.end, 1), score: h.score }))
    .filter((s) => s.end - s.start >= targetLen * 0.4)
}

/** Materialize each segment as its own ready-to-edit project. */
export async function createShortsProjects(
  source: Project,
  clip: VideoClip,
  segments: ShortSegment[],
): Promise<string[]> {
  const asset = source.assets[clip.assetId]
  const names: string[] = []
  let n = 1
  for (const seg of segments) {
    const p = emptyProject()
    p.name = `${source.name || 'Untitled'} — Short ${n}`
    p.width = 1080
    p.height = 1920
    p.fps = source.fps
    p.assets = { [asset.id]: { ...asset } }
    const videoTrack = p.tracks.find((t) => t.kind === 'video')!
    videoTrack.clips.push({
      id: uid('clip'),
      kind: 'video',
      assetId: asset.id,
      name: `${asset.name} (${Math.round(seg.start)}s–${Math.round(seg.end)}s)`,
      start: 0,
      duration: (seg.end - seg.start) / clip.speed,
      offset: seg.start,
      speed: clip.speed,
      volume: 1,
      muted: false,
      transform: defaultTransform(),
      effects: [],
    })
    await saveProjectRecord(p)
    names.push(p.name)
    n++
  }
  return names
}
