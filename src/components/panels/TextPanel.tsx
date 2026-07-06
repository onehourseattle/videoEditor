import type { TextClip } from '../../types/model'
import { defaultTransform } from '../../types/model'
import { useEditor, addClipToTrack } from '../../state/store'
import { TEXT_PRESETS, makePresetStyle } from '../../engine/textRenderer'
import { uid } from '../../utils/id'

export function TextPanel() {
  const updateProject = useEditor((s) => s.updateProject)
  const select = useEditor((s) => s.select)

  const addText = (presetIdx: number) => {
    const s = useEditor.getState()
    const preset = TEXT_PRESETS[presetIdx]
    const track = s.project.tracks.find((t) => t.kind === 'overlay')
    if (!track) return
    const clip: TextClip = {
      id: uid('clip'), kind: 'text', name: 'Your text',
      start: s.currentTime, duration: 3,
      text: 'Your text',
      style: makePresetStyle(preset.style),
      animation: preset.animation,
      animationDuration: 0.5,
      transform: defaultTransform(),
      effects: [],
    }
    updateProject((p) => addClipToTrack(p, track.id, clip))
    select([clip.id])
  }

  return (
    <>
      <h3>Text</h3>
      <p className="hint">Click a preset to drop it at the playhead, then edit the words in the Inspector.</p>
      <div className="preset-grid">
        {TEXT_PRESETS.map((p, i) => (
          <div key={p.label} className="preset-card" onClick={() => addText(i)}>
            {p.label}
            <div className="sub">{p.animation}</div>
          </div>
        ))}
      </div>
    </>
  )
}
