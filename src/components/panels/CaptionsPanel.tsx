import { useRef } from 'react'
import type { CaptionClip } from '../../types/model'
import { useEditor, replaceClip, removeClips, findClip, addClipToTrack } from '../../state/store'
import { createScriptApi } from '../../scripting/api'
import { CAPTION_TEMPLATES, applyTemplate } from '../../engine/captionTemplates'
import { toSrt, toVtt, parseSubtitles, cuesToCaptionClips, downloadText } from '../../utils/subtitles'
import { playback } from '../../engine/playback'
import { formatTime } from '../../utils/time'

export function CaptionsPanel() {
  const project = useEditor((s) => s.project)
  const updateProject = useEditor((s) => s.updateProject)
  const setBusy = useEditor((s) => s.setBusy)
  const toast = useEditor((s) => s.toast)
  const select = useEditor((s) => s.select)
  const subFileRef = useRef<HTMLInputElement>(null)

  const captionClips: CaptionClip[] = project.tracks
    .flatMap((t) => t.clips)
    .filter((c): c is CaptionClip => c.kind === 'caption')
    .sort((a, b) => a.start - b.start)

  const generate = async () => {
    const s = useEditor.getState()
    let video = null
    for (const id of s.selectedClipIds) {
      const f = findClip(s.project, id)
      if (f?.clip.kind === 'video') video = f.clip
    }
    if (!video) for (const t of s.project.tracks) for (const c of t.clips) if (c.kind === 'video') { video = c; break }
    if (!video) {
      toast('Add a video clip first (Media panel)', 'error')
      return
    }
    const api = createScriptApi((msg) => setBusy(msg))
    setBusy('Transcribing…')
    try {
      await api.autoCaption(video.id)
      toast('Captions generated — click any word below to edit it', 'ok')
    } catch (e) {
      toast(`Captions failed: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const applyToAll = (tplIdx: number) => {
    const tpl = CAPTION_TEMPLATES[tplIdx]
    if (!captionClips.length) {
      toast('No captions yet — generate or import them first', 'error')
      return
    }
    updateProject((p) => {
      let next = p
      for (const c of captionClips) next = replaceClip(next, c.id, (cl) => applyTemplate(cl as CaptionClip, tpl))
      return next
    })
    toast(`"${tpl.name}" applied to ${captionClips.length} caption clip(s)`, 'ok')
  }

  const importSubs = async (file: File) => {
    try {
      const cues = parseSubtitles(await file.text())
      if (!cues.length) throw new Error('no cues found')
      const clips = cuesToCaptionClips(cues)
      updateProject((p) => {
        const track = p.tracks.find((t) => t.kind === 'overlay') ?? p.tracks[0]
        return clips.reduce((acc, c) => addClipToTrack(acc, track.id, c), p)
      })
      toast(`Imported ${clips.length} caption cue(s)`, 'ok')
    } catch (e) {
      toast(`Could not import subtitles: ${e instanceof Error ? e.message : e}`, 'error')
    }
  }

  // ── word-level edits ──
  const setWordText = (clipId: string, idx: number, text: string) => {
    const clean = text.trim()
    updateProject((p) =>
      replaceClip(p, clipId, (c) =>
        c.kind !== 'caption' ? c : clean
          ? { ...c, words: c.words.map((w, i) => (i === idx ? { ...w, text: clean } : w)) }
          : { ...c, words: c.words.filter((_, i) => i !== idx) },
      ),
    )
  }

  const shiftClip = (clipId: string, delta: number) => {
    updateProject((p) => replaceClip(p, clipId, (c) => ({ ...c, start: Math.max(0, c.start + delta) })))
  }

  return (
    <>
      <h3>Captions</h3>
      <button className="primary" onClick={() => void generate()}>💬 Generate from speech</button>
      <div className="row" style={{ display: 'flex', gap: 6 }}>
        <button className="small" style={{ flex: 1 }} disabled={!captionClips.length}
          onClick={() => downloadText(`${project.name || 'captions'}.srt`, toSrt(project))}>↓ SRT</button>
        <button className="small" style={{ flex: 1 }} disabled={!captionClips.length}
          onClick={() => downloadText(`${project.name || 'captions'}.vtt`, toVtt(project))}>↓ VTT</button>
        <button className="small" style={{ flex: 1 }} onClick={() => subFileRef.current?.click()}>↑ Import</button>
        <input ref={subFileRef} type="file" hidden accept=".srt,.vtt,text/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSubs(f); e.target.value = '' }} />
      </div>

      <h4>Styles — applies to all captions</h4>
      <div className="preset-grid">
        {CAPTION_TEMPLATES.map((t, i) => (
          <div key={t.name} className="preset-card" onClick={() => applyToAll(i)}>
            {t.name}
            <div className="sub">{t.sub}</div>
          </div>
        ))}
      </div>

      <h4>Transcript {captionClips.length ? `— ${captionClips.reduce((n, c) => n + c.words.length, 0)} words` : ''}</h4>
      {!captionClips.length && (
        <p className="hint">
          Generate captions from speech (on-device Whisper) or import an SRT/VTT
          file. Every word becomes editable here: click to seek, type to fix,
          clear a word to cut it.
        </p>
      )}
      <div className="transcript">
        {captionClips.map((clip) => (
          <div key={clip.id} className="tr-block">
            <div className="tr-head">
              <span className="tr-time" onClick={() => { playback.seek(clip.start); select([clip.id]) }}>
                {formatTime(clip.start)}
              </span>
              <span style={{ flex: 1 }} />
              <button className="small ghost" title="Shift 0.1s earlier" onClick={() => shiftClip(clip.id, -0.1)}>−0.1s</button>
              <button className="small ghost" title="Shift 0.1s later" onClick={() => shiftClip(clip.id, 0.1)}>+0.1s</button>
              <button className="small ghost" title="Delete this caption clip"
                onClick={() => { updateProject((p) => removeClips(p, [clip.id])); }}>🗑</button>
            </div>
            <div className="tr-words">
              {clip.words.map((w, i) => (
                <span
                  key={`${clip.id}_${i}`}
                  className="tr-word"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onFocus={() => {
                    playback.seek(clip.start + w.start)
                    select([clip.id])
                  }}
                  onBlur={(e) => {
                    const text = e.currentTarget.textContent ?? ''
                    if (text.trim() !== w.text) setWordText(clip.id, i, text)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur() }
                  }}
                >{w.text}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
