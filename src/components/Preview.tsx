import { useEffect, useRef } from 'react'
import type { Clip, Project } from '../types/model'
import { useEditor, projectDuration, findClip, replaceClip } from '../state/store'
import { renderFrame } from '../engine/compositor'
import { sampleKeyframes } from '../engine/keyframes'
import { playback, previewFrames } from '../engine/playback'
import { formatTime } from '../utils/time'

/** Approximate on-canvas bounds of a clip, in project coordinates (unrotated). */
function estimateBox(clip: Clip, p: Project, localT: number): { x: number; y: number; w: number; h: number } {
  const tx = sampleKeyframes(clip.transform.x, localT)
  const ty = sampleKeyframes(clip.transform.y, localT)
  const sc = sampleKeyframes(clip.transform.scale, localT) || 1
  const { width: W, height: H } = p
  let w = W
  let h = H
  switch (clip.kind) {
    case 'text':
    case 'caption': {
      w = W * 0.88
      h = clip.style.fontSize * clip.style.lineHeight * 2.4
      break
    }
    case 'chart': {
      w = W * 0.8
      h = clip.spec.type === 'counter' || clip.spec.type === 'progress' ? W * 0.32 : W * 0.8 * 0.72
      break
    }
    case 'sticker':
      w = h = W * 0.34
      break
    case 'shape':
      w = clip.width * W + 24
      h = Math.max(clip.height * H, 0.03 * H) + 24
      break
    default:
      break
  }
  w *= sc
  h *= sc
  return { x: W / 2 + tx - w / 2, y: H / 2 + ty - h / 2, w, h }
}

