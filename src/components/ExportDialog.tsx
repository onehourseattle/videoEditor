import { useRef, useState } from 'react'
import { useEditor } from '../state/store'
import { exportProject, EXPORT_PRESETS, type ExportProgress } from '../export/exporter'
import { playback } from '../engine/playback'

export function ExportDialog() {
  const project = useEditor((s) => s.project)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const [presetIdx, setPresetIdx] = useState(0)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef({ cancelled: false })

  const exporting = progress !== null && progress.phase !== 'done'

  const start = async () => {
    playback.pause()
    setError(null)
    cancelRef.current = { cancelled: false }
    const preset = EXPORT_PRESETS[presetIdx]
    try {
      const blob = await exportProject(
        project,
        { ...preset, includeAudio },
        setProgress,
        cancelRef.current,
      )
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${project.name.replace(/[^\w.-]+/g, '_') || 'video'}.mp4`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setProgress(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const phaseLabel =
    progress?.phase === 'audio' ? 'Mixing audio' :
    progress?.phase === 'video' ? 'Rendering frames' :
    progress?.phase === 'muxing' ? 'Finalizing MP4' :
    progress?.phase === 'done' ? 'Done — download started' : ''

  return (
    <div className="modal-backdrop" onClick={() => !exporting && setExportOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export video</h2>
        <label className="field">Preset
          <select value={presetIdx} onChange={(e) => setPresetIdx(Number(e.target.value))} disabled={exporting}>
            {EXPORT_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} disabled={exporting} />
          Include audio (AAC)
        </label>
        <p className="hint">
          Encodes H.264 MP4 entirely in this browser with WebCodecs — nothing
          leaves your Mac. Long timelines take roughly real-time or faster.
        </p>
        {progress && (
          <>
            <div className="progress-bar">
              <div style={{ width: `${Math.round(progress.progress * 100)}%` }} />
            </div>
            <p className="hint">{phaseLabel} — {Math.round(progress.progress * 100)}%</p>
          </>
        )}
        {error && <p className="hint" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {exporting ? (
            <button onClick={() => { cancelRef.current.cancelled = true }}>Cancel</button>
          ) : (
            <>
              <button onClick={() => setExportOpen(false)}>Close</button>
              <button className="primary" onClick={start}>Export MP4</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
