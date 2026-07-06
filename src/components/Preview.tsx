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

  // continuous render loop — cheap when idle, necessary while playing
  useEffect(() => {
    let raf = 0
    const draw = () => {
      const canvas = canvasRef.current
      if (canvas) {
        const s = useEditor.getState()
        const { width, height } = s.project
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        const ctx = canvas.getContext('2d')!
        renderFrame(ctx, s.project, s.currentTime, previewFrames)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <div className="preview-wrap">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          style={{ aspectRatio: `${project.width} / ${project.height}` }}
        />
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
