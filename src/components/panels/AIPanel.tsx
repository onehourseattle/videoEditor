import { useState } from 'react'
import { useEditor, findClip, splitClipAt } from '../../state/store'
import { createScriptApi } from '../../scripting/api'

/**
 * One-click local AI tools. Each action targets the selected video clip
 * (or the first video clip on the timeline if nothing is selected).
 * Everything runs on-device: DSP for audio, frame-diff vision for video,
 * Whisper (ONNX) for speech.
 */
export function AIPanel() {
  const setBusy = useEditor((s) => s.setBusy)
  const [log, setLog] = useState<string[]>([])

  const targetClip = () => {
    const s = useEditor.getState()
    for (const id of s.selectedClipIds) {
      const f = findClip(s.project, id)
      if (f?.clip.kind === 'video') return f.clip
    }
    for (const t of s.project.tracks) for (const c of t.clips) if (c.kind === 'video') return c
    return null
  }

  const run = (label: string, fn: (api: ReturnType<typeof createScriptApi>, clipId: string) => Promise<unknown>) => {
    return async () => {
      const clip = targetClip()
      if (!clip) {
        alert('Add a video clip to the timeline first (Media panel).')
        return
      }
      const api = createScriptApi((msg) => {
        setBusy(msg)
        setLog((l) => [...l.slice(-30), msg])
      })
      setBusy(`${label}…`)
      try {
        await fn(api, clip.id)
        setLog((l) => [...l.slice(-30), `✓ ${label} done`])
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setLog((l) => [...l.slice(-30), `✗ ${label}: ${msg}`])
        alert(`${label} failed: ${msg}`)
      } finally {
        setBusy(null)
      }
    }
  }

  const tools: { title: string; desc: string; action: () => Promise<void> }[] = [
    {
      title: '💬 Auto captions',
      desc: 'Transcribes speech with on-device Whisper and adds karaoke-style word-timed captions. Requires the bundled model: run `npm run fetch-models` once. Zero network at runtime.',
      action: run('Auto captions', (api, id) => api.autoCaption(id)),
    },
    {
      title: '✂️ Remove silences',
      desc: 'Finds dead air with adaptive loudness analysis and ripple-deletes it — instant jump-cut style.',
      action: run('Remove silences', (api, id) => api.removeSilences(id)),
    },
    {
      title: '🚫 Cut filler words',
      desc: 'Transcribes, then cuts every "um", "uh" and stutter with word-level precision.',
      action: run('Cut filler words', (api, id) => api.removeFillerWords(id)),
    },
    {
      title: '🥁 Split on beats',
      desc: 'Detects beats in the clip\'s own audio (spectral flux) and splits on every 2nd beat — ready for beat-synced transitions.',
      action: run('Split on beats', async (api, id) => {
        const s = useEditor.getState()
        const found = findClip(s.project, id)
        if (!found || found.clip.kind !== 'video') return
        const clip = found.clip
        const beats = await api.detectBeats(clip.assetId)
        const cuts = beats
          .filter((_, i) => i % 2 === 0)
          .map((b) => clip.start + (b - clip.offset) / clip.speed)
          .filter((t) => t > clip.start + 0.2 && t < clip.start + clip.duration - 0.2)
        // split back-to-front so earlier splits don't invalidate positions
        let targetId = id
        for (const t of cuts.reverse()) {
          s.updateProject((p) => splitClipAt(p, targetId, t))
        }
        api.log(`Split at ${cuts.length} beats`)
      }),
    },
    {
      title: '🎬 Split at scene cuts',
      desc: 'Detects hard cuts in the footage (histogram analysis) and splits the clip at each one.',
      action: run('Scene detection', async (api, id) => {
        const s = useEditor.getState()
        const found = findClip(s.project, id)
        if (!found || found.clip.kind !== 'video') return
        const clip = found.clip
        const scenes = await api.detectScenes(clip.assetId)
        const cuts = scenes
          .map((sc) => clip.start + (sc - clip.offset) / clip.speed)
          .filter((t) => t > clip.start + 0.2 && t < clip.start + clip.duration - 0.2)
        for (const t of cuts.reverse()) s.updateProject((p) => splitClipAt(p, id, t))
        api.log(`Found ${cuts.length} scene cuts`)
      }),
    },
    {
      title: '📱 Auto-reframe',
      desc: 'Tracks the center of motion in wide footage and keyframes the crop so the action stays centered in 9:16.',
      action: run('Auto-reframe', (api, id) => api.autoReframe(id)),
    },
    {
      title: '⚡️ Auto highlights',
      desc: 'Scores the whole clip for energy (loudness + dynamics) and appends the top 3 moments as a highlight reel.',
      action: run('Auto highlights', async (api, id) => {
        const s = useEditor.getState()
        const found = findClip(s.project, id)
        if (!found || found.clip.kind !== 'video') return
        const clip = found.clip
        const highs = await api.findHighlights(clip.assetId, 3, 4)
        const track = s.project.tracks.find((t) => t.kind === 'video')
        if (!track) return
        let at = api.duration() + 0.5
        for (const h of highs) {
          const c = api.addVideoClip(clip.assetId, track.id, at, { offset: h.start, duration: h.end - h.start })
          api.setTransition(c.id, 'crossfade', 0.3)
          at += h.end - h.start
        }
        api.log(`Appended ${highs.length} highlights`)
      }),
    },
  ]

  return (
    <>
      <h3>AI tools — 100% on-device</h3>
      <p className="hint">
        Works on the selected video clip (or the first one on the timeline). No
        cloud, no API calls: audio DSP, frame analysis and Whisper all run
        locally.
      </p>
      {tools.map((t) => (
        <div key={t.title} className="ai-card">
          <div className="title">{t.title}</div>
          <div className="desc">{t.desc}</div>
          <button className="primary" onClick={t.action}>Run</button>
        </div>
      ))}
      {log.length > 0 && (
        <div className="script-log">
          {log.map((l, i) => (
            <div key={i} className={l.startsWith('✗') ? 'err' : l.startsWith('✓') ? 'ok' : ''}>{l}</div>
          ))}
        </div>
      )}
    </>
  )
}
