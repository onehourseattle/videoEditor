import type {
  AudioClip, ChartSpec, Clip, Project, TextClip, TextStyle, Track, TransitionType, VideoClip,
} from '../types/model'
import { defaultTextStyle, defaultTransform, projectDuration } from '../types/model'
import { uid } from '../utils/id'
import {
  addClipToTrack, addTrack, byStart, findClip, removeClips, replaceClip, rippleDeleteRange, splitClipAt, useEditor,
} from '../state/store'
import { setKeyframe } from '../engine/keyframes'
import { playback } from '../engine/playback'
import { applyRamp, clearRamp, sourceSpanOf, RAMP_PRESETS } from '../engine/speed'
import { defaultChartSpec } from '../engine/chartRenderer'
import { detectSilences, DEFAULT_SILENCE_OPTIONS } from '../ai/silence'
import { detectBeats, estimateBpm } from '../ai/beats'
import { detectScenes } from '../ai/scenes'
import { findHighlights } from '../ai/highlights'
import { transcribe, findFillerWords } from '../ai/transcribe'
import { captionsFromTranscript } from '../ai/autoCaptions'
import { computeReframeKeyframes } from '../ai/autoReframe'

/**
 * The `editor` object handed to user scripts. Everything CutRoom can do in the
 * UI is reachable here — including the local AI features — so edits can be
 * fully automated. See docs/SCRIPTING.md for the reference.
 */
