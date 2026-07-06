import { createScriptApi } from './api'

export interface ScriptResult {
  ok: boolean
  logs: string[]
  error?: string
  /** ms */
  elapsed: number
}

/**
 * Runs a user script with the `editor` API in scope. Scripts are local
 * user-authored automation (same trust level as the app itself); they execute
 * as an async function so `await editor.transcribe(...)` just works.
 */
export async function runScript(code: string): Promise<ScriptResult> {
  const logs: string[] = []
  const log = (msg: unknown) => {
    logs.push(typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2))
  }
  const editor = createScriptApi(log)
  const started = performance.now()
  try {
    const fn = new Function(
      'editor',
      'console',
      `"use strict"; return (async () => { ${code}\n })()`,
    )
    await fn(editor, { log, warn: log, error: log })
    return { ok: true, logs, elapsed: performance.now() - started }
  } catch (e) {
    return {
      ok: false,
      logs,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      elapsed: performance.now() - started,
    }
  }
}

export const EXAMPLE_SCRIPTS: { label: string; code: string }[] = [
  {
    label: 'Rough cut: first video + captions',
    code: `// Auto-caption the first video clip on the timeline
const [clip] = editor.clips({ kind: 'video' })
if (!clip) throw new Error('Add a video clip first')
await editor.autoCaption(clip.id)
`,
  },
  {
    label: 'Remove silences + filler words',
    code: `const [clip] = editor.clips({ kind: 'video' })
if (!clip) throw new Error('Add a video clip first')
await editor.removeSilences(clip.id)
await editor.removeFillerWords(clip.id)
`,
  },
  {
    label: 'Beat-synced montage',
    code: `// Split the first video clip on every 2nd beat of its own audio
const [clip] = editor.clips({ kind: 'video' })
if (!clip) throw new Error('Add a video clip first')
const beats = await editor.detectBeats(clip.assetId)
beats.filter((_, i) => i % 2 === 0).forEach((b) => {
  const t = clip.start + (b - clip.offset) / clip.speed
  if (t > clip.start && t < clip.start + clip.duration) editor.split(clip.id, t)
})
// add a punchy transition on every cut
editor.clips({ kind: 'video' }).slice(0, -1).forEach((c) => editor.setTransition(c.id, 'zoomIn', 0.25))
`,
  },
  {
    label: 'Likes counter + growth chart outro',
    code: `const end = editor.duration()
editor.addChart('counter', Math.max(0, end - 4), 4, {
  spec: { title: 'Likes', suffix: ' ❤️', data: [{ label: 'from', value: 0 }, { label: 'to', value: 250000 }] },
})
editor.addChart('line', Math.max(0, end - 4), 4, {
  spec: { title: 'Followers this week', animateIn: 'draw' },
})
`,
  },
  {
    label: 'Hook + CTA text',
    code: `editor.addText('WAIT FOR IT…', 0, 2, {
  style: { fontSize: 90, uppercase: true, strokeWidth: 10 },
  animation: 'shake', y: -500,
})
const end = editor.duration()
editor.addText('FOLLOW FOR MORE 🔥', Math.max(0, end - 2.5), 2.5, {
  animation: 'popIn', y: 520,
})
editor.addSticker('🔥', Math.max(0, end - 2.5), 2.5, { animation: 'pulse', x: 380, y: 300 })
`,
  },
  {
    label: 'Highlight reel from raw footage',
    code: `// Pull the 3 most energetic 4-second moments into a fresh cut
const assets = editor.assets().filter((a) => a.type === 'video')
if (!assets.length) throw new Error('Import a video first')
const asset = assets[0]
const highlights = await editor.findHighlights(asset.id, 3, 4)
const track = editor.tracks().find((t) => t.kind === 'video')
let at = editor.duration()
for (const h of highlights) {
  const c = editor.addVideoClip(asset.id, track.id, at, { offset: h.start, duration: h.end - h.start })
  editor.setTransition(c.id, 'crossfade', 0.3)
  at += h.end - h.start
}
editor.log('Built a ' + at.toFixed(1) + 's highlight reel')
`,
  },
  {
    label: 'Ken Burns zoom on everything',
    code: `for (const c of editor.clips({ kind: 'video' })) {
  editor.keyframe(c.id, 'scale', 0, 1.0)
  editor.keyframe(c.id, 'scale', c.duration, 1.12)
}
editor.log('Applied slow zoom to ' + editor.clips({ kind: 'video' }).length + ' clips')
`,
  },
]
