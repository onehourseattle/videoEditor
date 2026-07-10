import type { TextClip } from '../../types/model'
import { defaultTransform } from '../../types/model'
import { useEditor, addClipToTrack } from '../../state/store'
import { TEXT_PRESETS, HEADLINE_PRESETS, makePresetStyle } from '../../engine/textRenderer'
import { uid } from '../../utils/id'

export function TextPanel() {
  const updateProject = useEditor((s) => s.updateProject)
  const select = useEditor((s) => s.select)

  const add = (text: string, style: Parameters<typeof makePresetStyle>[0], animation: TextClip['animation'], y: number) => {
    const s = useEditor.getState()
    const track = s.project.tracks.find((t) => t.kind === 'overlay')
    if (!track) return
    const transform = defaultTransform()
    transform.y = [{ t: 0, value: y, easing: 'linear' }]
    const clip: TextClip = {
      id: uid('clip'), kind: 'text', name: text,
      start: s.currentTime, duration: 3,
      text,
      style: makePresetStyle(style),
      animation,
      animationDuration: 0.6,
      transform,
      effects: [],
    }
    updateProject((p) => addClipToTrack(p, track.id, clip))
    select([clip.id])
  }

  return (
    <>
      <h3>Text</h3>
      <p className="hint">Click a preset to drop it at the playhead, then edit the words in the Inspector.</p>

      <h4>Headlines</h4>
      <div className="headline-list">
        {HEADLINE_PRESETS.map((p) => (
          <div
            key={p.label}
            className="headline-card"
            title={p.label}
            onClick={() => add(p.sample, p.style, p.animation, -420)}
          >
            <span className="hl-sample" style={p.css}>{p.sample}</span>
            <span className="hl-label">{p.label} · {p.animation}</span>
          </div>
        ))}
      </div>

      <h4>Captions & stickers text</h4>
      <div className="preset-grid">
        {TEXT_PRESETS.map((p) => (
          <div key={p.label} className="preset-card" onClick={() => add('Your text', p.style, p.animation, 0)}>
            {p.label}
            <div className="sub">{p.animation}</div>
          </div>
        ))}
      </div>
    </>
  )
}
