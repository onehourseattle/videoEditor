import { useState } from 'react'
import { useEditor, findClip, splitClipAt, replaceClip } from '../../state/store'
import { createScriptApi } from '../../scripting/api'
import { speechActivity, duckKeyframes, denoiseAsset, DEFAULT_DUCK } from '../../ai/audioPro'
import { findShortSegments, createShortsProjects, captureSegmentThumbs, type ShortSegment } from '../../ai/shorts'
import type { VideoClip } from '../../types/model'
import { assetStore } from '../../state/assetStore'
import { formatTime } from '../../utils/time'

/**
 * One-click local AI tools. Each action targets the selected video clip
 * (or the first video clip on the timeline if nothing is selected).
 * Everything runs on-device: DSP for audio, frame-diff vision for video,
 * Whisper (ONNX) for speech.
 */
interface ShortsCandidates {
  clip: VideoClip
  segments: ShortSegment[]
  thumbs: string[]
}

export function AIPanel() {
  const setBusy = useEditor((s) => s.setBusy)
  const toast = useEditor((s) => s.toast)
  const [log, setLog] = useState<string[]>([])
  const [shorts, setShorts] = useState<ShortsCandidates | null>(null)

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
        toast('Add a video clip to the timeline first (Media panel)', 'error')
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
        toast(`${label} done`, 'ok')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setLog((l) => [...l.slice(-30), `✗ ${label}: ${msg}`])
        toast(`${label} failed: ${msg}`, 'error')
      } finally {
        setBusy(null)
      }
    }
  }

  const tools: { title: string; desc: string; action: () => Promise<void> }[] = [
    {
      title: '⭐️ Auto edit (one click)',
      desc: 'The whole pipeline: cut silences → cut filler words → generate captions → add gentle punch-in zooms. Filler/caption steps are skipped gracefully if the Whisper model isn\'t bundled.',
      action: run('Auto edit', async (api, id) => {
        await api.removeSilences(id)
        let captioned = false
        try {
          await api.removeFillerWords(id)
          await api.autoCaption(id)
          captioned = true
        } catch {
          api.log('Whisper model not bundled — skipped filler words + captions (run `npm run fetch-models`)')
        }
        // punch-in zooms: alternate 1.0 / 1.06 on each video clip for subtle energy
        const vids = api.clips({ kind: 'video' })
        vids.forEach((c, i) => {
          api.keyframe(c.id, 'scale', 0, i % 2 === 0 ? 1.0 : 1.06)
          api.keyframe(c.id, 'scale', Math.max(0.2, c.duration), i % 2 === 0 ? 1.06 : 1.0)
        })
        api.log(`Auto edit done: ${vids.length} clips${captioned ? ' + captions' : ''}`)
      }),
    },
    {
      title: '✂️➡️📱 Long video → Shorts',
      desc: 'Finds the most engaging moments (energy-scored, cuts snapped to natural pauses) and shows them as ranked cards — pick which become 9:16 projects.',
      action: run('Shorts splitter', async (api, id) => {
        const s = useEditor.getState()
        const found = findClip(s.project, id)
        if (!found || found.clip.kind !== 'video') return
        const asset = s.project.assets[found.clip.assetId]
        const assetDur = asset?.duration ?? 30
        const targetLen = Math.max(2, Math.min(30, assetDur / 2.5))
        const segs = await findShortSegments(found.clip.assetId, targetLen, 5)
        if (!segs.length) throw new Error('Could not find distinct segments — clip may be too short')
        const ranked = [...segs].sort((a, b) => b.score - a.score)
        const thumbs = asset ? await captureSegmentThumbs(asset, ranked) : ranked.map(() => '')
        setShorts({ clip: found.clip, segments: ranked, thumbs })
        api.log(`${ranked.length} candidate moments found — pick your Shorts`)
      }),
    },
    {
      title: '🎚 Auto-duck music',
      desc: 'Detects speech in your footage and dips every music track under it (with smooth attack/release). Volume envelopes land on the audio clips — undoable.',
      action: run('Auto-duck', async (api) => {
        const s = useEditor.getState()
        const activity = await speechActivity(s.project)
        if (!activity.some((a) => a.active)) throw new Error('No speech detected in video clips')
        let ducked = 0
        s.updateProject((p) => {
          let next = p
          for (const track of p.tracks) {
            if (track.kind !== 'audio') continue
            for (const c of track.clips) {
              if (c.kind !== 'audio') continue
              const kfs = duckKeyframes(c, activity, DEFAULT_DUCK)
              if (kfs.length) {
                next = replaceClip(next, c.id, (cl) => (cl.kind === 'audio' ? { ...cl, gain: kfs } : cl))
                ducked++
              }
            }
          }
          return next
        })
        if (!ducked) throw new Error('No music clips on audio tracks to duck')
        api.log(`Ducked ${ducked} music clip(s) under speech`)
      }),
    },
    {
      title: '🧹 Reduce noise',
      desc: 'Spectral noise gate: learns the room tone from the quietest moments and subtracts it — hiss, hum and fan noise drop away. Applies to playback and export; restorable.',
      action: run('Noise reduction', async (api, id) => {
        const s = useEditor.getState()
        const found = findClip(s.project, id)
        if (!found || found.clip.kind !== 'video') return
        const assetId = found.clip.assetId
        if (assetStore.hasProcessedAudio(assetId)) {
          assetStore.restoreOriginalAudio(assetId)
          api.log('Restored the original (unprocessed) audio')
          return
        }
        const cleaned = await denoiseAsset(assetId, 1.0)
        if (!cleaned) throw new Error('No decodable audio on this clip')
        assetStore.setProcessedAudio(assetId, cleaned)
        api.log('Noise reduced — run again to restore the original')
      }),
    },
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
      {shorts && <ShortsTriage data={shorts} close={() => setShorts(null)} />}
    </>
  )
}

/** Opus-style triage: ranked candidate cards; pick which become projects. */
function ShortsTriage({ data, close }: { data: ShortsCandidates; close: () => void }) {
  const toast = useEditor((s) => s.toast)
  const [creating, setCreating] = useState(false)
  const maxScore = Math.max(...data.segments.map((s) => s.score), 0.0001)

  const create = async (segs: ShortSegment[]) => {
    setCreating(true)
    try {
      const s = useEditor.getState()
      const names = await createShortsProjects(s.project, data.clip, segs)
      toast(`${names.length} Short project(s) created — open them from Projects`, 'ok')
      close()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Pick your Shorts</h2>
        <p className="hint">
          Ranked by hook energy (loudness + dynamics), edges snapped to natural
          pauses. Each becomes its own 9:16 project.
        </p>
        <div className="shorts-grid">
          {data.segments.map((seg, i) => (
            <div key={i} className="shorts-card">
              {data.thumbs[i] ? <img src={data.thumbs[i]} alt="" /> : <div className="ph">🎬</div>}
              <div className="sc-meta">
                <div className="sc-title">#{i + 1} · {formatTime(seg.start)}–{formatTime(seg.end)}</div>
                <div className="sc-sub">{Math.round(seg.end - seg.start)}s</div>
                <div className="sc-score" title="Relative energy score">
                  <div style={{ width: `${Math.round((seg.score / maxScore) * 100)}%` }} />
                </div>
              </div>
              <button className="small primary" disabled={creating} onClick={() => void create([seg])}>
                Create
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={close}>Close</button>
          <button className="primary" disabled={creating} onClick={() => void create(data.segments)}>
            Create all {data.segments.length}
          </button>
        </div>
      </div>
    </div>
  )
}
