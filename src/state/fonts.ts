import { create } from 'zustand'
import { idb } from './db'

/**
 * Typography, fully local. Two sources:
 *  - a curated list of fonts that ship with macOS/iOS (no download needed)
 *  - user-imported .ttf/.otf/.woff2 files, registered via FontFace and
 *    persisted in IndexedDB so they survive reloads
 */

export interface FontOption {
  label: string
  /** CSS font-family value (used verbatim in canvas font strings) */
  family: string
  imported?: boolean
}

export const SYSTEM_FONTS: FontOption[] = [
  { label: 'Inter / System', family: 'Inter, -apple-system, sans-serif' },
  { label: 'Avenir Next', family: '"Avenir Next", "Avenir", sans-serif' },
  { label: 'Futura', family: 'Futura, sans-serif' },
  { label: 'Impact', family: 'Impact, "Arial Black", sans-serif' },
  { label: 'Arial Black', family: '"Arial Black", sans-serif' },
  { label: 'Georgia', family: 'Georgia, serif' },
  { label: 'Palatino', family: '"Palatino", "Palatino Linotype", serif' },
  { label: 'American Typewriter', family: '"American Typewriter", serif' },
  { label: 'Marker Felt', family: '"Marker Felt", "Comic Sans MS", cursive' },
  { label: 'Chalkboard', family: '"Chalkboard SE", "Chalkboard", cursive' },
  { label: 'Menlo (mono)', family: 'Menlo, ui-monospace, monospace' },
  { label: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
]

interface StoredFont {
  family: string
  data: ArrayBuffer
}

interface FontsState {
  fonts: FontOption[]
  importFont: (file: File) => Promise<FontOption>
  removeFont: (family: string) => Promise<void>
}

function register(family: string, data: ArrayBuffer) {
  const face = new FontFace(family, data)
  document.fonts.add(face)
  return face.load()
}

export const useFonts = create<FontsState>((set) => ({
  fonts: SYSTEM_FONTS,

  importFont: async (file) => {
    const family = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF)$/, '').replace(/[^\w \-]/g, '').trim() || 'Imported font'
    const data = await file.arrayBuffer()
    await register(family, data)
    await idb.put('fonts', family, { family, data } satisfies StoredFont)
    const option: FontOption = { label: `${family} (imported)`, family: `"${family}", sans-serif`, imported: true }
    set((s) => ({ fonts: [...s.fonts.filter((f) => f.family !== option.family), option] }))
    return option
  },

  removeFont: async (family) => {
    const bare = family.replace(/^"|",.*$/g, '')
    await idb.delete('fonts', bare)
    set((s) => ({ fonts: s.fonts.filter((f) => f.family !== family) }))
  },
}))

/** Re-register persisted fonts on boot. */
export async function loadFonts(): Promise<void> {
  const stored = await idb.getAll<StoredFont>('fonts')
  const options: FontOption[] = []
  for (const f of stored) {
    try {
      await register(f.family, f.data)
      options.push({ label: `${f.family} (imported)`, family: `"${f.family}", sans-serif`, imported: true })
    } catch {
      /* corrupt font file — skip */
    }
  }
  if (options.length) {
    useFonts.setState((s) => ({
      fonts: [...s.fonts.filter((f) => !options.some((o) => o.family === f.family)), ...options],
    }))
  }
}
