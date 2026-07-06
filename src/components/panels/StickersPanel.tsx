import type { ShapeClip, StickerClip } from '../../types/model'
import { defaultTransform } from '../../types/model'
import { useEditor, addClipToTrack } from '../../state/store'
import { uid } from '../../utils/id'

const EMOJIS = [
  '🔥', '❤️', '😂', '😍', '💯', '👀', '🎉', '✨', '💀', '😭',
  '👍', '👏', '🙌', '🤯', '😱', '🚀', '💰', '⚡️', '🏆', '⭐️',
  '💪', '🤣', '😎', '🥶', '☝️', '⬇️', '➡️', '❗️', '❓', '💥',
]

export function StickersPanel() {
  const updateProject = useEditor((s) => s.updateProject)
  const select = useEditor((s) => s.select)

  const addSticker = (emoji: string) => {
    const s = useEditor.getState()
    const track = s.project.tracks.find((t) => t.kind === 'overlay')
    if (!track) return
    const clip: StickerClip = {
      id: uid('clip'), kind: 'sticker', name: emoji, emoji,
      start: s.currentTime, duration: 2, animation: 'pulse',
      transform: defaultTransform(), effects: [],
    }
    updateProject((p) => addClipToTrack(p, track.id, clip))
    select([clip.id])
  }

  const addShape = (shape: ShapeClip['shape']) => {
    const s = useEditor.getState()
    const track = s.project.tracks.find((t) => t.kind === 'overlay')
    if (!track) return
    const clip: ShapeClip = {
      id: uid('clip'), kind: 'shape', name: shape, shape,
      start: s.currentTime, duration: 3,
      fill: shape === 'arrow' || shape === 'line' ? 'transparent' : 'rgba(108,92,231,0.85)',
      stroke: '#ffffff', strokeWidth: shape === 'arrow' || shape === 'line' ? 14 : 0,
      width: 0.4, height: shape === 'line' || shape === 'arrow' ? 0.02 : 0.2,
      transform: defaultTransform(), effects: [],
    }
    updateProject((p) => addClipToTrack(p, track.id, clip))
    select([clip.id])
  }

  return (
    <>
      <h3>Stickers</h3>
      <p className="hint">Animated emoji stickers — drop at the playhead, position with transform x/y.</p>
      <div className="sticker-grid">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => addSticker(e)}>{e}</button>
        ))}
      </div>
      <h4>Shapes</h4>
      <div className="preset-grid">
        <div className="preset-card" onClick={() => addShape('rect')}>▭ Rect</div>
        <div className="preset-card" onClick={() => addShape('circle')}>◯ Circle</div>
        <div className="preset-card" onClick={() => addShape('arrow')}>→ Arrow</div>
        <div className="preset-card" onClick={() => addShape('line')}>— Line</div>
      </div>
    </>
  )
}
