import { useRef, useState } from 'react'
import type { AssetMeta } from '../../types/model'
import { useEditor, addClipToTrack } from '../../state/store'
import { assetStore } from '../../state/assetStore'
import { makeClipFromAsset, trackAccepts, ASSET_DRAG_MIME } from '../../state/clipFactory'
import { formatTime } from '../../utils/time'

export function MediaPanel() {
  const project = useEditor((s) => s.project)
  const updateProject = useEditor((s) => s.updateProject)
  const setBusy = useEditor((s) => s.setBusy)
  const toast = useEditor((s) => s.toast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const importFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        setBusy(`Importing ${file.name}…`)
        // re-link: if a project asset with the same name is missing its URL, adopt it
        const orphan = Object.values(useEditor.getState().project.assets).find((a) => a.name === file.name && !a.url)
        const meta = await assetStore.importFile(file)
        if (orphan) {
          const relinked: AssetMeta = { ...meta, id: orphan.id }
          assetStore.adopt(meta.id, orphan.id) // blob must answer to the re-linked id too
          updateProject((p) => ({ ...p, assets: { ...p.assets, [orphan.id]: relinked } }))
          toast(`Re-linked ${file.name}`, 'ok')
        } else {
          updateProject((p) => ({ ...p, assets: { ...p.assets, [meta.id]: meta } }))
        }
      } catch (e) {
        toast(`Could not import ${file.name}: ${e instanceof Error ? e.message : e}`, 'error')
      } finally {
        setBusy(null)
      }
    }
  }

  /** Click: append after the last clip on the first compatible track. */
  const addToTimeline = (asset: AssetMeta) => {
    const p = useEditor.getState().project
    const clip = makeClipFromAsset(asset, 0)
    const track = p.tracks.find((t) => trackAccepts(clip, t) && !t.locked)
    if (!track) {
      toast('No unlocked compatible track for this media', 'error')
      return
    }
    clip.start = track.clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0)
    updateProject((pr) => addClipToTrack(pr, track.id, clip))
    toast(`Added to ${track.name} — or drag items straight onto the timeline`, 'ok')
  }

  const assets = Object.values(project.assets)

  return (
    <>
      <h3>Media</h3>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void importFiles(e.dataTransfer.files) }}
      >
        Drop video / audio / images here
        <br />or click to browse
      </div>
      <input
        ref={fileRef} type="file" multiple hidden
        accept="video/*,audio/*,image/*"
        onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.target.value = '' }}
      />
      {assets.length > 0 && (
        <div className="media-grid">
          {assets.map((a) => (
            <div
              key={a.id}
              className="media-item"
              draggable={!!a.url}
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_DRAG_MIME, a.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => addToTimeline(a)}
              title="Click to append, or drag onto the timeline"
            >
              {a.thumbnail ? (
                <img src={a.thumbnail} alt="" />
              ) : (
                <div className="placeholder">{a.type === 'audio' ? '🎵' : a.type === 'video' ? '🎞' : '🖼'}</div>
              )}
              <div className="meta">
                {!a.url && '⚠️ '}
                {a.name}
                {a.duration > 0 ? ` · ${formatTime(a.duration)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {assets.some((a) => !a.url) && (
        <p className="hint">⚠️ Some assets need re-linking: re-import files with the same names.</p>
      )}
      <p className="hint">
        Everything stays on this machine — files are never uploaded anywhere.
      </p>
    </>
  )
}
