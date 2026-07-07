import { useEffect, useRef, useState } from 'react'
import type { Clip, Track } from '../types/model'
import {
  useEditor, splitClipAt, removeClips, replaceClip, addTrack, addClipToTrack, projectDuration, byStart,
} from '../state/store'
import { assetStore } from '../state/assetStore'
import { makeClipFromAsset, trackAccepts, ASSET_DRAG_MIME } from '../state/clipFactory'
import { copySelectedClip, pasteStyleToSelection, hasStyle } from '../state/clipboard'
import { playback } from '../engine/playback'
import { formatTime } from '../utils/time'
import { uid } from '../utils/id'

const HEAD_W = 150

interface MenuState {
  x: number
  y: number
  clipId: string
}

export function Timeline() {
  const project = useEditor((s) => s.project)
  const zoom = useEditor((s) => s.timelineZoom)
  const setZoom = useEditor((s) => s.setZoom)
  const snapping = useEditor((s) => s.snapping)
  const toggleSnapping = useEditor((s) => s.toggleSnapping)
  const currentTime = useEditor((s) => s.currentTime)
  const playing = useEditor((s) => s.playing)
  const selected = useEditor((s) => s.selectedClipIds)
  const select = useEditor((s) => s.select)
  const snapLine = useEditor((s) => s.snapLine)
  const updateProject = useEditor((s) => s.updateProject)
  const toast = useEditor((s) => s.toast)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [hoverT, setHoverT] = useState<number | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  // clamp: a corrupt/Infinity clip duration must never explode the ruler loop
  const rawDuration = projectDuration(project)
  const duration = Math.min(Math.max(isFinite(rawDuration) ? rawDuration + 10 : 30, 30), 4 * 3600)

  // keep the playhead in view while playing
  useEffect(() => {
    if (!playing || !scrollRef.current) return
    const el = scrollRef.current
    const px = HEAD_W + currentTime * zoom
    if (px < el.scrollLeft + HEAD_W + 20 || px > el.scrollLeft + el.clientWidth - 120) {
      el.scrollLeft = Math.max(0, px - HEAD_W - 60)
    }
  }, [currentTime, playing, zoom])

  const timeFromEvent = (e: { clientX: number }) => {
    const rect = scrollRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollRef.current!.scrollLeft - HEAD_W
    return Math.max(0, x / zoom)
  }

  const onRulerDown = (e: React.PointerEvent) => {
    playback.seek(timeFromEvent(e))
    const move = (ev: PointerEvent) => playback.seek(timeFromEvent(ev))
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

  const fitZoom = () => {
    const el = scrollRef.current
    if (!el || rawDuration <= 0) return
    setZoom((el.clientWidth - HEAD_W - 40) / rawDuration)
  }

  // ⌘/Ctrl + scroll = zoom around the cursor position
  const onWheel = (e: React.WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return
    e.preventDefault()
    const el = scrollRef.current!
    const tAtCursor = timeFromEvent(e)
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const next = Math.min(480, Math.max(8, zoom * factor))
    setZoom(next)
    // keep the time under the cursor stationary
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      el.scrollLeft = tAtCursor * next - (e.clientX - rect.left - HEAD_W)
    })
  }

  // drop media from the library at the exact pointer position
  const onLaneDrop = (e: React.DragEvent, track: Track) => {
    const assetId = e.dataTransfer.getData(ASSET_DRAG_MIME)
    if (!assetId) return
    e.preventDefault()
    const asset = project.assets[assetId]
    if (!asset) return
    const clip = makeClipFromAsset(asset, Math.max(0, timeFromEvent(e)))
    if (!trackAccepts(clip, track) || track.locked) {
      toast(clip.kind === 'audio' ? 'Audio goes on an audio track' : 'This media needs a video/overlay track', 'error')
      return
    }
    updateProject((p) => addClipToTrack(p, track.id, clip))
    select([clip.id])
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
        <button className="small ghost" onClick={fitZoom} title="Fit timeline to window">⤢ Fit</button>
        <input
          type="range" min={8} max={480} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          style={{ width: 120 }} title="Zoom (⌘+scroll on the timeline)"
        />
      </div>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onClick={() => select([])}
        onWheel={onWheel}
        onPointerMove={(e) => setHoverT(timeFromEvent(e))}
        onPointerLeave={() => setHoverT(null)}
      >
        <div className="timeline-inner" style={{ width: HEAD_W + duration * zoom }}>
          <div className="ruler" onPointerDown={onRulerDown} style={{ marginLeft: HEAD_W, width: duration * zoom }}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * zoom }}>
                {t % (step >= 1 ? Math.max(step, 1) : 1) === 0 ? formatTime(t).slice(0, 5) : ''}
              </div>
            ))}
          </div>
          {project.tracks.map((track) => (
            <TrackRow
              key={track.id} track={track} zoom={zoom}
              timeFromEvent={timeFromEvent}
              onLaneDrop={onLaneDrop}
              onClipMenu={(x, y, clipId) => setMenu({ x, y, clipId })}
            />
          ))}
          {hoverT !== null && !playing && <div className="hoverline" style={{ left: HEAD_W + hoverT * zoom }} />}
          {snapLine !== null && <div className="snapline" style={{ left: HEAD_W + snapLine * zoom }} />}
          <div className="playhead" style={{ left: HEAD_W + currentTime * zoom }} />
        </div>
      </div>
      {menu && <ClipMenu menu={menu} close={() => setMenu(null)} />}
    </div>
  )
}

