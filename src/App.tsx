import { useEffect } from 'react'
import { useEditor, projectDuration, type PanelTab } from './state/store'
import { autosave, loadAutosave } from './state/persistence'
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
  const project = useEditor((s) => s.project)

  useShortcuts()

  // restore the last session once on boot (media re-links by filename on import)
  useEffect(() => {
    if (restoredOnce) return
    restoredOnce = true
    const s = useEditor.getState()
    const saved = loadAutosave()
    const currentEmpty = projectDuration(s.project) === 0 && Object.keys(s.project.assets).length === 0
    if (saved && currentEmpty && (projectDuration(saved) > 0 || Object.keys(saved.assets).length > 0)) {
      s.replaceProject(saved)
    }
  }, [])

  // debounced autosave
  useEffect(() => {
    const id = setTimeout(() => autosave(project), 800)
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
    </div>
  )
}
