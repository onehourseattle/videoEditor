import { useState } from 'react'
import { useEditor, projectDuration } from '../state/store'
import { EXPORT_PRESETS } from '../export/exporter'
import { useExportQueue } from '../export/queue'
import { playback } from '../engine/playback'

const PRESET_KEY = 'cutroom.exportPreset'

export function ExportDialog() {
  const project = useEditor((s) => s.project)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const toast = useEditor((s) => s.toast)
  const enqueue = useExportQueue((s) => s.enqueue)
  const [presetIdx, setPresetIdxState] = useState(() => {
    const saved = Number(localStorage.getItem(PRESET_KEY))
    return saved >= 0 && saved < EXPORT_PRESETS.length ? saved : 0
  })
  const setPresetIdx = (i: number) => {
    setPresetIdxState(i)
    try { localStorage.setItem(PRESET_KEY, String(i)) } catch { /* private mode */ }
  }
  const [includeAudio, setIncludeAudio] = useState(true)

  const duration = projectDuration(project)

  const start = () => {
    if (duration <= 0) {
      toast('Timeline is empty — add clips first', 'error')
      return
    }
    playback.pause()
    const preset = EXPORT_PRESETS[presetIdx]
    const label = `${project.name.replace(/[^\w.-]+/g, '_') || 'video'}_${preset.width}x${preset.height}.mp4`
    enqueue(project, { ...preset, includeAudio }, label)
    setExportOpen(false)
    toast('Export started — keep editing, progress is in the corner', 'info')
  }

  return (
    <div className="modal-backdrop" onClick={() => setExportOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export video</h2>
        <label className="field">Preset
          <select value={presetIdx} onChange={(e) => setPresetIdx(Number(e.target.value))}>
            {EXPORT_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} />
          Include audio (AAC)
        </label>
        <p className="hint">
          {formatEstimate(duration, EXPORT_PRESETS[presetIdx].videoBitrate, includeAudio)} · exports run in a
          background queue — you can keep editing, or line up several presets.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setExportOpen(false)}>Close</button>
          <button className="primary" onClick={start}>Export MP4</button>
        </div>
      </div>
    </div>
  )
}

function formatEstimate(seconds: number, videoBitrate: number, audio: boolean): string {
  if (seconds <= 0) return 'Timeline is empty'
  const bytes = (seconds * (videoBitrate + (audio ? 192_000 : 0))) / 8
  return `≈ ${Math.round(seconds)}s video, ~${(bytes / 1e6).toFixed(1)} MB`
}
