import { create } from 'zustand'
import type { Clip, Project, Track, TrackKind } from '../types/model'
import { projectDuration } from '../types/model'
import { uid } from '../utils/id'
import { clamp } from '../utils/time'

const HISTORY_LIMIT = 100

export function emptyProject(): Project {
  return {
    id: uid('proj'),
    name: 'Untitled project',
    width: 1080,
    height: 1920,
    fps: 30,
    assets: {},
    tracks: [
      { id: uid('track'), kind: 'overlay', name: 'Overlay 2', muted: false, locked: false, hidden: false, clips: [] },
      { id: uid('track'), kind: 'overlay', name: 'Overlay 1', muted: false, locked: false, hidden: false, clips: [] },
      { id: uid('track'), kind: 'video', name: 'Video', muted: false, locked: false, hidden: false, clips: [] },
      { id: uid('track'), kind: 'audio', name: 'Audio', muted: false, locked: false, hidden: false, clips: [] },
    ],
  }
}

export type PanelTab = 'media' | 'text' | 'captions' | 'charts' | 'stickers' | 'ai' | 'script'

export interface Toast {
  id: string
  msg: string
  kind: 'info' | 'ok' | 'error'
}

export type Theme = 'dark' | 'light'

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('cutroom.theme')
    if (t === 'light' || t === 'dark') return t
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

interface EditorState {
  project: Project
  /** playhead position in seconds */
  currentTime: number
  playing: boolean
  selectedClipIds: string[]
  /** null = panel drawer closed (tap the active tab again to close — matters on small screens) */
  activePanel: PanelTab | null
  timelineZoom: number // px per second
  snapping: boolean
  exportOpen: boolean
  helpOpen: boolean
  projectsOpen: boolean
  busy: string | null // global progress message ('Transcribing… 40%')
  toasts: Toast[]
  theme: Theme
  /** transient vertical indicator (timeline sec) shown while a drag snaps */
  snapLine: number | null

  past: Project[]
  future: Project[]

  // ── actions ──
  setTime: (t: number) => void
  setPlaying: (p: boolean) => void
  setPanel: (p: PanelTab | null) => void
  setZoom: (z: number) => void
  toggleSnapping: () => void
  setExportOpen: (open: boolean) => void
  setHelpOpen: (open: boolean) => void
  setProjectsOpen: (open: boolean) => void
  setBusy: (msg: string | null) => void
  select: (ids: string[]) => void
  toast: (msg: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
  setTheme: (t: Theme) => void

  /** All project mutations flow through here so history stays consistent. */
  updateProject: (fn: (p: Project) => Project, options?: { transient?: boolean }) => void
  replaceProject: (p: Project) => void
  undo: () => void
  redo: () => void
}

export const useEditor = create<EditorState>((set, get) => ({
  project: emptyProject(),
  currentTime: 0,
  playing: false,
  selectedClipIds: [],
  activePanel: 'media',
  timelineZoom: 60,
  snapping: true,
  exportOpen: false,
  helpOpen: false,
  projectsOpen: false,
  busy: null,
  toasts: [],
  theme: initialTheme(),
  snapLine: null,
  past: [],
  future: [],

  setTime: (t) => set({ currentTime: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setPanel: (panel) => set((s) => ({ activePanel: s.activePanel === panel ? null : panel })),
  setZoom: (z) => set({ timelineZoom: clamp(z, 8, 480) }),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setBusy: (busy) => set({ busy }),
  select: (selectedClipIds) => set({ selectedClipIds }),

  toast: (msg, kind = 'info') => {
    const id = uid('toast')
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, kind }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setTheme: (theme) => {
    try { localStorage.setItem('cutroom.theme', theme) } catch { /* private mode */ }
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#fbfbfc' : '#101014')
    set({ theme })
  },

  updateProject: (fn, options) =>
    set((s) => {
      const next = fn(s.project)
      if (next === s.project) return {}
      if (options?.transient) return { project: next }
      const past = [...s.past, s.project].slice(-HISTORY_LIMIT)
      return { project: next, past, future: [] }
    }),

  replaceProject: (p) => set({ project: p, past: [], future: [], selectedClipIds: [], currentTime: 0 }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {}
      const past = [...s.past]
      const prev = past.pop()!
      return { project: prev, past, future: [s.project, ...s.future].slice(0, HISTORY_LIMIT) }
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {}
      const [next, ...future] = s.future
      return { project: next, future, past: [...s.past, s.project].slice(-HISTORY_LIMIT) }
    }),
}))

// ─── Pure helpers used by components and the scripting API ──────────────────

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

export function replaceClip(p: Project, clipId: string, fn: (c: Clip) => Clip): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.clips.some((c) => c.id === clipId)
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) }
        : t,
    ),
  }
}

