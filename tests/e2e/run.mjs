#!/usr/bin/env node
// E2E runner: resolves a Chromium binary, serves the production build, runs
// every suite sequentially, reports pass/fail. Used locally and in CI.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')

function resolveChromium() {
  if (process.env.CUTROOM_CHROMIUM && existsSync(process.env.CUTROOM_CHROMIUM)) return process.env.CUTROOM_CHROMIUM
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium'
  // playwright's default cache (CI: `npx playwright install chromium`)
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright')
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium')).sort().reverse()) {
      for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = path.join(cache, dir, sub)
        if (existsSync(p)) return p
      }
    }
  }
  throw new Error('No Chromium found. Set CUTROOM_CHROMIUM or run: npx playwright install chromium')
}

async function waitForServer(url, ms = 20000) {
  const start = Date.now()
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch { /* not up yet */ }
    if (Date.now() - start > ms) throw new Error(`server at ${url} did not come up`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

const SUITES = [
  'smoke.mjs',
  'ux-test.mjs',
  'captions-test.mjs',
  'tier1-test.mjs',
  'persist-test.mjs',
  'export-test.mjs',
  'triage-archive-test.mjs',
  'media-compat.mjs',
  'headline-test.mjs',
  'audio-ai-test.mjs',
  // headline2 needs the segmentation model — skipped unless fetched
  ...(existsSync(path.join(root, 'dist', 'models', 'mediapipe', 'selfie_segmenter.tflite')) ? ['headline2-test.mjs'] : []),
]

const chromium = resolveChromium()
console.log('chromium:', chromium)

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  cwd: root, stdio: 'ignore', detached: false,
})
try {
  await waitForServer('http://localhost:4173/')
  console.log('server up — running', SUITES.length, 'suites\n')

  let failed = 0
  for (const suite of SUITES) {
    const started = Date.now()
    try {
      execFileSync('node', [path.join(here, suite)], {
        cwd: here,
        stdio: 'inherit',
        env: { ...process.env, CUTROOM_CHROMIUM: chromium },
        timeout: 10 * 60 * 1000,
      })
      console.log(`✅ ${suite} (${((Date.now() - started) / 1000).toFixed(0)}s)\n`)
    } catch {
      failed++
      console.log(`❌ ${suite}\n`)
    }
  }
  console.log(failed ? `${failed}/${SUITES.length} suites FAILED` : `all ${SUITES.length} suites passed`)
  process.exitCode = failed ? 1 : 0
} finally {
  server.kill()
}