/** Overlay-ish clips are draggable; base video/image only when already selected. */
function isDirectlyEditable(kind: Clip['kind']): boolean {
  return kind !== 'audio'
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useEditor((s) => s.playing)
  const currentTime = useEditor((s) => s.currentTime)
  const project = useEditor((s) => s.project)
  const duration = projectDuration(project)
  const isEmpty = duration === 0 && Object.keys(project.assets).length === 0

  useEffect(() => {
    let raf = 0
    // Dirty-flag rendering: paint continuously while playing, and for a short
    // window after any state/size change (covers async <video> seeks), then idle.
    let lastChange = performance.now()
    const unsub = useEditor.subscribe(() => { lastChange = performance.now() })
    const ro = new ResizeObserver(() => { lastChange = performance.now() })
    if (canvasRef.current) ro.observe(canvasRef.current)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const s = useEditor.getState()
      if (!s.playing && performance.now() - lastChange > 700) return

      const { width: W, height: H } = s.project
      // Render only the pixels actually displayed (capped at project res) —
      // full-res compositing at 1080×1920 for a ~500px viewport is wasted work.
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const scale = rect.width > 0 && rect.height > 0
        ? Math.min(1, (rect.width * dpr) / W, (rect.height * dpr) / H)
        : 1
      const bw = Math.max(2, Math.round(W * scale))
      const bh = Math.max(2, Math.round(H * scale))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      const ctx = canvas.getContext('2d')!
      renderFrame(ctx, s.project, s.currentTime, previewFrames, bw / W)

      // selection outline (preview-only chrome; the exporter never draws this)
      if (!s.playing && s.selectedClipIds.length === 1) {
        const found = findClip(s.project, s.selectedClipIds[0])
        if (found && isDirectlyEditable(found.clip.kind)) {
          const c = found.clip
          if (s.currentTime >= c.start && s.currentTime < c.start + c.duration) {
            const box = estimateBox(c, s.project, s.currentTime - c.start)
            const k = bw / W
            ctx.save()
            ctx.strokeStyle = '#6c5ce7'
            ctx.lineWidth = 2
            ctx.setLineDash([6, 5])
            ctx.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k)
            ctx.setLineDash([])
            ctx.fillStyle = '#6c5ce7'
            for (const [hx, hy] of [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]) {
              ctx.beginPath()
              ctx.arc(hx * k, hy * k, 4.5, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.restore()
          }
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      unsub()
      ro.disconnect()
    }
  }, [])

  /** Pointer position → project coordinates (accounts for object-fit: contain letterboxing). */
  const toProject = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { width: W, height: H } = useEditor.getState().project
    const disp = Math.min(rect.width / W, rect.height / H)
    const ox = (rect.width - W * disp) / 2
    const oy = (rect.height - H * disp) / 2
    return { x: (e.clientX - rect.left - ox) / disp, y: (e.clientY - rect.top - oy) / disp, disp }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const s = useEditor.getState()
    if (s.playing) return
    const pt = toProject(e)

    // pick: selected clip first, else topmost overlay under the pointer
    let targetId: string | null = null
    if (s.selectedClipIds.length === 1) {
      const found = findClip(s.project, s.selectedClipIds[0])
      if (found && isDirectlyEditable(found.clip.kind)) {
        const c = found.clip
        if (s.currentTime >= c.start && s.currentTime < c.start + c.duration) {
          const box = estimateBox(c, s.project, s.currentTime - c.start)
          if (pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h) targetId = c.id
        }
      }
    }
    if (!targetId) {
      outer: for (const track of s.project.tracks) {
        if (track.hidden || track.kind === 'audio') continue
        // later-starting clips draw on top — check them first
        for (let i = track.clips.length - 1; i >= 0; i--) {
          const c = track.clips[i]
          if (c.kind === 'video' || c.kind === 'image' || c.kind === 'audio') continue // don't grab the base footage by accident
          if (s.currentTime < c.start || s.currentTime >= c.start + c.duration) continue
          const box = estimateBox(c, s.project, s.currentTime - c.start)
          if (pt.x >= box.x && pt.x <= box.x + box.w && pt.y >= box.y && pt.y <= box.y + box.h) {
            targetId = c.id
            break outer
          }
        }
      }
    }
    if (!targetId) {
      s.select([])
      return
    }
    e.preventDefault()
    s.select([targetId])

    const before = s.project
    const startPt = pt
    const found = findClip(s.project, targetId)!
    const origX = found.clip.transform.x.map((kf) => ({ ...kf }))
    const origY = found.clip.transform.y.map((kf) => ({ ...kf }))
    let moved = false

    const onMove = (ev: PointerEvent) => {
      const now = toProject(ev)
      const dx = now.x - startPt.x
      const dy = now.y - startPt.y
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
      if (!moved) return
      useEditor.getState().updateProject((p) =>
        replaceClip(p, targetId!, (c) => ({
          ...c,
          transform: {
            ...c.transform,
            // shift every keyframe uniformly so animated clips keep their motion
            x: origX.map((kf) => ({ ...kf, value: kf.value + dx })),
            y: origY.map((kf) => ({ ...kf, value: kf.value + dy })),
          },
        })), { transient: true })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) {
        const st = useEditor.getState()
        useEditor.setState({ past: [...st.past, before].slice(-100), future: [] })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Scroll over a selected clip = resize it (pinch/scroll to scale). */
  const onWheel = (e: React.WheelEvent) => {
    const s = useEditor.getState()
    if (s.playing || s.selectedClipIds.length !== 1) return
    const found = findClip(s.project, s.selectedClipIds[0])
    if (!found || !isDirectlyEditable(found.clip.kind)) return
    const c = found.clip
    if (s.currentTime < c.start || s.currentTime >= c.start + c.duration) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.04 : 1 / 1.04
    s.updateProject((p) =>
      replaceClip(p, c.id, (cl) => ({
        ...cl,
        transform: {
          ...cl.transform,
          scale: cl.transform.scale.map((kf) => ({ ...kf, value: Math.min(8, Math.max(0.05, kf.value * factor)) })),
        },
      })))
  }

  return (
    <>
      <div className="preview-wrap">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          style={{ visibility: isEmpty ? 'hidden' : 'visible' }}
          onPointerDown={onPointerDown}
          onWheel={onWheel}
        />
        {isEmpty && (
          <div className="empty-state">
            <div className="empty-logo">Cut<span>Room</span></div>
            <ol>
              <li><b>Import</b> video, audio or images — everything stays on this device</li>
              <li><b>Edit</b> — trim, captions, charts, effects, or let the AI tools cut for you</li>
              <li><b>Export</b> an MP4 sized for TikTok, Reels or Shorts</li>
            </ol>
            <button className="primary" onClick={() => useEditor.setState({ activePanel: 'media' })}>Import media</button>
            <p className="hint">Tip: drag files anywhere into the Media panel · press ? for shortcuts</p>
          </div>
        )}
      </div>
      <div className="transport">
        <button className="ghost" onClick={() => playback.seek(0)} title="Go to start (Home)">⏮</button>
        <button className="primary" style={{ width: 44 }} onClick={() => playback.toggle()} title="Play/pause (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="ghost" onClick={() => playback.seek(duration)} title="Go to end">⏭</button>
        <div className="time">
          {formatTime(currentTime, project.fps)} / {formatTime(duration, project.fps)}
        </div>
      </div>
    </>
  )
}
