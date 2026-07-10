// ─── CutRoom project model ───────────────────────────────────────────────────
// Everything in a project is plain JSON: serializable, undoable, scriptable.

export type Easing =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'spring'
  | 'bounce'
  | 'hold'

export interface Keyframe {
  /** seconds relative to clip start */
  t: number
  value: number
  easing: Easing
}

/** Animatable numeric properties on a clip's transform. */
export interface Transform {
  x: Keyframe[] // px offset from center
  y: Keyframe[]
  scale: Keyframe[] // 1 = fit
  rotation: Keyframe[] // degrees
  opacity: Keyframe[] // 0..1
}

export type EffectType =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'hue'
  | 'blur'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'vignette'
  | 'chromaKey'
  | 'lut'
  | 'sharpen'
  | 'pixelate'
  | 'glitch'
  | 'vhs'
  | 'filmGrain'

export interface Effect {
  id: string
  type: EffectType
  enabled: boolean
  /** effect-specific params, e.g. { amount: 1.2 } or { keyColor: '#00ff00', tolerance: 0.3 } */
  params: Record<string, number | string>
}

export type TransitionType =
  | 'crossfade'
  | 'fadeToBlack'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'wipe'
  | 'zoomIn'
  | 'zoomOut'
  | 'blurThrough'
  | 'glitch'
  | 'spin'

export interface Transition {
  type: TransitionType
  /** seconds, overlaps the end of this clip and the start of the next */
  duration: number
}

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'caption' | 'chart' | 'sticker' | 'shape'

export interface ClipBase {
  id: string
  kind: ClipKind
  /** timeline position in seconds */
  start: number
  /** timeline duration in seconds (after speed is applied for media clips) */
  duration: number
  name: string
  transform: Transform
  effects: Effect[]
  transition?: Transition
}

export interface VideoClip extends ClipBase {
  kind: 'video'
  assetId: string
  /** source in-point in seconds (in source time) */
  offset: number
  speed: number
  volume: number
  muted: boolean
  /** optional volume envelope (multiplies `volume`); times relative to clip start */
  gain?: Keyframe[]
}

export interface ImageClip extends ClipBase {
  kind: 'image'
  assetId: string
}

export interface AudioClip extends ClipBase {
  kind: 'audio'
  assetId: string
  offset: number
  speed: number
  volume: number
  muted: boolean
  fadeIn: number
  fadeOut: number
  /** optional volume envelope (multiplies `volume`); times relative to clip start */
  gain?: Keyframe[]
}

// ─── Text & captions ─────────────────────────────────────────────────────────

export type TextAnimation =
  | 'none'
  | 'fadeIn'
  | 'popIn'
  | 'slideUp'
  | 'typewriter'
  | 'wordPop' // karaoke-style word-by-word pop (CapCut classic)
  | 'wordHighlight' // active word gets a colored box
  | 'bounceIn'
  | 'waveIn'
  | 'shake'
  | 'linesUp' // headline: each line rises in, staggered
  | 'trackIn' // headline: letter-spacing tightens from wide (cinematic)
  | 'reveal' // headline: lines rise out of a mask
  | 'flicker' // headline: neon power-on flicker

export interface TextStyle {
  fontFamily: string
  fontSize: number // px at project resolution
  fontWeight: number
  color: string
  strokeColor: string
  strokeWidth: number
  backgroundColor: string // '' = none
  backgroundPadding: number
  cornerRadius: number
  shadowColor: string
  shadowBlur: number
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  uppercase: boolean
  gradient?: [string, string] // vertical gradient fill overrides color
  highlightColor: string // for wordHighlight animation
  // ── headline typography (all optional / backward compatible) ──
  /** italic-style slant in degrees (positive = forward lean) */
  skewDeg?: number
  /** stroke-only letters, no fill (outline/hollow look) */
  hollow?: boolean
  /** offset duplicate drawn behind the text — retro poster echo */
  echo?: { x: number; y: number; color: string }
  /** two-tone: the first word takes this fill */
  firstWordColor?: string
  /** stacked headline: every other line renders hollow */
  alternateLines?: boolean
}

