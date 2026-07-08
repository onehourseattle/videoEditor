import { useEffect, useState } from 'react'
import { useEditor, emptyProject } from '../state/store'
import {
  listProjects, listTemplates, loadProjectRecord, deleteProjectRecord, duplicateProjectRecord,
  saveProjectRecord, saveAsTemplate, projectFromTemplate,
  type ProjectSummary,
} from '../state/persistence'
import { BUILTIN_TEMPLATES } from '../state/builtinTemplates'
import { assetStore } from '../state/assetStore'
import { formatTime } from '../utils/time'
import { uid } from '../utils/id'

export function ProjectsModal() {
  const setProjectsOpen = useEditor((s) => s.setProjectsOpen)
  const toast = useEditor((s) => s.toast)
  const currentId = useEditor((s) => s.project.id)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [templates, setTemplates] = useState<ProjectSummary[]>([])

  const refresh = () => {
    void listProjects().then(setProjects)
    void listTemplates().then(setTemplates)
  }
  useEffect(refresh, [])

  const openFresh = async (proj: ReturnType<typeof emptyProject>) => {
    const s = useEditor.getState()
    await saveProjectRecord(s.project)
    s.replaceProject(proj)
    await saveProjectRecord(proj)
    setProjectsOpen(false)
  }

  const useBuiltin = (idx: number) => {
    const proj = BUILTIN_TEMPLATES[idx].build()
    void openFresh(proj)
    toast(`"${proj.name}" ready — drop your footage on the Video track`, 'ok')
  }

  const useSaved = async (id: string) => {
    const proj = await projectFromTemplate(id, uid('proj'))
    if (!proj) return
    const { assets } = await assetStore.rehydrateAssets(proj.assets)
    await openFresh({ ...proj, assets })
    toast(`Template applied — this is a fresh project`, 'ok')
  }

  const saveTemplate = async () => {
    const s = useEditor.getState()
    const name = prompt('Template name:', `${s.project.name || 'My'} template`)
    if (!name) return
    await saveAsTemplate(s.project, name, uid('tpl'))
    refresh()
    toast(`Template "${name}" saved — reuse it from this menu`, 'ok')
  }

  const openProject = async (id: string) => {
    if (id === currentId) {
      setProjectsOpen(false)
      return
    }
    const s = useEditor.getState()
    await saveProjectRecord(s.project) // never lose the one you're leaving
    const proj = await loadProjectRecord(id)
    if (!proj) {
      toast('Could not load that project', 'error')
      return
    }
    const { assets, missing } = await assetStore.rehydrateAssets(proj.assets)
    s.replaceProject({ ...proj, assets })
    await saveProjectRecord({ ...proj, assets }) // updates "last opened"
    if (missing.length) toast(`${missing.length} media file(s) missing — re-import them`, 'error')
    setProjectsOpen(false)
  }

  const newProject = async () => {
    const s = useEditor.getState()
    await saveProjectRecord(s.project)
    const fresh = emptyProject()
    s.replaceProject(fresh)
    await saveProjectRecord(fresh)
    setProjectsOpen(false)
  }

  return (
    <div className="modal-backdrop" onClick={() => setProjectsOpen(false)}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ flex: 1 }}>Projects</h2>
          <button
            className="small"
            title="Everything — project + media — in one portable .cutroompkg file"
            onClick={async () => {
              const s = useEditor.getState()
              const { exportArchive } = await import('../state/archive')
              toast('Packing project + media…', 'info')
              const blob = await exportArchive(s.project)
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `${s.project.name.replace(/[^\w.-]+/g, '_') || 'project'}.cutroompkg`
              a.click()
              URL.revokeObjectURL(a.href)
              toast(`Archive saved (${(blob.size / 1e6).toFixed(1)} MB) — restores with Open file`, 'ok')
            }}
          >⤓ Archive current</button>
          <button className="primary" onClick={() => void newProject()}>+ New project</button>
        </div>
        {projects === null ? (
          <p className="hint">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="hint">No saved projects yet — everything you edit autosaves here.</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <div
                key={p.id}
                className={`project-card ${p.id === currentId ? 'current' : ''}`}
                onClick={() => void openProject(p.id)}
              >
                {p.thumb ? <img src={p.thumb} alt="" /> : <div className="ph">🎬</div>}
                <div className="pc-meta">
                  <div className="pc-name">{p.name || 'Untitled'}</div>
                  <div className="pc-sub">
                    {p.width}×{p.height} · {formatTime(p.duration)} · {timeAgo(p.updatedAt)}
                    {p.id === currentId ? ' · open now' : ''}
                  </div>
                </div>
                <div className="pc-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="small ghost" title="Duplicate"
                    onClick={() => void duplicateProjectRecord(p.id, uid('proj')).then(refresh)}>⧉</button>
                  <button className="small ghost" title="Delete" disabled={p.id === currentId}
                    onClick={() => {
                      if (confirm(`Delete "${p.name || 'Untitled'}"? This cannot be undone.`)) {
                        void deleteProjectRecord(p.id).then(refresh)
                      }
                    }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ flex: 1, fontSize: 14 }}>Templates</h2>
          <button className="small" onClick={() => void saveTemplate()}>＋ Save current as template</button>
        </div>
        <div className="preset-grid">
          {BUILTIN_TEMPLATES.map((t, i) => (
            <div key={t.name} className="preset-card" onClick={() => useBuiltin(i)}>
              {t.name}
              <div className="sub">{t.sub}</div>
            </div>
          ))}
          {templates.map((t) => (
            <div key={t.id} className="preset-card" onClick={() => void useSaved(t.id)}>
              {t.name}
              <div className="sub">
                yours · {formatTime(t.duration)}{' '}
                <button
                  className="small ghost"
                  style={{ padding: '0 4px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete template "${t.name}"?`)) void deleteProjectRecord(t.id).then(refresh)
                  }}
                >🗑</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setProjectsOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  )
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
