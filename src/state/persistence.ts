import type { Project } from '../types/model'
import { projectDuration } from '../types/model'
import { idb } from './db'

const LAST_KEY = 'cutroom.lastProject'
const LEGACY_AUTOSAVE_KEY = 'cutroom.autosave.v1'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
  width: number
  height: number
  duration: number
  thumb: string
  /** template = reusable starting point, hidden from the projects list */
  template?: boolean
}

interface ProjectRecord extends ProjectSummary {
  json: Project
}

// ─── multi-project store (IndexedDB) ─────────────────────────────────────────

export async function saveProjectRecord(p: Project): Promise<void> {
  const thumb = Object.values(p.assets).find((a) => a.thumbnail)?.thumbnail ?? ''
  const rec: ProjectRecord = {
    id: p.id,
    name: p.name,
    updatedAt: Date.now(),
    width: p.width,
    height: p.height,
    duration: projectDuration(p),
    // strip session-scoped object URLs; they are recreated on rehydrate
    thumb: thumb.startsWith('data:') ? thumb : '',
    json: {
      ...p,
      assets: Object.fromEntries(
        Object.entries(p.assets).map(([id, a]) => [id, { ...a, url: '', thumbnail: a.thumbnail?.startsWith('data:') ? a.thumbnail : '' }]),
      ),
    },
  }
  await idb.put('projects', p.id, rec)
  try { localStorage.setItem(LAST_KEY, p.id) } catch { /* private mode */ }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await idb.getAll<ProjectRecord>('projects')
  return all
    .filter((r) => !r.template)
    .map(({ json: _json, ...summary }) => summary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function listTemplates(): Promise<ProjectSummary[]> {
  const all = await idb.getAll<ProjectRecord>('projects')
  return all
    .filter((r) => r.template)
    .map(({ json: _json, ...summary }) => summary)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Freeze the current project as a reusable template. */
export async function saveAsTemplate(p: Project, name: string, templateId: string): Promise<void> {
  const json: Project = { ...structuredClone(p), id: templateId, name }
  for (const a of Object.values(json.assets)) {
    a.url = ''
    if (!a.thumbnail?.startsWith('data:')) a.thumbnail = ''
  }
  const rec: ProjectRecord = {
    id: templateId,
    name,
    updatedAt: Date.now(),
    width: p.width,
    height: p.height,
    duration: projectDuration(p),
    thumb: Object.values(p.assets).find((a) => a.thumbnail?.startsWith('data:'))?.thumbnail ?? '',
    template: true,
    json,
  }
  await idb.put('projects', templateId, rec)
}

/** Instantiate a stored template as a fresh project (does not touch the template). */
export async function projectFromTemplate(templateId: string, newId: string): Promise<Project | null> {
  const rec = await idb.get<ProjectRecord>('projects', templateId)
  if (!rec) return null
  return { ...structuredClone(rec.json), id: newId, name: `${rec.name}` }
}

export async function loadProjectRecord(id: string): Promise<Project | null> {
  const rec = await idb.get<ProjectRecord>('projects', id)
  return rec?.json ?? null
}

/** Delete a project and any media blobs no other project references. */
export async function deleteProjectRecord(id: string): Promise<void> {
  const rec = await idb.get<ProjectRecord>('projects', id)
  await idb.delete('projects', id)
  if (!rec) return
  const remaining = await idb.getAll<ProjectRecord>('projects')
  const stillUsed = new Set(remaining.flatMap((r) => Object.keys(r.json.assets)))
  for (const assetId of Object.keys(rec.json.assets)) {
    if (!stillUsed.has(assetId)) await idb.delete('blobs', assetId)
  }
}

export async function duplicateProjectRecord(id: string, newId: string): Promise<void> {
  const rec = await idb.get<ProjectRecord>('projects', id)
  if (!rec) return
  // asset ids are shared — blobs are reference-counted by deleteProjectRecord
  const copy: ProjectRecord = {
    ...rec,
    id: newId,
    name: `${rec.name} copy`,
    updatedAt: Date.now(),
    json: { ...rec.json, id: newId, name: `${rec.name} copy` },
  }
  await idb.put('projects', newId, copy)
}

export function lastProjectId(): string | null {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

/** One-time migration from the old single-slot localStorage autosave. */
export function loadLegacyAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(LEGACY_AUTOSAVE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Project
    for (const asset of Object.values(p.assets)) asset.url = ''
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY)
    return p
  } catch {
    return null
  }
}

// ─── project files on disk (share/backup) ────────────────────────────────────

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
  // Object URLs don't survive a file round-trip — rehydrate finds blobs in
  // IndexedDB by asset id, or the Media panel re-links by filename.
  for (const asset of Object.values(p.assets)) asset.url = ''
  return p
}
