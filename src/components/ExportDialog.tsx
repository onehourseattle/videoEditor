import { useRef, useState } from 'react'
import { useEditor, projectDuration } from '../state/store'
import { exportProject, EXPORT_PRESETS, type ExportProgress } from '../export/exporter'
import { playback } from '../engine/playback'

const PRESET_KEY = 'cutroom.exportPreset'

export function ExportDialog() {
  const project = useEditor((s) => s.project)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const toast = useEditor((s) => s.toast)
  const [presetIdx, setPresetIdxState] = useState(() => {
    const saved = Number(localStorage.getItem(PRESET_KEY))
    return saved >= 0 && saved < EXPORT_PRESETS.length ? saved : 0
  })
  const setPresetIdx = (i: number) => {
    setPresetIdxState(i)
    try { localStorage.setItem(PRESET_KEY, String(i)) } catch { /* private mode */ }
  }
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
      toast(`Exported ${a.download} (${(blob.size / 1e6).toFixed(1)} MB)`, 'ok')
    } catch (e) {
      setProgress(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function formatEstimate(seconds: number, videoBitrate: number, audio: boolean): string {
    if (seconds <= 0) return 'Timeline is empty'
    const bytes = (seconds * (videoBitrate + (audio ? 192_000 : 0))) / 8
    return `≈ ${Math.round(seconds)}s video, ~${(bytes / 1e6).toFixed(1)} MB`
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
          {formatEstimate(projectDuration(project), EXPORT_PRESETS[presetIdx].videoBitrate, includeAudio)} · encoded
          entirely in this browser with WebCodecs — nothing leaves your machine.
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
