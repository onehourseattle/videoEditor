import { useRef } from 'react'
import { useEditor } from '../state/store'
import { loadProjectFile, saveProjectFile } from '../state/persistence'
import { assetStore } from '../state/assetStore'
import { ASPECT_PRESETS } from '../types/model'

export function TopBar() {
  const project = useEditor((s) => s.project)
  const busy = useEditor((s) => s.busy)
  const theme = useEditor((s) => s.theme)
  const setTheme = useEditor((s) => s.setTheme)
  const toast = useEditor((s) => s.toast)
  const updateProject = useEditor((s) => s.updateProject)
  const replaceProject = useEditor((s) => s.replaceProject)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const setHelpOpen = useEditor((s) => s.setHelpOpen)
  const setProjectsOpen = useEditor((s) => s.setProjectsOpen)
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
      {busy && <div className="busy-pill"><span className="spinner" />{busy}</div>}
      <button className="ghost" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">↩︎</button>
      <button className="ghost" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↪︎</button>
      <button
        className="ghost"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      <button className="ghost" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">?</button>
      <button onClick={() => setProjectsOpen(true)}>Projects</button>
      <button className="ghost" onClick={() => fileRef.current?.click()} title="Import a .cutroom.json project file">Open file</button>
      <button className="ghost" onClick={() => { saveProjectFile(project); toast('Project exported as JSON (autosave is automatic)', 'ok') }} title="Export project as a JSON file">Save file</button>
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
            const proj = await loadProjectFile(f)
            const { assets, missing } = await assetStore.rehydrateAssets(proj.assets)
            replaceProject({ ...proj, assets })
            toast(
              missing.length
                ? `Project loaded — re-import ${missing.length} media file(s) (same names) to re-link`
                : 'Project loaded',
              missing.length ? 'info' : 'ok',
            )
          } catch (err) {
            toast(`Could not open project: ${err instanceof Error ? err.message : err}`, 'error')
          }
          e.target.value = ''
        }}
      />
    </header>
  )
}