export interface TextClip extends ClipBase {
  kind: 'text'
  text: string
  style: TextStyle
  animation: TextAnimation
  animationDuration: number
  /** 'behind' = the person from the footage is re-drawn OVER this text (local segmentation) */
  placement?: 'front' | 'behind'
}

export interface CaptionWord {
  text: string
  /** seconds relative to clip start */
  start: number
  end: number
}

export interface CaptionClip extends ClipBase {
  kind: 'caption'
  words: CaptionWord[]
  style: TextStyle
  animation: TextAnimation
  /** max words shown per page */
  wordsPerPage: number
}

// ─── Charts & graphics ───────────────────────────────────────────────────────

export type ChartType = 'line' | 'area' | 'bar' | 'barRace' | 'counter' | 'donut' | 'progress' | 'sparkline'

export interface ChartSeriesPoint {
  label: string
  value: number
}

export interface ChartSpec {
  type: ChartType
  title: string
  data: ChartSeriesPoint[]
  /** categorical palette indexes into the theme palette */
  color: string
  accentColor: string
  backgroundColor: string // '' = transparent
  showValues: boolean
  /** counter: prefix/suffix e.g. '+' / ' likes' */
  prefix: string
  suffix: string
  animateIn: 'draw' | 'rise' | 'pop' | 'none'
  fontFamily: string
}

export interface ChartClip extends ClipBase {
  kind: 'chart'
  spec: ChartSpec
}

export interface StickerClip extends ClipBase {
  kind: 'sticker'
  /** emoji or short text rendered huge */
  emoji: string
  animation: 'none' | 'pulse' | 'spin' | 'shake' | 'float' | 'heartbeat'
}

export interface ShapeClip extends ClipBase {
  kind: 'shape'
  shape: 'rect' | 'circle' | 'arrow' | 'line'
  fill: string
  stroke: string
  strokeWidth: number
  width: number // fraction of project width
  height: number
}

export type Clip =
  | VideoClip
  | ImageClip
  | AudioClip
  | TextClip
  | CaptionClip
  | ChartClip
  | StickerClip
  | ShapeClip

export type TrackKind = 'video' | 'audio' | 'overlay'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  locked: boolean
  hidden: boolean
  clips: Clip[]
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export interface AssetMeta {
  id: string
  name: string
  type: 'video' | 'audio' | 'image'
  /** seconds; images = Infinity-safe 0 */
  duration: number
  width: number
  height: number
  /** object URL, session-scoped. Re-linked on project load. */
  url: string
  thumbnail?: string // dataURL
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  name: string
  width: number
  height: number
  fps: number
  /** bumped when the model changes; migrate.ts repairs older/foreign JSON */
  schemaVersion?: number
  tracks: Track[]
  /** asset metadata; binary data lives in the AssetStore, not in project JSON */
  assets: Record<string, AssetMeta>
}

export const ASPECT_PRESETS = [
  { name: 'TikTok / Reels / Shorts (9:16)', width: 1080, height: 1920 },
  { name: 'Square (1:1)', width: 1080, height: 1080 },
  { name: 'YouTube (16:9)', width: 1920, height: 1080 },
  { name: 'Portrait (4:5)', width: 1080, height: 1350 },
] as const

export function projectDuration(p: Project): number {
  let end = 0
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration)
  return end
}

export function defaultTransform(): Transform {
  return {
    x: [{ t: 0, value: 0, easing: 'linear' }],
    y: [{ t: 0, value: 0, easing: 'linear' }],
    scale: [{ t: 0, value: 1, easing: 'linear' }],
    rotation: [{ t: 0, value: 0, easing: 'linear' }],
    opacity: [{ t: 0, value: 1, easing: 'linear' }],
  }
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Inter, -apple-system, sans-serif',
    fontSize: 72,
    fontWeight: 800,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0,
    backgroundColor: '',
    backgroundPadding: 24,
    cornerRadius: 16,
    shadowColor: 'rgba(0,0,0,0.6)',
    shadowBlur: 12,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: 'center',
    uppercase: false,
    highlightColor: '#6C5CE7',
  }
}
