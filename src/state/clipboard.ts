import type { Clip } from '../types/model'
import { useEditor, findClip, addClipToTrack, replaceClip } from './store'
import { trackAccepts } from './clipFactory'
import { uid } from '../utils/id'

/**
 * In-app clipboard: whole clips (⌘C/⌘V) and looks (⌥⌘C/⌥⌘V).
 * "Paste style" is the CapCut apply-to-all gesture — copy one caption's look,
 * select others, paste.
 */

let clipBuffer: { clip: Clip; trackId: string } | null = null
let styleBuffer: Clip | null = null

export function copySelectedClip(): boolean {
  const s = useEditor.getState()
  if (s.selectedClipIds.length !== 1) return false
  const found = findClip(s.project, s.selectedClipIds[0])
  if (!found) return false
  clipBuffer = { clip: structuredClone(found.clip), trackId: found.track.id }
  styleBuffer = structuredClone(found.clip) // ⌘C also arms style paste
  return true
}

export function pasteClipAtPlayhead(): boolean {
  const s = useEditor.getState()
  if (!clipBuffer) return false
  const { clip, trackId } = clipBuffer
  const copy = structuredClone(clip)
  copy.id = uid('clip')
  copy.start = s.currentTime
  const target =
    s.project.tracks.find((t) => t.id === trackId && !t.locked && trackAccepts(copy, t)) ??
    s.project.tracks.find((t) => !t.locked && trackAccepts(copy, t))
  if (!target) return false
  s.updateProject((p) => addClipToTrack(p, target.id, copy))
  s.select([copy.id])
  return true
}

export function hasStyle(): boolean {
  return styleBuffer !== null
}

/** Merge the copied clip's look onto every selected clip (kind-aware). */
export function pasteStyleToSelection(): number {
  const s = useEditor.getState()
  const src = styleBuffer
  if (!src || !s.selectedClipIds.length) return 0
  let applied = 0
  s.updateProject((p) => {
    let next = p
    for (const id of s.selectedClipIds) {
      next = replaceClip(next, id, (target) => {
        const merged = mergeLook(target, src)
        if (merged !== target) applied++
        return merged
      })
    }
    return next
  })
  return applied
}

function mergeLook(target: Clip, src: Clip): Clip {
  let out: Clip = {
    ...target,
    // effects always travel (fresh ids so toggles stay independent)
    effects: src.effects.map((e) => ({ ...e, id: uid('fx'), params: { ...e.params } })),
    transform: {
      ...target.transform,
      scale: src.transform.scale.map((k) => ({ ...k })),
      opacity: src.transform.opacity.map((k) => ({ ...k })),
    },
  }
  const textish = (c: Clip) => c.kind === 'text' || c.kind === 'caption'
  if (textish(out) && textish(src)) {
    const style = structuredClone((src as Extract<Clip, { kind: 'text' | 'caption' }>).style)
    if (out.kind === 'text' && (src.kind === 'text' || src.kind === 'caption')) {
      out = { ...out, style, animation: src.kind === 'text' ? src.animation : out.animation }
    }
    if (out.kind === 'caption') {
      out = {
        ...out,
        style,
        animation: src.kind === 'caption' ? src.animation : out.animation,
        wordsPerPage: src.kind === 'caption' ? src.wordsPerPage : out.wordsPerPage,
      }
    }
  }
  if (out.kind === 'chart' && src.kind === 'chart') {
    out = {
      ...out,
      spec: {
        ...out.spec, // keep the data + type
        color: src.spec.color,
        accentColor: src.spec.accentColor,
        backgroundColor: src.spec.backgroundColor,
        fontFamily: src.spec.fontFamily,
        animateIn: src.spec.animateIn,
        showValues: src.spec.showValues,
      },
    }
  }
  if ('volume' in out && 'volume' in src) {
    out = { ...out, volume: src.volume }
  }
  return out
}
