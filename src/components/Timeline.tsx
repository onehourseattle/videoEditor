import { useRef, useState } from 'react'
import type { Clip, Track } from '../types/model'
import {
  useEditor, splitClipAt, removeClips, replaceClip, addTrack, projectDuration,
} from '../state/store'
import { playback } from '../engine/playback'
import { formatTime } from '../utils/time'

const HEAD_W = 130

export function Timeline() {
  const project = useEditor((s) => s.project)
  const zoom = useEditor((s) => s.timelineZoom)
  const setZoom = useEditor((s) => s.setZoom)
  const snapping = useEditor((s) => s.snapping)
  const toggleSnapping = useEditor((s) => s.toggleSnapping)
  const currentTime = useEditor((s) => s.currentTime)
  const selected = useEditor((s) => s.selectedClipIds)
  const select = useEditor((s) => s.select)
  const updateProject = useEditor((s) => s.updateProject)

  const scrollRef = useRef<HTMLDivElement>(null)
  const duration = Math.max(projectDuration(project) + 10, 30)

  const timeFromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = scrollRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollRef.current!.scrollLeft - HEAD_W
    return Math.max(0, x / zoom)
  }

  const onRulerDown = (e: React.PointerEvent) => {
    playback.seek(timeFromEvent(e))
    const move = (ev: PointerEvent) => {
      const rect = scrollRef.current!.getBoundingClientRect()
      const x = ev.clientX - rect.left + scrollRef.current!.scrollLeft - HEAD_W
      playback.seek(Math.max(0, x / zoom))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const splitSelected = () => {
    const s = useEditor.getState()
    for (const id of s.selectedClipIds) updateProject((p) => splitClipAt(p, id, s.currentTime))
  }

  const deleteSelected = () => {
    updateProject((p) => removeClips(p, selected))
    select([])
  }

  // ruler ticks: pick a step that keeps labels readable at any zoom
  const step = zoom > 200 ? 0.5 : zoom > 90 ? 1 : zoom > 40 ? 2 : zoom > 18 ? 5 : 10
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button className="small" onClick={splitSelected} disabled={!selected.length} title="Split at playhead (S)">✂️ Split</button>
        <button className="small" onClick={deleteSelected} disabled={!selected.length} title="Delete (⌫)">🗑 Delete</button>
        <button className="small" onClick={() => updateProject((p) => addTrack(p, 'overlay').project)}>+ Overlay track</button>
        <button className="small" onClick={() => updateProject((p) => addTrack(p, 'audio').project)}>+ Audio track</button>
        <button className={`small ${snapping ? '' : 'ghost'}`} onClick={toggleSnapping} title="Snapping">
          🧲 {snapping ? 'On' : 'Off'}
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>{formatTime(currentTime, project.fps)}</span>
        <input
          type="range" min={8} max={480} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ width: 120 }} title="Zoom"
        />
      </div>
      <div className="timeline-scroll" ref={scrollRef} onClick={() => select([])}>
        <div className="timeline-inner" style={{ width: HEAD_W + duration * zoom }}>
          <div className="ruler" onPointerDown={onRulerDown} style={{ marginLeft: HEAD_W, width: duration * zoom }}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * zoom }}>
                {t % (step >= 1 ? Math.max(step, 1) : 1) === 0 ? formatTime(t).slice(0, 5) : ''}
              </div>
            ))}
          </div>
          {project.tracks.map((track) => (
            <TrackRow key={track.id} track={track} zoom={zoom} timeFromEvent={timeFromEvent} />
          ))}
          <div className="playhead" style={{ left: HEAD_W + currentTime * zoom }} />
        </div>
      </div>
    </div>
  )
}

function TrackRow({ track, zoom, timeFromEvent }: {
  track: Track
  zoom: number
  timeFromEvent: (e: React.PointerEvent) => number
}) {
  const updateProject = useEditor((s) => s.updateProject)

  return (
    <div className="track-row">
      <div className="track-head">
        <span className="name" title={track.name}>{track.name}</span>
        {track.kind !== 'overlay' ? (
          <button
            className={track.muted ? 'on' : ''}
            title={track.muted ? 'Unmute' : 'Mute'}
            onClick={() => updateProject((p) => ({
              ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, muted: !t.muted } : t)),
            }))}
          >{track.muted ? '🔇' : '🔊'}</button>
        ) : null}
        <button
          className={track.hidden ? 'on' : ''}
          title={track.hidden ? 'Show' : 'Hide'}
          onClick={() => updateProject((p) => ({
            ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, hidden: !t.hidden } : t)),
          }))}
        >{track.hidden ? '🚫' : '👁'}</button>
        <button
          className={track.locked ? 'on' : ''}
          title={track.locked ? 'Unlock' : 'Lock'}
          onClick={() => updateProject((p) => ({
            ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, locked: !t.locked } : t)),
          }))}
        >{track.locked ? '🔒' : '🔓'}</button>
      </div>
      <div className="track-lane">
        {track.clips.map((clip) => (
          <ClipView key={clip.id} clip={clip} track={track} zoom={zoom} timeFromEvent={timeFromEvent} />
        ))}
      </div>
    </div>
  )
}

