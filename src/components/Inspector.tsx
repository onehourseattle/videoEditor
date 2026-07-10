import { useRef } from 'react'
import type { Clip, Effect, TextStyle } from '../types/model'
import { useEditor, findClip, replaceClip } from '../state/store'
import { useFonts } from '../state/fonts'
import { EFFECT_PRESETS } from '../engine/effects'
import { TRANSITION_TYPES } from '../engine/transitions'
import { setKeyframe, sampleKeyframes } from '../engine/keyframes'
import { uid } from '../utils/id'

export function Inspector() {
  const project = useEditor((s) => s.project)
  const selectedIds = useEditor((s) => s.selectedClipIds)
  const currentTime = useEditor((s) => s.currentTime)
  const updateProject = useEditor((s) => s.updateProject)

  const found = selectedIds.length === 1 ? findClip(project, selectedIds[0]) : null
  if (!found) {
    return (
      <aside className="inspector empty">
        <h3>Inspector</h3>
        <p className="hint">
          Select a clip to edit its properties, transform keyframes, effects and transitions.
        </p>
      </aside>
    )
  }
  const clip = found.clip
  const local = Math.min(Math.max(0, currentTime - clip.start), clip.duration)
  const edit = (fn: (c: Clip) => Clip) => updateProject((p) => replaceClip(p, clip.id, fn))

  const num = (v: string) => (isNaN(Number(v)) ? 0 : Number(v))

  return (
    <aside className="inspector">
      <h3>{clip.name || clip.kind}</h3>

      <div className="row">
        <label className="field">Start
          <input type="number" step={0.1} value={round2(clip.start)}
            onChange={(e) => edit((c) => ({ ...c, start: Math.max(0, num(e.target.value)) }))} />
        </label>
        <label className="field">Duration
          <input type="number" step={0.1} value={round2(clip.duration)}
            onChange={(e) => edit((c) => ({ ...c, duration: Math.max(0.05, num(e.target.value)) }))} />
        </label>
      </div>

      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <>
          <div className="row">
            <label className="field">Speed
              <input type="number" step={0.1} min={0.1} max={4} value={clip.speed}
                onChange={(e) => {
                  const speed = Math.min(4, Math.max(0.1, num(e.target.value) || 1))
                  edit((c) => (c.kind === 'video' || c.kind === 'audio')
                    ? { ...c, speed, duration: (c.duration * c.speed) / speed }
                    : c)
                }} />
            </label>
            <label className="field">Volume
              <input type="range" min={0} max={2} step={0.05} value={clip.volume}
                onChange={(e) => edit((c) => ('volume' in c ? { ...c, volume: num(e.target.value) } : c))} />
            </label>
          </div>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={clip.muted}
              onChange={(e) => edit((c) => ('muted' in c ? { ...c, muted: e.target.checked } : c))} />
            Muted
          </label>
          {clip.gain && clip.gain.length > 1 && (
            <div className="row" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              🎚 Volume envelope: {clip.gain.length} points
              <button className="small ghost"
                onClick={() => edit((c) => (c.kind === 'video' || c.kind === 'audio' ? { ...c, gain: undefined } : c))}>
                Clear
              </button>
            </div>
          )}
        </>
      )}

      {clip.kind === 'audio' && (
        <div className="row">
          <label className="field">Fade in
            <input type="number" step={0.1} min={0} value={clip.fadeIn}
              onChange={(e) => edit((c) => (c.kind === 'audio' ? { ...c, fadeIn: Math.max(0, num(e.target.value)) } : c))} />
          </label>
          <label className="field">Fade out
            <input type="number" step={0.1} min={0} value={clip.fadeOut}
              onChange={(e) => edit((c) => (c.kind === 'audio' ? { ...c, fadeOut: Math.max(0, num(e.target.value)) } : c))} />
          </label>
        </div>
      )}

      {clip.kind === 'text' && <TextControls clip={clip} edit={edit} />}
      {clip.kind === 'caption' && (
        <>
          <label className="field">Words per page
            <input type="number" min={1} max={8} value={clip.wordsPerPage}
              onChange={(e) => edit((c) => (c.kind === 'caption' ? { ...c, wordsPerPage: Math.max(1, num(e.target.value)) } : c))} />
          </label>
          <StyleControls style={clip.style} onChange={(style) => edit((c) => (c.kind === 'caption' ? { ...c, style } : c))} />
        </>
      )}
      {clip.kind === 'sticker' && (
        <div className="row">
          <label className="field">Emoji
            <input value={clip.emoji}
              onChange={(e) => edit((c) => (c.kind === 'sticker' ? { ...c, emoji: e.target.value } : c))} />
          </label>
          <label className="field">Animation
            <select value={clip.animation}
              onChange={(e) => edit((c) => (c.kind === 'sticker' ? { ...c, animation: e.target.value as typeof clip.animation } : c))}>
              {['pulse', 'heartbeat', 'spin', 'shake', 'float', 'none'].map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
        </div>
      )}
      {clip.kind === 'chart' && <ChartControls clip={clip} edit={edit} />}

      {/* ── transform + keyframes ── */}
      <h4>Transform @ {round2(local)}s</h4>
      {(['x', 'y', 'scale', 'rotation', 'opacity'] as const).map((prop) => {
        const value = sampleKeyframes(clip.transform[prop], local)
        return (
          <div className="row" key={prop}>
            <label className="field" style={{ flex: 1 }}>{prop}
              <input type="number" step={prop === 'scale' || prop === 'opacity' ? 0.05 : 5} value={round2(value)}
                onChange={(e) =>
                  edit((c) => ({
                    ...c,
                    transform: {
                      ...c.transform,
                      [prop]: c.transform[prop].length > 1
                        ? setKeyframe(c.transform[prop], local, num(e.target.value))
                        : [{ t: 0, value: num(e.target.value), easing: 'linear' as const }],
                    },
                  }))
                } />
            </label>
            <button className="small" title="Add keyframe at playhead"
              onClick={() => edit((c) => ({
                ...c,
                transform: { ...c.transform, [prop]: setKeyframe(c.transform[prop], local, value) },
              }))}>
              ◆ {clip.transform[prop].length > 1 ? clip.transform[prop].length : ''}
            </button>
          </div>
        )
      })}

      {/* ── transition ── */}
      <h4>Transition (to next clip)</h4>
      <div className="row">
        <select
          value={clip.transition?.type ?? ''}
          onChange={(e) =>
            edit((c) => ({
              ...c,
              transition: e.target.value
                ? { type: e.target.value as NonNullable<Clip['transition']>['type'], duration: c.transition?.duration ?? 0.5 }
                : undefined,
            }))
          }>
          <option value="">None</option>
          {TRANSITION_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        {clip.transition && (
          <input type="number" step={0.1} min={0.1} max={3} value={clip.transition.duration} style={{ width: 64 }}
            onChange={(e) => edit((c) => (c.transition ? { ...c, transition: { ...c.transition, duration: Math.max(0.1, num(e.target.value)) } } : c))} />
        )}
      </div>

      {/* ── effects ── */}
      <h4>Effects</h4>
      {clip.effects.map((fx) => (
        <EffectRow key={fx.id} fx={fx} edit={edit} />
      ))}
      <select
        value=""
        onChange={(e) => {
          const preset = EFFECT_PRESETS[Number(e.target.value)]
          if (preset) edit((c) => ({ ...c, effects: [...c.effects, { id: uid('fx'), ...preset.make() }] }))
        }}>
        <option value="">+ Add effect…</option>
        {EFFECT_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
      </select>
    </aside>
  )
}

function EffectRow({ fx, edit }: { fx: Effect; edit: (fn: (c: Clip) => Clip) => void }) {
  const firstNumeric = Object.entries(fx.params).find(([, v]) => typeof v === 'number')
  return (
    <div className="fx-row">
      <input type="checkbox" checked={fx.enabled}
        onChange={(e) => edit((c) => ({ ...c, effects: c.effects.map((f) => (f.id === fx.id ? { ...f, enabled: e.target.checked } : f)) }))} />
      <span>{fx.type}</span>
      {firstNumeric && (
        <input type="range" min={0} max={fx.type === 'hue' ? 360 : fx.type === 'blur' || fx.type === 'pixelate' ? 40 : 2}
          step={0.05} value={Number(firstNumeric[1])} style={{ width: 70 }}
          onChange={(e) => edit((c) => ({
            ...c,
            effects: c.effects.map((f) => (f.id === fx.id ? { ...f, params: { ...f.params, [firstNumeric[0]]: Number(e.target.value) } } : f)),
          }))} />
      )}
      <button className="small ghost"
        onClick={() => edit((c) => ({ ...c, effects: c.effects.filter((f) => f.id !== fx.id) }))}>✕</button>
    </div>
  )
}

function TextControls({ clip, edit }: { clip: Extract<Clip, { kind: 'text' }>; edit: (fn: (c: Clip) => Clip) => void }) {
  return (
    <>
      <label className="field">Text
        <textarea rows={2} value={clip.text}
          onChange={(e) => edit((c) => (c.kind === 'text' ? { ...c, text: e.target.value, name: e.target.value.slice(0, 20) } : c))} />
      </label>
      <label className="field">Animation
        <select value={clip.animation}
          onChange={(e) => edit((c) => (c.kind === 'text' ? { ...c, animation: e.target.value as typeof clip.animation } : c))}>
          {['none', 'fadeIn', 'popIn', 'slideUp', 'linesUp', 'typewriter', 'wordPop', 'wordHighlight', 'bounceIn', 'waveIn', 'shake'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <StyleControls style={clip.style} onChange={(style) => edit((c) => (c.kind === 'text' ? { ...c, style } : c))} />
    </>
  )
}

function StyleControls({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const fonts = useFonts((s) => s.fonts)
  const importFont = useFonts((s) => s.importFont)
  const toast = useEditor((s) => s.toast)
  const fontFileRef = useRef<HTMLInputElement>(null)
  const knownFont = fonts.some((f) => f.family === style.fontFamily)
  return (
    <>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>Font
          <select
            value={knownFont ? style.fontFamily : ''}
            onChange={(e) => e.target.value && onChange({ ...style, fontFamily: e.target.value })}
            style={{ fontFamily: style.fontFamily }}
          >
            {!knownFont && <option value="">{style.fontFamily.split(',')[0]}</option>}
            {fonts.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.label}</option>
            ))}
          </select>
        </label>
        <button className="small" title="Import a .ttf / .otf / .woff2 font file" style={{ alignSelf: 'flex-end' }}
          onClick={() => fontFileRef.current?.click()}>+ Font</button>
        <input
          ref={fontFileRef} type="file" hidden accept=".ttf,.otf,.woff,.woff2"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const opt = await importFont(f)
              onChange({ ...style, fontFamily: opt.family })
              toast(`Font "${opt.label}" imported — stored locally`, 'ok')
            } catch (err) {
              toast(`Could not load font: ${err instanceof Error ? err.message : err}`, 'error')
            }
            e.target.value = ''
          }}
        />
      </div>
      <div className="row">
        <label className="field">Size
          <input type="number" value={style.fontSize}
            onChange={(e) => onChange({ ...style, fontSize: Math.max(8, Number(e.target.value) || 8) })} />
        </label>
        <label className="field">Weight
          <select value={style.fontWeight} onChange={(e) => onChange({ ...style, fontWeight: Number(e.target.value) })}>
            {[400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      </div>
      <div className="row">
        <label className="field">Fill
          <input type="color" value={toHex(style.color)} onChange={(e) => onChange({ ...style, color: e.target.value, gradient: undefined })} />
        </label>
        <label className="field">Stroke
          <input type="color" value={toHex(style.strokeColor)} onChange={(e) => onChange({ ...style, strokeColor: e.target.value })} />
        </label>
        <label className="field">Width
          <input type="number" min={0} max={24} value={style.strokeWidth} style={{ width: 54 }}
            onChange={(e) => onChange({ ...style, strokeWidth: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <div className="row">
        <label className="field">Tracking
          <input type="number" step={1} min={-10} max={40} value={style.letterSpacing}
            onChange={(e) => onChange({ ...style, letterSpacing: Number(e.target.value) || 0 })} />
        </label>
        <label className="field">Leading
          <input type="number" step={0.05} min={0.7} max={2.5} value={style.lineHeight}
            onChange={(e) => onChange({ ...style, lineHeight: Math.max(0.7, Number(e.target.value) || 1.2) })} />
        </label>
        <label className="field">Slant°
          <input type="number" step={1} min={-25} max={25} value={style.skewDeg ?? 0}
            onChange={(e) => onChange({ ...style, skewDeg: Number(e.target.value) || 0 })} />
        </label>
      </div>
      <div className="row">
        <label className="field">Align
          <select value={style.align} onChange={(e) => onChange({ ...style, align: e.target.value as TextStyle['align'] })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' }}>
          <input type="checkbox" checked={!!style.hollow}
            onChange={(e) => onChange({ ...style, hollow: e.target.checked })} />
          Hollow
        </label>
      </div>
      <div className="row">
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={style.uppercase} onChange={(e) => onChange({ ...style, uppercase: e.target.checked })} />
          UPPERCASE
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!style.backgroundColor}
            onChange={(e) => onChange({ ...style, backgroundColor: e.target.checked ? 'rgba(0,0,0,0.75)' : '' })} />
          Box
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!style.echo}
            onChange={(e) => onChange({ ...style, echo: e.target.checked ? { x: 10, y: 10, color: '#6C5CE7' } : undefined })} />
          Echo
        </label>
      </div>
    </>
  )
}

function ChartControls({ clip, edit }: { clip: Extract<Clip, { kind: 'chart' }>; edit: (fn: (c: Clip) => Clip) => void }) {
  const spec = clip.spec
  const setSpec = (patch: Partial<typeof spec>) =>
    edit((c) => (c.kind === 'chart' ? { ...c, spec: { ...c.spec, ...patch } } : c))
  return (
    <>
      <label className="field">Title
        <input value={spec.title} onChange={(e) => setSpec({ title: e.target.value })} />
      </label>
      <div className="row">
        <label className="field">Prefix
          <input value={spec.prefix} onChange={(e) => setSpec({ prefix: e.target.value })} />
        </label>
        <label className="field">Suffix
          <input value={spec.suffix} onChange={(e) => setSpec({ suffix: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <label className="field">Color
          <input type="color" value={toHex(spec.color)} onChange={(e) => setSpec({ color: e.target.value })} />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!spec.backgroundColor}
            onChange={(e) => setSpec({ backgroundColor: e.target.checked ? 'rgba(10,10,14,0.55)' : '' })} />
          Card bg
        </label>
      </div>
      <label className="field">Data (label:value per line)
        <textarea rows={5} defaultValue={spec.data.map((d) => `${d.label}:${d.value}`).join('\n')}
          onBlur={(e) => {
            const data = e.target.value.split('\n').map((line) => {
              const idx = line.lastIndexOf(':')
              if (idx < 0) return null
              const value = Number(line.slice(idx + 1).trim())
              return isNaN(value) ? null : { label: line.slice(0, idx).trim(), value }
            }).filter((d): d is { label: string; value: number } => !!d)
            if (data.length) setSpec({ data })
          }} />
      </label>
    </>
  )
}

function toHex(c: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#ffffff'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
