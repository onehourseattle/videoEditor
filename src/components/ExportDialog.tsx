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
  const [normalize, setNormalize] = useState(true)

  const duration = projectDuration(project)

  const start = () => {
    if (duration <= 0) {
      toast('Timeline is empty — add clips first', 'error')
      return
    }
    playback.pause()
    const preset = EXPORT_PRESETS[presetIdx]
    const label = `${project.name.replace(/[^\w.-]+/g, '_') || 'video'}_${preset.width}x${preset.height}.mp4`
    enqueue(project, { ...preset, includeAudio, normalizeAudio: normalize }, label)
    setExportOpen(false)
    toast('Export started — keep editing, progress is in the corner', 'info')
  }

  const startBatch = () => {
    if (duration <= 0) {
      toast('Timeline is empty — add clips first', 'error')
      return
    }
    playback.pause()
    const base = project.name.replace(/[^\w.-]+/g, '_') || 'video'
    // one edit, every placement: vertical, square, wide
    for (const preset of [EXPORT_PRESETS[0], EXPORT_PRESETS[2], EXPORT_PRESETS[3]]) {
      enqueue(project, { ...preset, includeAudio, normalizeAudio: normalize }, `${base}_${preset.width}x${preset.height}.mp4`)
    }
    setExportOpen(false)
    toast('3 exports queued (9:16, 1:1, 16:9) — progress is in the corner', 'info')
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
        <div style={{ display: 'flex', gap: 16 }}>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} />
            Include audio
          </label>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} title="Match the loudness target platforms normalize to">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} disabled={!includeAudio} />
            Normalize to −14 LUFS
          </label>
        </div>

        <Preflight presetIdx={presetIdx} />

        <p className="hint">
          {formatEstimate(duration, EXPORT_PRESETS[presetIdx].videoBitrate, includeAudio)} · exports run in a
          background queue — you can keep editing, or line up several presets.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="small ghost" title="Save the current frame as a PNG cover/thumbnail" onClick={() => void saveCover(project)}>
            🖼 Save cover frame
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setExportOpen(false)}>Close</button>
          <button onClick={startBatch} title="Queue 9:16 + 1:1 + 16:9 renditions">Batch 3 sizes</button>
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

/** Render the playhead frame at full project resolution → PNG download. */
async function saveCover(project: ReturnType<typeof useEditor.getState>['project']) {
  const { renderFrame } = await import('../engine/compositor')
  const { previewFrames } = await import('../engine/playback')
  const t = useEditor.getState().currentTime
  const canvas = document.createElement('canvas')
  canvas.width = project.width
  canvas.height = project.height
  renderFrame(canvas.getContext('2d')!, project, t, previewFrames)
  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${project.name.replace(/[^\w.-]+/g, '_') || 'video'}_cover.png`
    a.click()
    URL.revokeObjectURL(a.href)
  }, 'image/png')
}

/** Publish-readiness checks per platform — the agency QA sheet. */
function Preflight({ presetIdx }: { presetIdx: number }) {
  const project = useEditor((s) => s.project)
  const duration = projectDuration(project)
  const clips = project.tracks.flatMap((t) => t.clips)
  const preset = EXPORT_PRESETS[presetIdx]
  const vertical = preset.height > preset.width

  const hasAudio = clips.some((c) => (c.kind === 'video' || c.kind === 'audio') && !c.muted && c.volume > 0)
  const hasCaptions = clips.some((c) => c.kind === 'caption')
  const hookText = clips.some(
    (c) => (c.kind === 'text' || c.kind === 'caption' || c.kind === 'sticker') && c.start < 3,
  )
  const aspectMatch =
    Math.abs(preset.width / preset.height - project.width / project.height) < 0.01

  const checks: { ok: boolean; label: string }[] = [
    { ok: duration > 0 && duration <= (vertical ? 180 : 660), label: duration > 0 ? `Duration ${Math.round(duration)}s — ${vertical ? 'fits Reels (≤90s counts double-check) / TikTok / Shorts (≤180s)' : 'fine for YouTube'}` : 'Timeline is empty' },
    { ok: hookText, label: hookText ? 'Hook: on-screen text in the first 3s' : 'No text/captions in the first 3 seconds — weak hook' },
    { ok: hasCaptions, label: hasCaptions ? 'Captions present (most social video is watched muted)' : 'No captions — most social video plays muted' },
    { ok: hasAudio, label: hasAudio ? 'Audio present' : 'Export has no audio' },
    { ok: aspectMatch, label: aspectMatch ? 'Canvas matches export aspect' : 'Canvas aspect differs from preset — output will letterbox' },
  ]

  return (
    <div className="preflight">
      {checks.map((c) => (
        <div key={c.label} className={`pf-row ${c.ok ? 'ok' : 'warn'}`}>
          <span>{c.ok ? '✓' : '⚠︎'}</span> {c.label}
        </div>
      ))}
    </div>
  )
}