// ─── context menu ────────────────────────────────────────────────────────────

function ClipMenu({ menu, close }: { menu: MenuState; close: () => void }) {
  const updateProject = useEditor((s) => s.updateProject)
  const select = useEditor((s) => s.select)

  useEffect(() => {
    const off = () => close()
    window.addEventListener('pointerdown', off)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('pointerdown', off)
      window.removeEventListener('blur', off)
    }
  }, [close])

  const s = useEditor.getState()
  const found = s.project.tracks.flatMap((t) => t.clips.map((c) => ({ t, c }))).find((x) => x.c.id === menu.clipId)
  if (!found) return null
  const { t: track, c: clip } = found
  const canMute = clip.kind === 'video' || clip.kind === 'audio'

  const item = (label: string, action: () => void, disabled = false) => (
    <button
      className="menu-item" disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => { action(); close() }}
    >{label}</button>
  )

  return (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      {item('✂️ Split at playhead', () => {
        updateProject((p) => splitClipAt(p, clip.id, useEditor.getState().currentTime))
      }, s.currentTime <= clip.start || s.currentTime >= clip.start + clip.duration)}
      {item('⧉ Duplicate', () => {
        const copy = structuredClone(clip)
        copy.id = uid('clip')
        copy.start = clip.start + clip.duration
        updateProject((p) => addClipToTrack(p, track.id, copy))
        select([copy.id])
      })}
      {canMute && item(('muted' in clip && clip.muted) ? '🔊 Unmute' : '🔇 Mute', () => {
        updateProject((p) => replaceClip(p, clip.id, (c) => ('muted' in c ? { ...c, muted: !c.muted } : c)))
      })}
      {item('📋 Copy (style + clip)', () => {
        select([clip.id])
        copySelectedClip()
        useEditor.getState().toast('Copied — ⌘V pastes the clip, ⌥⌘V pastes its style', 'info')
      })}
      {hasStyle() && item('🎨 Paste style', () => {
        select([clip.id])
        const n = pasteStyleToSelection()
        if (n) useEditor.getState().toast('Style applied', 'ok')
      })}
      {clip.transition && item('◇ Remove transition', () => {
        updateProject((p) => replaceClip(p, clip.id, (c) => ({ ...c, transition: undefined })))
      })}
      {item('🗑 Delete', () => {
        updateProject((p) => removeClips(p, [clip.id]))
        select([])
      })}
    </div>
  )
}

// ─── track row ───────────────────────────────────────────────────────────────