type DragMode = 'move' | 'trim-left' | 'trim-right'

function ClipView({ clip, track, zoom, timeFromEvent }: {
  clip: Clip
  track: Track
  zoom: number
  timeFromEvent: (e: React.PointerEvent) => number
}) {
  const selected = useEditor((s) => s.selectedClipIds.includes(clip.id))
  const select = useEditor((s) => s.select)
  const updateProject = useEditor((s) => s.updateProject)
  const [dragging, setDragging] = useState(false)

  const beginDrag = (e: React.PointerEvent, mode: DragMode) => {
    if (track.locked) return
    e.stopPropagation()
    e.preventDefault()
    select([clip.id])
    const startT = timeFromEvent(e)
    const orig = { start: clip.start, duration: clip.duration, offset: 'offset' in clip ? clip.offset : 0 }
    const speed = 'speed' in clip ? clip.speed : 1
    let moved = false

    const snapTargets = (() => {
      const s = useEditor.getState()
      const times: number[] = [0, s.currentTime]
      for (const t of s.project.tracks) for (const c of t.clips) {
        if (c.id === clip.id) continue
        times.push(c.start, c.start + c.duration)
      }
      return times
    })()

    const snap = (t: number) => {
      if (!useEditor.getState().snapping) return t
      const threshold = 8 / zoom
      let best = t
      let bestD = threshold
      for (const st of snapTargets) {
        const d = Math.abs(st - t)
        if (d < bestD) { best = st; bestD = d }
      }
      return best
    }

    const onMove = (ev: PointerEvent) => {
      const rect = (ev.target as HTMLElement).ownerDocument.defaultView
      void rect
      const scroll = document.querySelector('.timeline-scroll') as HTMLDivElement
      const r = scroll.getBoundingClientRect()
      const t = Math.max(0, (ev.clientX - r.left + scroll.scrollLeft - 130) / zoom)
      const delta = t - startT
      if (Math.abs(delta) * zoom > 3) moved = true
      if (!moved) return
      setDragging(true)

      updateProject((p) => replaceClip(p, clip.id, (c) => {
        if (mode === 'move') {
          return { ...c, start: Math.max(0, snap(orig.start + delta)) }
        }
        if (mode === 'trim-left') {
          const newStart = Math.min(snap(orig.start + delta), orig.start + orig.duration - 0.1)
          const d = newStart - orig.start
          const next = { ...c, start: Math.max(0, newStart), duration: orig.duration - d }
          if ('offset' in next) (next as { offset: number }).offset = Math.max(0, orig.offset + d * speed)
          return next
        }
        // trim-right
        const newEnd = Math.max(snap(orig.start + orig.duration + delta), orig.start + 0.1)
        return { ...c, duration: newEnd - orig.start }
      }), { transient: true })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
      if (moved) {
        // commit once to history: transient edits already applied; push an undo point
        const s = useEditor.getState()
        useEditor.setState({ past: [...s.past, restoreOriginal(s.project, clip.id, orig, clip)].slice(-100), future: [] })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const asset = 'assetId' in clip ? useEditor.getState().project.assets[clip.assetId] : undefined

  return (
    <div
      className={`clip kind-${clip.kind} ${selected ? 'selected' : ''}`}
      style={{ left: clip.start * zoom, width: Math.max(6, clip.duration * zoom), cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={(e) => beginDrag(e, 'move')}
      onClick={(e) => { e.stopPropagation(); select([clip.id]) }}
    >
      {asset?.thumbnail && <div className="thumb" style={{ backgroundImage: `url(${asset.thumbnail})` }} />}
      <span className="label">{clip.name}</span>
      {clip.transition && <div className="transition-badge" title={`Transition: ${clip.transition.type}`} />}
      <div className="handle left" onPointerDown={(e) => beginDrag(e, 'trim-left')} />
      <div className="handle right" onPointerDown={(e) => beginDrag(e, 'trim-right')} />
    </div>
  )
}

/** Reconstruct the pre-drag project so undo lands on the original layout. */
function restoreOriginal(
  current: ReturnType<typeof useEditor.getState>['project'],
  clipId: string,
  orig: { start: number; duration: number; offset: number },
  clipBefore: Clip,
) {
  return replaceClip(current, clipId, () => structuredClone(clipBefore))
}
