import { useEffect } from 'react'
import { useEditor, splitClipAt, removeClips, findClip, addClipToTrack } from '../state/store'
import { playback } from '../engine/playback'
import { uid } from '../utils/id'

/**
 * Global keyboard shortcuts:
 *  Space play/pause · S or Cmd+B split at playhead · Delete remove selection
 *  Cmd+Z / Shift+Cmd+Z undo/redo · Cmd+D duplicate · ←/→ frame step · Home start
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const s = useEditor.getState()
      const meta = e.metaKey || e.ctrlKey

      if (e.code === 'Space') {
        e.preventDefault()
        playback.toggle()
      } else if (meta && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if ((e.key === 's' && !meta) || (meta && e.key === 'b')) {
        e.preventDefault()
        for (const id of s.selectedClipIds) {
          s.updateProject((p) => splitClipAt(p, id, s.currentTime))
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (s.selectedClipIds.length) {
          e.preventDefault()
          s.updateProject((p) => removeClips(p, s.selectedClipIds))
          s.select([])
        }
      } else if (meta && e.key === 'd') {
        e.preventDefault()
        for (const id of s.selectedClipIds) {
          const found = findClip(s.project, id)
          if (found) {
            const copy = structuredClone(found.clip)
            copy.id = uid('clip')
            copy.start = found.clip.start + found.clip.duration
            s.updateProject((p) => addClipToTrack(p, found.track.id, copy))
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = (e.shiftKey ? 10 : 1) / s.project.fps
        playback.seek(s.currentTime + (e.key === 'ArrowLeft' ? -step : step))
      } else if (e.key === 'Home') {
        playback.seek(0)
      } else if (e.key === '?') {
        e.preventDefault()
        s.setHelpOpen(!s.helpOpen)
      } else if (e.key === 'Escape') {
        if (s.helpOpen) s.setHelpOpen(false)
        else if (s.exportOpen) s.setExportOpen(false)
        else s.select([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