export function createScriptApi(log: (msg: string) => void) {
  const get = () => useEditor.getState()
  const mutate = (fn: (p: Project) => Project) => get().updateProject(fn)

  const api = {
    // ── inspection ──
    get project(): Project {
      return get().project
    },
    duration(): number {
      return projectDuration(get().project)
    },
    tracks(): Track[] {
      return get().project.tracks
    },
    clips(filter?: { kind?: Clip['kind']; trackId?: string }): Clip[] {
      const out: Clip[] = []
      for (const t of get().project.tracks) {
        if (filter?.trackId && t.id !== filter.trackId) continue
        for (const c of t.clips) if (!filter?.kind || c.kind === filter.kind) out.push(c)
      }
      return out.sort(byStart)
    },
    assets() {
      return Object.values(get().project.assets)
    },
    log,

    // ── playhead ──
    get playhead(): number {
      return get().currentTime
    },
    seek(t: number) {
      // go through playback so pooled <video> elements re-seek too — otherwise
      // a scripted seek moves the playhead but leaves a stale frame on screen
      playback.seek(t)
    },

    // ── structure ──
    addTrack(kind: 'video' | 'audio' | 'overlay', name?: string): Track {
      let created: Track | null = null
      mutate((p) => {
        const r = addTrack(p, kind, name)
        created = r.track
        return r.project
      })
      return created!
    },
    addVideoClip(assetId: string, trackId: string, start: number, opts?: Partial<Pick<VideoClip, 'offset' | 'duration' | 'speed' | 'volume'>>): VideoClip {
      const asset = get().project.assets[assetId]
      if (!asset) throw new Error(`No asset ${assetId}`)
      const speed = opts?.speed ?? 1
      const clip: VideoClip = {
        id: uid('clip'), kind: 'video', assetId, name: asset.name, start,
        offset: opts?.offset ?? 0,
        duration: opts?.duration ?? (asset.duration - (opts?.offset ?? 0)) / speed,
        speed, volume: opts?.volume ?? 1, muted: false,
        transform: defaultTransform(), effects: [],
      }
      mutate((p) => addClipToTrack(p, trackId, clip))
      return clip
    },
    addAudioClip(assetId: string, trackId: string, start: number, opts?: Partial<Pick<AudioClip, 'offset' | 'duration' | 'volume' | 'fadeIn' | 'fadeOut'>>): AudioClip {
      const asset = get().project.assets[assetId]
      if (!asset) throw new Error(`No asset ${assetId}`)
      const clip: AudioClip = {
        id: uid('clip'), kind: 'audio', assetId, name: asset.name, start,
        offset: opts?.offset ?? 0, duration: opts?.duration ?? asset.duration,
        speed: 1, volume: opts?.volume ?? 1, muted: false,
        fadeIn: opts?.fadeIn ?? 0, fadeOut: opts?.fadeOut ?? 0,
        transform: defaultTransform(), effects: [],
      }
      mutate((p) => addClipToTrack(p, trackId, clip))
      return clip
    },
    addText(text: string, start: number, duration: number, opts?: { trackId?: string; style?: Partial<TextStyle>; animation?: TextClip['animation']; y?: number }): TextClip {
      const trackId = opts?.trackId ?? topOverlayTrack()
      const transform = defaultTransform()
      if (opts?.y !== undefined) transform.y = [{ t: 0, value: opts.y, easing: 'linear' }]
      const clip: TextClip = {
        id: uid('clip'), kind: 'text', name: text.slice(0, 20), start, duration, text,
        style: { ...defaultTextStyle(), ...opts?.style },
        animation: opts?.animation ?? 'popIn', animationDuration: 0.4,
        transform, effects: [],
      }
      mutate((p) => addClipToTrack(p, trackId, clip))
      return clip
    },
    addChart(type: ChartSpec['type'], start: number, duration: number, opts?: { trackId?: string; spec?: Partial<ChartSpec> }): Clip {
      const spec = { ...defaultChartSpec(type), ...opts?.spec }
      const clip: Clip = {
        id: uid('clip'), kind: 'chart', name: spec.title || type, start, duration, spec,
        transform: defaultTransform(), effects: [],
      }
      mutate((p) => addClipToTrack(p, opts?.trackId ?? topOverlayTrack(), clip))
      return clip
    },
    addSticker(emoji: string, start: number, duration: number, opts?: { trackId?: string; animation?: 'none' | 'pulse' | 'spin' | 'shake' | 'float' | 'heartbeat'; x?: number; y?: number }): Clip {
      const transform = defaultTransform()
      if (opts?.x !== undefined) transform.x = [{ t: 0, value: opts.x, easing: 'linear' }]
      if (opts?.y !== undefined) transform.y = [{ t: 0, value: opts.y, easing: 'linear' }]
      const clip: Clip = {
        id: uid('clip'), kind: 'sticker', name: emoji, start, duration, emoji,
        animation: opts?.animation ?? 'pulse', transform, effects: [],
      }
      mutate((p) => addClipToTrack(p, opts?.trackId ?? topOverlayTrack(), clip))
      return clip
    },

    // ── editing ──
    split(clipId: string, t: number) {
      mutate((p) => splitClipAt(p, clipId, t))
    },
    remove(clipId: string | string[]) {
      mutate((p) => removeClips(p, Array.isArray(clipId) ? clipId : [clipId]))
    },
    move(clipId: string, start: number) {
      mutate((p) => replaceClip(p, clipId, (c) => ({ ...c, start: Math.max(0, start) })))
    },
    trim(clipId: string, opts: { start?: number; end?: number }) {
      mutate((p) =>
        replaceClip(p, clipId, (c) => {
          let { start, duration } = c
          let offset = 'offset' in c ? c.offset : 0
          const speed = 'speed' in c ? c.speed : 1
          if (opts.start !== undefined) {
            const delta = opts.start - start
            start = opts.start
            duration -= delta
            offset += delta * speed
          }
          if (opts.end !== undefined) duration = opts.end - start
          const next = { ...c, start, duration: Math.max(0.05, duration) }
          if ('offset' in next) (next as VideoClip).offset = Math.max(0, offset)
          return next
        }),
      )
    },
    setSpeed(clipId: string, speed: number) {
      mutate((p) =>
        replaceClip(p, clipId, (c) => {
          if (c.kind !== 'video' && c.kind !== 'audio') return c
          // a constant speed replaces any ramp; keep the same source range
          const sourceSpan = sourceSpanOf(c)
          const next = clearRamp(c)
          return { ...next, speed, duration: Math.max(0.05, sourceSpan / speed) }
        }),
      )
    },
    /** Apply a speed ramp preset (see RAMP_PRESETS) or a raw normalized curve. */
    setSpeedRamp(clipId: string, curveOrPreset: string | { t: number; value: number; easing?: string }[]) {
      mutate((p) =>
        replaceClip(p, clipId, (c) => {
          if (c.kind !== 'video' && c.kind !== 'audio') return c
          if (curveOrPreset === 'none') return clearRamp(c)
          const preset = typeof curveOrPreset === 'string'
            ? RAMP_PRESETS.find((r) => r.name.toLowerCase() === curveOrPreset.toLowerCase())
            : null
          if (typeof curveOrPreset === 'string' && !preset) {
            throw new Error(`Unknown ramp "${curveOrPreset}" — try: ${RAMP_PRESETS.map((r) => r.name).join(', ')}`)
          }
          const curve = preset
            ? preset.curve
            : (curveOrPreset as { t: number; value: number; easing?: string }[]).map((k) => ({
                t: k.t, value: k.value, easing: (k.easing ?? 'easeInOut') as never,
              }))
          return applyRamp(c, curve)
        }),
      )
    },
    setVolume(clipId: string, volume: number) {
      mutate((p) => replaceClip(p, clipId, (c) => ('volume' in c ? { ...c, volume } : c)))
    },
    setTransition(clipId: string, type: TransitionType, duration = 0.5) {
      mutate((p) => replaceClip(p, clipId, (c) => ({ ...c, transition: { type, duration } })))
    },
    addEffect(clipId: string, type: Clip['effects'][number]['type'], params: Record<string, number | string> = {}) {
      mutate((p) =>
        replaceClip(p, clipId, (c) => ({
          ...c,
          effects: [...c.effects, { id: uid('fx'), type, enabled: true, params }],
        })),
      )
    },
    keyframe(clipId: string, prop: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', t: number, value: number, easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring' | 'bounce' = 'easeInOut') {
      mutate((p) =>
        replaceClip(p, clipId, (c) => ({
          ...c,
          transform: { ...c.transform, [prop]: setKeyframe(c.transform[prop], t, value, easing) },
        })),
      )
    },
    rippleDelete(trackId: string, from: number, to: number) {
      mutate((p) => rippleDeleteRange(p, trackId, from, to))
    },

    // ── local AI ──
    async detectSilences(assetId: string, opts?: Partial<typeof DEFAULT_SILENCE_OPTIONS>) {
      return detectSilences(assetId, { ...DEFAULT_SILENCE_OPTIONS, ...opts })
    },
    async removeSilences(clipId: string, opts?: Partial<typeof DEFAULT_SILENCE_OPTIONS>) {
      const found = findClip(get().project, clipId)
      if (!found || found.clip.kind !== 'video') throw new Error('removeSilences needs a video clip id')
      const clip = found.clip
      const silences = await detectSilences(clip.assetId, { ...DEFAULT_SILENCE_OPTIONS, ...opts })
      // convert source ranges → timeline ranges, apply back-to-front so times stay valid
      const ranges = silences
        .map((r) => ({
          start: clip.start + (r.start - clip.offset) / clip.speed,
          end: clip.start + (r.end - clip.offset) / clip.speed,
        }))
        .filter((r) => r.end > clip.start && r.start < clip.start + clip.duration)
        .sort((a, b) => b.start - a.start)
      for (const r of ranges) {
        api.rippleDelete(found.track.id, Math.max(r.start, clip.start), Math.min(r.end, clip.start + clip.duration))
      }
      log(`Removed ${ranges.length} silences`)
      return ranges.length
    },
    async detectBeats(assetId: string) {
      const beats = await detectBeats(assetId)
      log(`${beats.length} beats — ~${estimateBpm(beats) ?? '?'} BPM`)
      return beats
    },
    async detectScenes(assetId: string) {
      const asset = get().project.assets[assetId]
      if (!asset) throw new Error(`No asset ${assetId}`)
      return detectScenes(asset)
    },
    async findHighlights(assetId: string, count = 3, segmentLen = 5) {
      return findHighlights(assetId, count, segmentLen)
    },
    async transcribe(assetId: string) {
      return transcribe(assetId, log)
    },
    async autoCaption(clipId: string, style?: Partial<TextStyle>, wordsPerPage = 4) {
      const found = findClip(get().project, clipId)
      if (!found || found.clip.kind !== 'video') throw new Error('autoCaption needs a video clip id')
      const words = await transcribe(found.clip.assetId, log)
      const captions = captionsFromTranscript(words, found.clip, style, wordsPerPage)
      const trackId = topOverlayTrack()
      mutate((p) => captions.reduce((acc, c) => addClipToTrack(acc, trackId, c), p))
      log(`Added ${captions.length} caption clips (${words.length} words)`)
      return captions
    },
    async removeFillerWords(clipId: string) {
      const found = findClip(get().project, clipId)
      if (!found || found.clip.kind !== 'video') throw new Error('removeFillerWords needs a video clip id')
      const clip = found.clip
      const words = await transcribe(clip.assetId, log)
      const fillers = findFillerWords(words)
      const ranges = fillers
        .map((w) => ({
          start: clip.start + (w.start - clip.offset) / clip.speed - 0.04,
          end: clip.start + (w.end - clip.offset) / clip.speed + 0.04,
        }))
        .filter((r) => r.end > clip.start && r.start < clip.start + clip.duration)
        .sort((a, b) => b.start - a.start)
      for (const r of ranges) api.rippleDelete(found.track.id, r.start, r.end)
      log(`Cut ${ranges.length} filler words: ${fillers.map((f) => f.text).join(', ')}`)
      return ranges.length
    },
    async autoReframe(clipId: string) {
      const st = get()
      const found = findClip(st.project, clipId)
      if (!found || found.clip.kind !== 'video') throw new Error('autoReframe needs a video clip id')
      const clip = found.clip
      const asset = st.project.assets[clip.assetId]
      if (!asset) throw new Error('Asset missing')
      const kfs = await computeReframeKeyframes(asset, clip, st.project.width, st.project.height)
      if (!kfs.length) {
        log('Source already fits the frame — nothing to reframe')
        return 0
      }
      mutate((p) => replaceClip(p, clipId, (c) => ({ ...c, transform: { ...c.transform, x: kfs } })))
      log(`Auto-reframe: ${kfs.length} keyframes`)
      return kfs.length
    },
  }

  function topOverlayTrack(): string {
    const p = get().project
    const t = p.tracks.find((tr) => tr.kind === 'overlay') ?? p.tracks[0]
    return t.id
  }

  return api
}

export type ScriptApi = ReturnType<typeof createScriptApi>
