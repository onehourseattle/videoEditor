import { useRef } from 'react'
import { useEditor, emptyProject } from '../state/store'
import { loadProjectFile, saveProjectFile } from '../state/persistence'
import { ASPECT_PRESETS } from '../types/model'

export function TopBar() {
  const project = useEditor((s) => s.project)
  const busy = useEditor((s) => s.busy)
  const updateProject = useEditor((s) => s.updateProject)
  const replaceProject = useEditor((s) => s.replaceProject)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)

  const aspectValue = `${project.width}x${project.height}`

  return (
    <header className="topbar">
      <div className="logo">Cut<span>Room</span></div>
      <input
        className="project-name"
        value={project.name}
        onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }), { transient: true })}
      />
      <select
        value={aspectValue}
        title="Canvas size"
        onChange={(e) => {
          const [w, h] = e.target.value.split('x').map(Number)
          updateProject((p) => ({ ...p, width: w, height: h }))
        }}
      >
        {ASPECT_PRESETS.map((a) => (
          <option key={a.name} value={`${a.width}x${a.height}`}>{a.name}</option>
        ))}
        {!ASPECT_PRESETS.some((a) => `${a.width}x${a.height}` === aspectValue) && (
          <option value={aspectValue}>{project.width}×{project.height}</option>
        )}
      </select>
      <div className="spacer" />
      {busy && <div className="busy-pill">{busy}</div>}
      <button className="ghost" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">↩︎</button>
      <button className="ghost" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↪︎</button>
      <button onClick={() => { if (confirm('Start a new project? Unsaved work is kept in autosave.')) replaceProject(emptyProject()) }}>New</button>
      <button onClick={() => fileRef.current?.click()}>Open</button>
      <button onClick={() => saveProjectFile(project)}>Save</button>
      <button className="primary" onClick={() => setExportOpen(true)}>Export</button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          try {
            replaceProject(await loadProjectFile(f))
            alert('Project loaded. Re-import its media files in the Media panel to re-link them (names must match).')
          } catch (err) {
            alert(`Could not open project: ${err instanceof Error ? err.message : err}`)
          }
          e.target.value = ''
        }}
      />
    </header>
  )
}
