import type { Project } from '../types/model'
import { assetStore } from './assetStore'
import { idb } from './db'

/**
 * .cutroompkg — a whole project (JSON + every media blob) in ONE portable
 * file. Backup, hand-off between machines, agency delivery. Layout:
 *
 *   bytes 0-3   magic "CRPK"
 *   bytes 4-7   uint32 LE: manifest JSON byte length
 *   ...         manifest JSON { version, project, blobs: [{id, size}] }
 *   ...         blob bytes, concatenated in manifest order
 *
 * Written with Blob parts (no full-file buffering) and read with File.slice,
 * so multi-GB archives don't blow up memory.
 */

const MAGIC = 0x4352504b // "CRPK"

export async function exportArchive(project: Project): Promise<Blob> {
  const manifestBlobs: { id: string; size: number }[] = []
  const parts: Blob[] = []
  for (const asset of Object.values(project.assets)) {
    const blob = assetStore.getBlob(asset.id) ?? (await idb.get<Blob>('blobs', asset.id))
    if (!blob) continue
    manifestBlobs.push({ id: asset.id, size: blob.size })
    parts.push(blob)
  }
  const cleanProject: Project = {
    ...project,
    assets: Object.fromEntries(
      Object.entries(project.assets).map(([id, a]) => [
        id,
        { ...a, url: '', thumbnail: a.thumbnail?.startsWith('data:') ? a.thumbnail : '' },
      ]),
    ),
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify({ version: 1, project: cleanProject, blobs: manifestBlobs }),
  )
  const header = new ArrayBuffer(8)
  const dv = new DataView(header)
  dv.setUint32(0, MAGIC)
  dv.setUint32(4, manifest.byteLength, true)
  return new Blob([header, manifest, ...parts], { type: 'application/octet-stream' })
}

export function isArchive(file: File): boolean {
  return /\.cutroompkg$/i.test(file.name)
}

/** Restore a .cutroompkg: media blobs land in IndexedDB, project is returned. */
export async function importArchive(file: File): Promise<Project> {
  const dv = new DataView(await file.slice(0, 8).arrayBuffer())
  if (dv.getUint32(0) !== MAGIC) throw new Error('Not a CutRoom package file')
  const manifestLen = dv.getUint32(4, true)
  const manifest = JSON.parse(await file.slice(8, 8 + manifestLen).text()) as {
    version: number
    project: Project
    blobs: { id: string; size: number }[]
  }
  let offset = 8 + manifestLen
  for (const entry of manifest.blobs) {
    const asset = manifest.project.assets[entry.id]
    const blob = file.slice(offset, offset + entry.size, guessMime(asset?.type))
    offset += entry.size
    await idb.put('blobs', entry.id, blob)
  }
  const { migrateProject } = await import('./migrate')
  return migrateProject(manifest.project)
}

function guessMime(type?: string): string {
  if (type === 'video') return 'video/mp4'
  if (type === 'audio') return 'audio/mpeg'
  if (type === 'image') return 'image/png'
  return 'application/octet-stream'
}
