import type { ChartClip, ChartType } from '../../types/model'
import { defaultTransform } from '../../types/model'
import { useEditor, addClipToTrack } from '../../state/store'
import { defaultChartSpec } from '../../engine/chartRenderer'
import { uid } from '../../utils/id'

const CHART_KINDS: { type: ChartType; label: string; sub: string }[] = [
  { type: 'counter', label: '❤️ Counter', sub: 'likes / subs count-up' },
  { type: 'line', label: '📈 Line', sub: 'growth over time' },
  { type: 'area', label: '⛰ Area', sub: 'filled growth curve' },
  { type: 'bar', label: '📊 Bars', sub: 'compare platforms' },
  { type: 'barRace', label: '🏁 Bar race', sub: 'animated ranking' },
  { type: 'donut', label: '🍩 Donut', sub: 'audience split' },
  { type: 'progress', label: '🎯 Progress', sub: 'goal tracker' },
  { type: 'sparkline', label: '〰 Sparkline', sub: 'minimal trend' },
]

export function ChartsPanel() {
  const updateProject = useEditor((s) => s.updateProject)
  const select = useEditor((s) => s.select)

  const add = (type: ChartType) => {
    const s = useEditor.getState()
    const track = s.project.tracks.find((t) => t.kind === 'overlay')
    if (!track) return
    const spec = defaultChartSpec(type)
    const clip: ChartClip = {
      id: uid('clip'), kind: 'chart', name: spec.title || type,
      start: s.currentTime, duration: 5, spec,
      transform: defaultTransform(), effects: [],
    }
    updateProject((p) => addClipToTrack(p, track.id, clip))
    select([clip.id])
  }

  return (
    <>
      <h3>Charts & graphics</h3>
      <p className="hint">
        Animated, data-driven overlays rendered straight into the video. Edit
        the numbers in the Inspector (label:value per line).
      </p>
      <div className="preset-grid">
        {CHART_KINDS.map((c) => (
          <div key={c.type} className="preset-card" onClick={() => add(c.type)}>
            {c.label}
            <div className="sub">{c.sub}</div>
          </div>
        ))}
      </div>
    </>
  )
}
