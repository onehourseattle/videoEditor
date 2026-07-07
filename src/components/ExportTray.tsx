import { useExportQueue } from '../export/queue'

export function ExportTray() {
  const jobs = useExportQueue((s) => s.jobs)
  const cancel = useExportQueue((s) => s.cancel)
  const remove = useExportQueue((s) => s.remove)
  const clearFinished = useExportQueue((s) => s.clearFinished)
  if (!jobs.length) return null

  const anyFinished = jobs.some((j) => j.status !== 'running' && j.status !== 'queued')

  return (
    <div className="export-tray">
      <div className="tray-head">
        <span>Exports</span>
        {anyFinished && <button className="small ghost" onClick={clearFinished}>Clear</button>}
      </div>
      {jobs.map((j) => (
        <div key={j.id} className="tray-job">
          <div className="tj-top">
            <span className="tj-label" title={j.label}>{j.label}</span>
            {j.status === 'running' || j.status === 'queued' ? (
              <button className="small ghost" onClick={() => cancel(j.id)}>Cancel</button>
            ) : (
              <>
                {j.status === 'done' && j.url && (
                  <a className="tj-dl" href={j.url} download={j.label}>↓ Save</a>
                )}
                <button className="small ghost" onClick={() => remove(j.id)}>✕</button>
              </>
            )}
          </div>
          {j.status === 'running' && (
            <div className="progress-bar">
              <div style={{ width: `${Math.round((j.progress?.progress ?? 0) * 100)}%` }} />
            </div>
          )}
          <div className="tj-sub">
            {j.status === 'queued' && 'Waiting…'}
            {j.status === 'running' &&
              `${j.progress?.phase === 'audio' ? 'Mixing audio' : j.progress?.phase === 'muxing' ? 'Finalizing' : 'Rendering'} — ${Math.round((j.progress?.progress ?? 0) * 100)}%`}
            {j.status === 'done' && `Done · ${((j.size ?? 0) / 1e6).toFixed(1)} MB`}
            {j.status === 'error' && <span style={{ color: 'var(--danger)' }}>{j.error}</span>}
            {j.status === 'cancelled' && 'Cancelled'}
          </div>
        </div>
      ))}
    </div>
  )
}
