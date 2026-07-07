import type { CaptionClip, TextStyle } from '../types/model'

/**
 * Named caption looks in the styles social audiences recognize.
 * Applied to caption clips wholesale (style + animation + paging).
 */
export interface CaptionTemplate {
  name: string
  sub: string
  style: Partial<TextStyle>
  animation: CaptionClip['animation']
  wordsPerPage: number
}

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  {
    name: 'Karaoke pop',
    sub: 'active word pops + recolors',
    style: { fontWeight: 900, fontSize: 68, strokeWidth: 8, strokeColor: '#000000', highlightColor: '#6C5CE7' },
    animation: 'wordPop',
    wordsPerPage: 4,
  },
  {
    name: 'Hormozi',
    sub: 'loud, yellow highlight box',
    style: {
      fontWeight: 900, fontSize: 72, uppercase: true, strokeWidth: 10, strokeColor: '#000000',
      highlightColor: '#f6c000', fontFamily: 'Impact, "Arial Black", sans-serif',
    },
    animation: 'wordHighlight',
    wordsPerPage: 3,
  },
  {
    name: 'Clean box',
    sub: 'minimal, high legibility',
    style: {
      fontWeight: 700, fontSize: 56, backgroundColor: 'rgba(0,0,0,0.78)', backgroundPadding: 20,
      cornerRadius: 12, shadowBlur: 0, strokeWidth: 0,
    },
    animation: 'fadeIn',
    wordsPerPage: 6,
  },
  {
    name: 'Podcast serif',
    sub: 'calm, editorial',
    style: {
      fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: 58, color: '#f5efdf',
      shadowBlur: 14, strokeWidth: 0,
    },
    animation: 'fadeIn',
    wordsPerPage: 7,
  },
  {
    name: 'Neon',
    sub: 'glow on dark footage',
    style: { color: '#7efcf6', shadowColor: '#0affef', shadowBlur: 26, fontWeight: 800, fontSize: 64, strokeWidth: 0 },
    animation: 'wordPop',
    wordsPerPage: 4,
  },
  {
    name: 'Typewriter',
    sub: 'word-by-word reveal',
    style: { fontFamily: 'Menlo, ui-monospace, monospace', fontWeight: 600, fontSize: 54, backgroundColor: 'rgba(0,0,0,0.65)', backgroundPadding: 16, cornerRadius: 8 },
    animation: 'typewriter',
    wordsPerPage: 6,
  },
  {
    name: 'Gradient wave',
    sub: 'animated, playful',
    style: { gradient: ['#ff8a5c', '#ff2d95'] as [string, string], fontWeight: 900, fontSize: 66, strokeWidth: 6, strokeColor: '#2b0a1e' },
    animation: 'waveIn',
    wordsPerPage: 4,
  },
  {
    name: 'Impact caps',
    sub: 'one big word at a time',
    style: { fontWeight: 900, fontSize: 96, uppercase: true, strokeWidth: 12, strokeColor: '#000000', fontFamily: 'Impact, "Arial Black", sans-serif' },
    animation: 'wordPop',
    wordsPerPage: 1,
  },
]

export function applyTemplate(clip: CaptionClip, tpl: CaptionTemplate): CaptionClip {
  return {
    ...clip,
    style: { ...clip.style, ...tpl.style },
    animation: tpl.animation,
    wordsPerPage: tpl.wordsPerPage,
  }
}
