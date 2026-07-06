import type { Project } from '../types/model'

const AUTOSAVE_KEY = 'cutroom.autosave.v1'

export function saveProjectFile(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${p.name.replace(/[^\w.-]+/g, '_') || 'project'}.cutroom.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function loadProjectFile(file: File): Promise<Project> {
  const text = await file.text()
  const p = JSON.parse(text) as Project
  if (!p.tracks || !p.width) throw new Error('Not a CutRoom project file')
  // Media object URLs don't survive reload — mark assets as needing re-link.
  for (const asset of Object.values(p.assets)) asset.url = ''
  return p
}

export function autosave(p: Project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(p))
  } catch {
    /* quota exceeded — skip */
  }
}

export function loadAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Project
    for (const asset of Object.values(p.assets)) asset.url = ''
    return p
  } catch {
    return null
  }
}
