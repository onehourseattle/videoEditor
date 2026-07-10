import { chromium } from 'playwright-core'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Media compatibility: every format either imports cleanly or degrades with a
 * readable error toast — never a crash. Browser-synthesized fixtures (PNG,
 * JPEG, WAV, corrupt MP4) plus a full dogfood loop: export an MP4 with the
 * app, re-import it, put it on the timeline.
 *
 * Drop real files (iPhone .mov, HEVC, VFR…) into tests/fixtures/ and they are
 * picked up automatically with the same works-or-degrades assertion.
 */
const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

const drop = (key) => page.evaluate((k) => {
  const dt = new DataTransfer()
  dt.items.add(window[k])
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
}, key)

// ── synthesize fixtures in-page ──
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 320; c.height = 240
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#c0448f'; ctx.fillRect(0, 0, 320, 240)
  ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.fillText('IMG', 100, 130)
  const toFile = (type, name) => new Promise((res) => c.toBlob((b) => res(new File([b], name, { type })), type, 0.9))
  window.__png = await toFile('image/png', 'still.png')
  window.__jpg = await toFile('image/jpeg', 'photo.jpg')

  // WAV: 1s 440Hz sine, 16-bit PCM mono — plain RIFF encode
  const sr = 44100
  const n = sr
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const w = (off, s) => [...s].forEach((ch, i) => dv.setUint8(off + i, ch.charCodeAt(0)))
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  w(36, 'data'); dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin((i / sr) * 440 * 2 * Math.PI) * 12000), true)
  window.__wav = new File([buf], 'tone.wav', { type: 'audio/wav' })

  // corrupt "mp4": random bytes with a video mime
  const junk = new Uint8Array(4096)
  crypto.getRandomValues(junk)
  window.__corrupt = new File([junk], 'corrupt.mp4', { type: 'video/mp4' })
})

// valid formats import cleanly
for (const [key, name] of [['__png', 'still.png'], ['__jpg', 'photo.jpg'], ['__wav', 'tone.wav']]) {
  await drop(key)
  await page.waitForSelector(`.media-item:has-text("${name}")`, { timeout: 15000 })
  console.log(`✓ imported ${name}`)
}

// corrupt file degrades with a toast, no crash
await drop('__corrupt')
await page.waitForSelector('.toast.error', { timeout: 15000 })
const corruptListed = await page.locator('.media-item:has-text("corrupt.mp4")').count()
console.log('✓ corrupt.mp4 rejected gracefully (error toast, listed:', corruptListed === 0, ')')
if (corruptListed) throw new Error('corrupt file should not be imported')

// ── dogfood: export an MP4 with the app, re-import it ──
await page.locator('.media-item:has-text("still.png")').click()
await page.locator('.media-item:has-text("tone.wav")').click()
await page.waitForSelector('.clip')
await page.click('.topbar button.primary')
await page.selectOption('.modal select', '4')
const dlP = page.waitForEvent('download', { timeout: 180000 })
await page.click('.modal button:has-text("Export MP4")')
const dl = await dlP
const mp4Path = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tmp-compat.mp4')
await dl.saveAs(mp4Path)
console.log('✓ exported MP4 from PNG + WAV timeline')

// import the exported mp4 back through the media file input
await page.evaluate(() => document.querySelector('.export-tray')?.remove())
const mediaInput = page.locator('input[accept="video/*,audio/*,image/*"]')
await mediaInput.setInputFiles(mp4Path)
await page.waitForSelector('.media-item:has-text("tmp-compat.mp4")', { timeout: 20000 })
console.log('✓ app-exported MP4 re-imports (full encode/decode round-trip)')

// ── user-provided real-world fixtures, if any ──
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const fixtures = existsSync(fixturesDir)
  ? readdirSync(fixturesDir).filter((f) => !f.startsWith('.') && f !== 'README.md')
  : []
for (const f of fixtures) {
  const before = errors.length
  await mediaInput.setInputFiles(path.join(fixturesDir, f))
  // pass = it appears in the library OR an error toast explains why not
  const outcome = await Promise.race([
    page.waitForSelector(`.media-item:has-text("${f}")`, { timeout: 20000 }).then(() => 'imported'),
    page.waitForSelector('.toast.error', { timeout: 20000 }).then(() => 'graceful-error'),
  ]).catch(() => 'timeout')
  if (outcome === 'timeout' || errors.length > before) throw new Error(`fixture ${f}: ${outcome}, new page errors: ${errors.slice(before).join('; ')}`)
  console.log(`✓ fixture ${f}: ${outcome}`)
}
if (!fixtures.length) console.log('· no files in tests/fixtures — drop real iPhone/DSLR clips there to extend this suite')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — media compatibility verified')
await browser.close()
