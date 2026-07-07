import { create } from 'zustand'
import type { Project } from '../types/model'
import { exportProject, type ExportSettings, type ExportProgress } from './exporter'
import { uid } from '../utils/id'
import { useEditor } from '../state/store'

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface ExportJob {
  id: string
  label: string
  /** immutable snapshot — you keep editing while this renders */
  project: Project
  settings: ExportSettings
  status: JobStatus
  progress: ExportProgress | null
  error?: string
  url?: string
  size?: number
  cancelSignal: { cancelled: boolean }
}

interface ExportQueueState {
  jobs: ExportJob[]
  enqueue: (project: Project, settings: ExportSettings, label: string) => void
  cancel: (id: string) => void
  remove: (id: string) => void
  clearFinished: () => void
}

let running = false

async function pump() {
  if (running) return
  running = true
  try {
    for (;;) {
      const job = useExportQueue.getState().jobs.find((j) => j.status === 'queued')
      if (!job) break
      patch(job.id, { status: 'running' })
      try {
        const blob = await exportProject(
          job.project,
          job.settings,
          (progress) => patch(job.id, { progress }),
          job.cancelSignal,
        )
        const url = URL.createObjectURL(blob)
        patch(job.id, { status: 'done', url, size: blob.size, progress: { phase: 'done', progress: 1 } })
        autoDownload(url, job.label)
        useEditor.getState().toast(`Exported ${job.label} (${(blob.size / 1e6).toFixed(1)} MB)`, 'ok')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (job.cancelSignal.cancelled) {
          patch(job.id, { status: 'cancelled' })
        } else {
          patch(job.id, { status: 'error', error: msg })
          useEditor.getState().toast(`Export failed: ${msg}`, 'error')
        }
      }
    }
  } finally {
    running = false
  }
}

function patch(id: string, fields: Partial<ExportJob>) {
  useExportQueue.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...fields } : j)) }))
}

function autoDownload(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

export const useExportQueue = create<ExportQueueState>((set) => ({
  jobs: [],

  enqueue: (project, settings, label) => {
    const job: ExportJob = {
      id: uid('job'),
      label,
      project,
      settings,
      status: 'queued',
      progress: null,
      cancelSignal: { cancelled: false },
    }
    set((s) => ({ jobs: [...s.jobs, job] }))
    void pump()
  },

  cancel: (id) => {
    const job = useExportQueue.getState().jobs.find((j) => j.id === id)
    if (!job) return
    if (job.status === 'queued') patch(id, { status: 'cancelled' })
    else if (job.status === 'running') job.cancelSignal.cancelled = true
  },

  remove: (id) => {
    const job = useExportQueue.getState().jobs.find((j) => j.id === id)
    if (job?.url) URL.revokeObjectURL(job.url)
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  },

  clearFinished: () =>
    set((s) => {
      for (const j of s.jobs) {
        if (j.url && j.status !== 'running' && j.status !== 'queued') URL.revokeObjectURL(j.url)
      }
      return { jobs: s.jobs.filter((j) => j.status === 'running' || j.status === 'queued') }
    }),
}))

// don't let the tab close mid-render without a word
window.addEventListener('beforeunload', (e) => {
  const active = useExportQueue.getState().jobs.some((j) => j.status === 'running' || j.status === 'queued')
  if (active) {
    e.preventDefault()
    e.returnValue = ''
  }
})
