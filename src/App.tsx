import { useEffect } from 'react'
import { useEditor, type PanelTab } from './state/store'
import {
  saveProjectRecord, loadProjectRecord, loadLegacyAutosave, lastProjectId,
} from './state/persistence'
import { assetStore } from './state/assetStore'
import { TopBar } from './components/TopBar'
import { Preview } from './components/Preview'
import { Timeline } from './components/Timeline'
import { Inspector } from './components/Inspector'
import { MediaPanel } from './components/panels/MediaPanel'
import { TextPanel } from './components/panels/TextPanel'
import { ChartsPanel } from './components/panels/ChartsPanel'
import { StickersPanel } from './components/panels/StickersPanel'
import { AIPanel } from './components/panels/AIPanel'
import { ScriptPanel } from './components/panels/ScriptPanel'
import { ExportDialog } from './components/ExportDialog'
import { ExportTray } from './components/ExportTray'
import { HelpOverlay } from './components/HelpOverlay'
import { ProjectsModal } from './components/ProjectsModal'
import { Toasts } from './components/Toasts'
import { useShortcuts } from './hooks/useShortcuts'

let restoredOnce = false

const TABS: { id: PanelTab; icon: string; label: string }[] = [
  { id: 'media', icon: '🎬', label: 'Media' },
  { id: 'text', icon: '🅣', label: 'Text' },
  { id: 'charts', icon: '📈', label: 'Charts' },
  { id: 'stickers', icon: '😀', label: 'Stick' },
  { id: 'ai', icon: '✨', label: 'AI' },
  { id: 'script', icon: '⌘', label: 'Script' },
]

export function App() {
  const activePanel = useEditor((s) => s.activePanel)
  const setPanel = useEditor((s) => s.setPanel)
  const exportOpen = useEditor((s) => s.exportOpen)
  const helpOpen = useEditor((s) => s.helpOpen)
  const projectsOpen = useEditor((s) => s.projectsOpen)
  const project = useEditor((s) => s.project)

  useShortcuts()

  // restore the last project once on boot — media blobs rehydrate from IndexedDB
  useEffect(() => {
    if (restoredOnce) return
    restoredOnce = true
    void (async () => {
      const s = useEditor.getState()
      const last = lastProjectId()
      let saved = last ? await loadProjectRecord(last) : null
      if (!saved) saved = loadLegacyAutosave()
      if (!saved) {
        await saveProjectRecord(s.project) // register the fresh project
        return
      }
      const { assets, missing } = await assetStore.rehydrateAssets(saved.assets)
      s.replaceProject({ ...saved, assets })
      if (missing.length) {
        s.toast(`${missing.length} media file(s) missing — re-import them in the Media panel`, 'error')
      }
    })()
  }, [])

  // debounced autosave into the project's IndexedDB record
  useEffect(() => {
    const id = setTimeout(() => void saveProjectRecord(project), 800)
    return () => clearTimeout(id)
  }, [project])

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <nav className="sidebar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={activePanel === t.id ? 'active' : ''}
              onClick={() => setPanel(t.id)}
              title={t.label}
            >
              {t.icon}
              <small>{t.label}</small>
            </button>
          ))}
        </nav>
        {activePanel && (
          <aside className="panel">
            {activePanel === 'media' && <MediaPanel />}
            {activePanel === 'text' && <TextPanel />}
            {activePanel === 'charts' && <ChartsPanel />}
            {activePanel === 'stickers' && <StickersPanel />}
            {activePanel === 'ai' && <AIPanel />}
            {activePanel === 'script' && <ScriptPanel />}
          </aside>
        )}
        <div className="center">
          <Preview />
          <Timeline />
        </div>
        <Inspector />
      </div>
      {exportOpen && <ExportDialog />}
      {helpOpen && <HelpOverlay />}
      {projectsOpen && <ProjectsModal />}
      <ExportTray />
      <Toasts />
    </div>
  )
}