export function removeClips(p: Project, clipIds: string[]): Project {
  const ids = new Set(clipIds)
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(c.id)) })) }
}

export function addClipToTrack(p: Project, trackId: string, clip: Clip): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip].sort(byStart) } : t)),
  }
}

export function addTrack(p: Project, kind: TrackKind, name?: string): { project: Project; track: Track } {
  const track: Track = {
    id: uid('track'),
    kind,
    name: name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${p.tracks.filter((t) => t.kind === kind).length + 1}`,
    muted: false,
    locked: false,
    hidden: false,
    clips: [],
  }
  // overlays stack on top (start of array = topmost), audio at the bottom
  const tracks = kind === 'audio' ? [...p.tracks, track] : [track, ...p.tracks]
  return { project: { ...p, tracks }, track }
}

/** Split a media/text clip at absolute timeline time. Returns unchanged project if t is outside the clip. */
export function splitClipAt(p: Project, clipId: string, t: number): Project {
  const found = findClip(p, clipId)
  if (!found) return p
  const { clip, track } = found
  const local = t - clip.start
  if (local <= 0.01 || local >= clip.duration - 0.01) return p

  const left: Clip = { ...clip, duration: local, transition: undefined }
  const right: Clip = { ...clip, id: uid('clip'), start: t, duration: clip.duration - local }

  if (right.kind === 'video' || right.kind === 'audio') {
    right.offset = right.offset + local * right.speed
    if (right.gain) {
      right.gain = right.gain.filter((k) => k.t >= local).map((k) => ({ ...k, t: k.t - local }))
      if (right.gain.length < 2) right.gain = undefined
    }
    if (left.kind === 'video' || left.kind === 'audio') {
      if (left.gain) {
        left.gain = left.gain.filter((k) => k.t <= local)
        if (left.gain.length < 2) left.gain = undefined
      }
    }
  }
  if (right.kind === 'caption') {
    right.words = clip.kind === 'caption'
      ? clip.words.filter((w) => w.end > local).map((w) => ({ ...w, start: Math.max(0, w.start - local), end: w.end - local }))
      : []
    if (left.kind === 'caption') left.words = left.words.filter((w) => w.start < local)
  }

  return {
    ...p,
    tracks: p.tracks.map((tr) =>
      tr.id === track.id ? { ...tr, clips: [...tr.clips.filter((c) => c.id !== clipId), left, right].sort(byStart) } : tr,
    ),
  }
}

/** Delete a time range from a clip and close the gap for clips after it on the same track (ripple). */
export function rippleDeleteRange(p: Project, trackId: string, from: number, to: number): Project {
  const dur = to - from
  if (dur <= 0) return p
  return {
    ...p,
    tracks: p.tracks.map((tr) => {
      if (tr.id !== trackId) return tr
      const clips: Clip[] = []
      for (const c of tr.clips) {
        const end = c.start + c.duration
        if (end <= from) {
          clips.push(c)
        } else if (c.start >= to) {
          clips.push({ ...c, start: c.start - dur })
        } else {
          // overlaps the removed range: keep left part and/or right part
          if (c.start < from) {
            const keep = from - c.start
            const left: Clip = { ...c, duration: keep, transition: undefined }
            if (left.kind === 'caption') left.words = left.words.filter((w) => w.start < keep)
            if ((left.kind === 'video' || left.kind === 'audio') && left.gain) {
              left.gain = left.gain.filter((k) => k.t <= keep)
              if (left.gain.length < 2) left.gain = undefined
            }
            clips.push(left)
          }
          if (end > to) {
            const cutIntoClip = to - c.start
            const right: Clip = { ...c, id: uid('clip'), start: from, duration: end - to }
            if (right.kind === 'video' || right.kind === 'audio') {
              right.offset += cutIntoClip * right.speed
              if (right.gain) {
                right.gain = right.gain.filter((k) => k.t >= cutIntoClip).map((k) => ({ ...k, t: k.t - cutIntoClip }))
                if (right.gain.length < 2) right.gain = undefined
              }
            }
            if (right.kind === 'caption') {
              right.words = right.words
                .filter((w) => w.end > cutIntoClip)
                .map((w) => ({ ...w, start: Math.max(0, w.start - cutIntoClip), end: w.end - cutIntoClip }))
            }
            clips.push(right)
          }
        }
      }
      return { ...tr, clips: clips.sort(byStart) }
    }),
  }
}

/**
 * Ripple-delete a time range from EVERY track — the text-based-editing cut.
 * Video, audio, captions and overlays all close the gap together, so the
 * edit stays in sync.
 */
export function rippleDeleteAllTracks(p: Project, from: number, to: number): Project {
  return p.tracks.reduce((acc, tr) => rippleDeleteRange(acc, tr.id, from, to), p)
}

export function byStart(a: Clip, b: Clip): number {
  return a.start - b.start
}

export { projectDuration }
