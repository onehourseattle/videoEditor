import { useRef, useState } from 'react'
import type { AudioClip, VideoClip, ImageClip, AssetMeta } from '../../types/model'
import { defaultTransform } from '../../types/model'
import { useEditor, addClipToTrack, projectDuration } from '../../state/store'
import { assetStore } from '../../state/assetStore'
import { uid } from '../../utils/id'
import { formatTime } from '../../utils/time'

export function MediaPanel() {
  const project = useEditor((s) => s.project)
  const updateProject = useEditor((s) => s.updateProject)
  const setBusy = useEditor((s) => s.setBusy)
  const fileRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const importFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        setBusy(`Importing ${file.name}…`)
        // re-link: if a project asset with the same name is missing its URL, adopt it
        const orphan = Object.values(project.assets).find((a) => a.name === file.name && !a.url)
        const meta = await assetStore.importFile(file)
        if (orphan) {
          const relinked: AssetMeta = { ...meta, id: orphan.id }
          updateProject((p) => ({ ...p, assets: { ...p.assets, [orphan.id]: relinked } }))
        } else {
          updateProject((p) => ({ ...p, assets: { ...p.assets, [meta.id]: meta } }))
        }
      } catch (e) {
        alert(`Could not import ${file.name}: ${e instanceof Error ? e.message : e}`)
      } finally {
        setBusy(null)
      }
    }
  }

  const addToTimeline = (asset: AssetMeta) => {
    const p = useEditor.getState().project
    const at = projectDuration(p)
    if (asset.type === 'audio') {
      const track = p.tracks.find((t) => t.kind === 'audio')
      if (!track) return
      const clip: AudioClip = {
        id: uid('clip'), kind: 'audio', assetId: asset.id, name: asset.name,
        start: 0, duration: asset.duration, offset: 0, speed: 1, volume: 1, muted: false,
        fadeIn: 0, fadeOut: 0, transform: defaultTransform(), effects: [],
      }
      updateProject((pr) => addClipToTrack(pr, track.id, clip))
      return
    }
    const track = p.tracks.find((t) => t.kind === 'video')
    if (!track) return
    const end = track.clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0)
    void at
    if (asset.type === 'video') {
      const clip: VideoClip = {
        id: uid('clip'), kind: 'video', assetId: asset.id, name: asset.name,
        start: end, duration: asset.duration, offset: 0, speed: 1, volume: 1, muted: false,
        transform: defaultTransform(), effects: [],
      }
      updateProject((pr) => addClipToTrack(pr, track.id, clip))
    } else {
      const clip: ImageClip = {
        id: uid('clip'), kind: 'image', assetId: asset.id, name: asset.name,
        start: end, duration: 4, transform: defaultTransform(), effects: [],
      }
      updateProject((pr) => addClipToTrack(pr, track.id, clip))
    }
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
            <div key={a.id} className="media-item" onClick={() => addToTimeline(a)} title="Click to add to timeline">
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
