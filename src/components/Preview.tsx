import { useEffect, useRef } from 'react'
import { useEditor, projectDuration } from '../state/store'
import { renderFrame } from '../engine/compositor'
import { playback, previewFrames } from '../engine/playback'
import { formatTime } from '../utils/time'

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useEditor((s) => s.playing)
  const currentTime = useEditor((s) => s.currentTime)
  const project = useEditor((s) => s.project)
  const duration = projectDuration(project)

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
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      unsub()
      ro.disconnect()
    }
  }, [])

  return (
    <>
      <div className="preview-wrap">
        <canvas ref={canvasRef} className="preview-canvas" />
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
