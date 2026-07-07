import { useEditor } from '../state/store'

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['S  or  ⌘B', 'Split selected clip at playhead'],
  ['⌫ / Delete', 'Delete selected clips'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['⌘D', 'Duplicate selected clip'],
  ['← / →', 'Step one frame (⇧ = 10 frames)'],
  ['Home', 'Jump to start'],
  ['⌘ + scroll', 'Zoom the timeline at the cursor'],
  ['Scroll on preview', 'Resize the selected overlay'],
  ['Drag on preview', 'Move the selected overlay'],
  ['Right-click a clip', 'Split · duplicate · mute · delete'],
  ['Double-click track name', 'Rename track'],
  ['?', 'Toggle this sheet'],
]

export function HelpOverlay() {
  const setHelpOpen = useEditor((s) => s.setHelpOpen)
  return (
    <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard & mouse</h2>
        <div className="shortcut-grid">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="shortcut-row">
              <kbd>{keys}</kbd>
              <span>{what}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setHelpOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  )
}