function TrackRow({ track, zoom, timeFromEvent, onLaneDrop, onClipMenu }: {
  track: Track
  zoom: number
  timeFromEvent: (e: { clientX: number }) => number
  onLaneDrop: (e: React.DragEvent, track: Track) => void
  onClipMenu: (x: number, y: number, clipId: string) => void
}) {
  const updateProject = useEditor((s) => s.updateProject)
  const [renaming, setRenaming] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const patchTrack = (patch: Partial<Track>) =>
    updateProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, ...patch } : t)) }))

  return (
    <div className="track-row">
      <div className="track-head">
        {renaming ? (
          <input
            autoFocus
            defaultValue={track.name}
            onBlur={(e) => { patchTrack({ name: e.target.value || track.name }); setRenaming(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
            style={{ width: 70, fontSize: 11, padding: '2px 4px' }}
          />
        ) : (
          <span className="name" title={`${track.name} — double-click to rename`} onDoubleClick={() => setRenaming(true)}>
            {track.name}
          </span>
        )}
        {track.kind !== 'overlay' ? (
          <button
            className={track.muted ? 'on' : ''}
            title={track.muted ? 'Unmute' : 'Mute'}
            onClick={() => patchTrack({ muted: !track.muted })}
          >{track.muted ? '🔇' : '🔊'}</button>
        ) : null}
        <button
          className={track.hidden ? 'on' : ''}
          title={track.hidden ? 'Show' : 'Hide'}
          onClick={() => patchTrack({ hidden: !track.hidden })}
        >{track.hidden ? '🚫' : '👁'}</button>
        <button
          className={track.locked ? 'on' : ''}
          title={track.locked ? 'Unlock' : 'Lock'}
          onClick={() => patchTrack({ locked: !track.locked })}
        >{track.locked ? '🔒' : '🔓'}</button>
        {track.clips.length === 0 && (
          <button
            className="del"
            title="Remove empty track"
            onClick={() => updateProject((p) =>
              p.tracks.length > 1 ? { ...p, tracks: p.tracks.filter((t) => t.id !== track.id) } : p,
            )}
          >✕</button>
        )}
      </div>
      <div
        className={`track-lane ${dragOver ? 'drop-target' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDragOver(true)
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { setDragOver(false); onLaneDrop(e, track) }}
      >
        {track.clips.map((clip) => (
          <ClipView key={clip.id} clip={clip} track={track} zoom={zoom} timeFromEvent={timeFromEvent} onClipMenu={onClipMenu} />
        ))}
      </div>
    </div>
  )
}

// ─── clips ───────────────────────────────────────────────────────────────────

type DragMode = 'move' | 'trim-left' | 'trim-right'

function ClipView({ clip, track, zoom, timeFromEvent, onClipMenu }: {
  clip: Clip
  track: Track
  zoom: number
  timeFromEvent: (e: { clientX: number }) => number
  onClipMenu: (x: number, y: number, clipId: string) => void
}) {
  const selected = useEditor((s) => s.selectedClipIds.includes(clip.id))
  const select = useEditor((s) => s.select)
  const updateProject = useEditor((s) => s.updateProject)
  const [dragging, setDragging] = useState(false)
  const [artUrl, setArtUrl] = useState('')

  // filmstrip (video) / waveform (audio) clip bodies, generated once per asset
  const assetId = 'assetId' in clip ? clip.assetId : null
  const asset = assetId ? useEditor.getState().project.assets[assetId] : undefined
  useEffect(() => {
    let alive = true
    if (asset?.url && clip.kind === 'video') {
      void assetStore.getFilmstrip(asset.id, asset.url, asset.duration).then((u) => { if (alive) setArtUrl(u) })
    } else if (asset?.url && clip.kind === 'audio') {
      void assetStore.getWaveform(asset.id).then((u) => { if (alive) setArtUrl(u) })
    }
    return () => { alive = false }
  }, [asset?.id, asset?.url, clip.kind])

  const beginDrag = (e: React.PointerEvent, mode: DragMode) => {
    if (track.locked || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    select([clip.id])
    const startT = timeFromEvent(e)
    const before = useEditor.getState().project // full snapshot = exact undo point
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

    const snap = (t: number): { t: number; snapped: number | null } => {
      if (!useEditor.getState().snapping) return { t, snapped: null }
      const threshold = 8 / zoom
      let best = t
      let bestD = threshold
      let snapped: number | null = null
      for (const st of snapTargets) {
        const d = Math.abs(st - t)
        if (d < bestD) { best = st; bestD = d; snapped = st }
      }
      return { t: best, snapped }
    }

    /** Track row under the pointer (for vertical cross-track moves). */
    const trackAt = (clientY: number): Track | null => {
      const rows = document.querySelectorAll<HTMLElement>('.track-row')
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (clientY >= r.top && clientY < r.bottom) return useEditor.getState().project.tracks[i] ?? null
      }
      return null
    }

    const onMove = (ev: PointerEvent) => {
      const scroll = document.querySelector('.timeline-scroll') as HTMLDivElement
      const r = scroll.getBoundingClientRect()
      const t = Math.max(0, (ev.clientX - r.left + scroll.scrollLeft - HEAD_W) / zoom)
      const delta = t - startT
      if (Math.abs(delta) * zoom > 3) moved = true
      if (!moved) return
      setDragging(true)

      let snappedAt: number | null = null
      updateProject((p) => {
        let next = replaceClip(p, clip.id, (c) => {
          if (mode === 'move') {
            const r2 = snap(orig.start + delta)
            const endSnap = snap(orig.start + orig.duration + delta)
            // snap either edge, whichever is closer
            let start = r2.t
            snappedAt = r2.snapped
            if (r2.snapped === null && endSnap.snapped !== null) {
              start = endSnap.t - orig.duration
              snappedAt = endSnap.snapped
            }
            return { ...c, start: Math.max(0, start) }
          }
          if (mode === 'trim-left') {
            const r2 = snap(orig.start + delta)
            snappedAt = r2.snapped
            const newStart = Math.min(r2.t, orig.start + orig.duration - 0.1)
            const d = newStart - orig.start
            const trimmed = { ...c, start: Math.max(0, newStart), duration: orig.duration - d }
            if ('offset' in trimmed) (trimmed as { offset: number }).offset = Math.max(0, orig.offset + d * speed)
            return trimmed
          }
          // trim-right
          const r2 = snap(orig.start + orig.duration + delta)
          snappedAt = r2.snapped
          const newEnd = Math.max(r2.t, orig.start + 0.1)
          return { ...c, duration: newEnd - orig.start }
        })

        // vertical: move to the (compatible, unlocked) track under the pointer
        if (mode === 'move') {
          const target = trackAt(ev.clientY)
          const holder = next.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id))
          if (target && holder && target.id !== holder.id && !target.locked && trackAccepts(clip, target)) {
            const moving = holder.clips.find((c) => c.id === clip.id)!
            next = {
              ...next,
              tracks: next.tracks.map((tr) => {
                if (tr.id === holder.id) return { ...tr, clips: tr.clips.filter((c) => c.id !== clip.id) }
                if (tr.id === target.id) return { ...tr, clips: [...tr.clips, moving].sort(byStart) }
                return tr
              }),
            }
          }
        }
        return next
      }, { transient: true })
      useEditor.setState({ snapLine: snappedAt })
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
      useEditor.setState({ snapLine: null })
      if (moved) {
        // one undo step for the whole gesture — restores position AND track
        const s = useEditor.getState()
        useEditor.setState({ past: [...s.past, before].slice(-100), future: [] })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const isWave = clip.kind === 'audio'
  return (
    <div
      className={`clip kind-${clip.kind} ${selected ? 'selected' : ''}`}
      style={{ left: clip.start * zoom, width: Math.max(6, clip.duration * zoom), cursor: dragging ? 'grabbing' : 'grab' }}
      onPointerDown={(e) => beginDrag(e, 'move')}
      onClick={(e) => { e.stopPropagation(); select([clip.id]) }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        select([clip.id])
        onClipMenu(e.clientX, e.clientY, clip.id)
      }}
    >
      {artUrl ? (
        <div className={`thumb ${isWave ? 'wave' : ''}`} style={{ backgroundImage: `url(${artUrl})` }} />
      ) : asset?.thumbnail ? (
        <div className="thumb" style={{ backgroundImage: `url(${asset.thumbnail})` }} />
      ) : null}
      <span className="label">{clip.name}</span>
      {clip.transition && <div className="transition-badge" title={`Transition: ${clip.transition.type}`} />}
      <div className="handle left" onPointerDown={(e) => beginDrag(e, 'trim-left')} />
      <div className="handle right" onPointerDown={(e) => beginDrag(e, 'trim-right')} />
    </div>
  )
}
