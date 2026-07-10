import { Component, type ReactNode } from 'react'
import { useEditor } from '../state/store'
import { saveProjectFile, saveProjectRecord } from '../state/persistence'

interface State {
  error: Error | null
}

/**
 * Last line of defense: an uncaught render error shows a recovery panel
 * instead of a white screen. The project is autosaved continuously, and the
 * panel offers an extra on-disk backup before reloading.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('CutRoom crashed:', error)
    // one best-effort save of the current state before anything else
    try { void saveProjectRecord(useEditor.getState().project) } catch { /* already saving */ }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <h2>Something broke — your edit is safe</h2>
          <p>
            The editor hit an unexpected error. Your project autosaves
            continuously, so reloading will bring you right back.
          </p>
          <pre>{this.state.error.message}</pre>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { try { saveProjectFile(useEditor.getState().project) } catch { /* best effort */ } }}>
              Download project backup
            </button>
            <button className="primary" onClick={() => location.reload()}>Reload editor</button>
          </div>
        </div>
      </div>
    )
  }
}
