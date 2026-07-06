import type { Project, VideoClip } from '../types/model'
import { assetStore } from '../state/assetStore'
import { useEditor } from '../state/store'
import { projectDuration } from '../types/model'
import { clipSourceTime, type FrameProvider } from './compositor'
import { scheduleAudio } from './audioGraph'

/**
 * Realtime playback: a Web Audio clock drives the playhead; <video> elements
 * are kept in loose sync (re-seeked when drift exceeds threshold); audio plays
 * through scheduled AudioBufferSources for gap-free, speed-correct mixing.
 */
class PlaybackController {
  private audioCtx: AudioContext | null = null
  private sources: AudioScheduledSourceNode[] = []
  private raf = 0
  private startCtxTime = 0
  private startTimelineTime = 0
  private playToken = 0

  get context(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext()
    return this.audioCtx
  }

  async play() {
    const state = useEditor.getState()
    const project = state.project
    const from = state.currentTime >= projectDuration(project) - 0.05 ? 0 : state.currentTime
    const token = ++this.playToken

    const ctx = this.context
    await ctx.resume()
    this.stopSources()
    const when = ctx.currentTime + 0.08
    const sources = await scheduleAudio(ctx, ctx.destination, project, from, when)
    if (token !== this.playToken) { sources.forEach((s) => { try { s.stop() } catch {} }); return }
    this.sources = sources

    this.startCtxTime = when
    this.startTimelineTime = from
    useEditor.setState({ playing: true, currentTime: from })
    this.tick(token)
  }

  private tick(token: number) {
    cancelAnimationFrame(this.raf)
    const loop = () => {
      if (token !== this.playToken) return
      const state = useEditor.getState()
      const ctx = this.context
      const t = this.startTimelineTime + Math.max(0, ctx.currentTime - this.startCtxTime)
      const end = projectDuration(state.project)
      if (t >= end) {
        this.pause()
        useEditor.setState({ currentTime: end })
        return
      }
      useEditor.setState({ currentTime: t })
      this.syncVideos(state.project, t, true)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  pause() {
    this.playToken++
    cancelAnimationFrame(this.raf)
    this.stopSources()
    const { project } = useEditor.getState()
    this.syncVideos(project, useEditor.getState().currentTime, false)
    useEditor.setState({ playing: false })
  }

  seek(t: number) {
    const wasPlaying = useEditor.getState().playing
    useEditor.setState({ currentTime: Math.max(0, t) })
    if (wasPlaying) {
      this.pause()
      useEditor.setState({ currentTime: Math.max(0, t) })
      void this.play()
    } else {
      this.syncVideos(useEditor.getState().project, Math.max(0, t), false)
    }
  }

  toggle() {
    if (useEditor.getState().playing) this.pause()
    else void this.play()
  }

  private stopSources() {
    for (const s of this.sources) {
      try { s.stop() } catch { /* already stopped */ }
    }
    this.sources = []
  }

  /** Keep pooled <video> elements near the right source time. */
  private syncVideos(project: Project, t: number, playing: boolean) {
    const activeAssets = new Set<string>()
    for (const track of project.tracks) {
      if (track.hidden) continue
      for (const clip of track.clips) {
        if (clip.kind !== 'video') continue
        const inWindow = t >= clip.start - 0.3 && t < clip.start + clip.duration
        if (!inWindow) continue
        const asset = project.assets[clip.assetId]
        if (!asset?.url) continue
        activeAssets.add(clip.assetId)
        const video = assetStore.getPreviewVideo(clip.assetId, asset.url)
        const want = Math.min(Math.max(0, clipSourceTime(clip, Math.max(t, clip.start))), (asset.duration || 1) - 0.01)
        const drift = Math.abs(video.currentTime - want)
        const active = t >= clip.start
        if (playing && active) {
          video.playbackRate = Math.min(4, Math.max(0.1, clip.speed))
          if (drift > 0.2) video.currentTime = want
          if (video.paused) void video.play().catch(() => {})
        } else {
          if (!video.paused) video.pause()
          if (drift > 0.05) video.currentTime = want
        }
      }
    }
    // pause anything no longer on screen
    for (const [id, asset] of Object.entries(project.assets)) {
      if (asset.type === 'video' && !activeAssets.has(id) && asset.url) {
        const v = assetStore.getPreviewVideo(id, asset.url)
        if (!v.paused) v.pause()
      }
    }
  }
}

export const playback = new PlaybackController()

/** FrameProvider for the realtime preview: draws whatever the pooled videos show now. */
export const previewFrames: FrameProvider = {
  getVideoFrame(clip: VideoClip) {
    const { project } = useEditor.getState()
    const asset = project.assets[clip.assetId]
    if (!asset?.url) return null
    const v = assetStore.getPreviewVideo(clip.assetId, asset.url)
    return v.readyState >= 2 ? v : null
  },
  getImage(assetId: string) {
    return assetStore.getImage(assetId) ?? null
  },
}
