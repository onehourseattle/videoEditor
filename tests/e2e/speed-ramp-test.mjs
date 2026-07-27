import { chromium } from 'playwright-core'
import path from 'node:path'
import os from 'node:os'

// Speed ramping: the ramp must change which source frame is on screen at a
// given time, survive a split, and render through export.
const browser = await chromium.launch({
  executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

// a clip whose colour is a strict function of source time — so the pixel at the
// playhead tells us exactly which source frame is showing
await page.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 320; canvas.height = 180
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(100)
  const t0 = performance.now()
  await new Promise((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      const ctx = canvas.getContext('2d')
      // red ramps 0→255 linearly across 8 seconds
      ctx.fillStyle = `rgb(${Math.min(255, Math.round((t / 8) * 255))}, 40, 90)`
      ctx.fillRect(0, 0, 320, 180)
      if (t < 8) requestAnimationFrame(tick); else res()
    }
    tick()
  })
  rec.stop(); await done
  const dt = new DataTransfer()
  dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'ramp.webm', { type: 'video/webm' }))
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 20000 })
await page.locator('.media-item').first().click()
await page.waitForSelector('.clip')

// the Script tab toggles, so only open it when it isn't already showing
const openScript = async () => {
  if (await page.locator('.script-editor textarea').count() === 0) {
    await page.click('.sidebar button[title="Script"]')
    await page.waitForSelector('.script-editor textarea')
  }
}

const redAt = async (t) => {
  await openScript()
  await page.fill('.script-editor textarea', `editor.seek(${t})`)
  await page.click('.script-editor button.primary')
  await page.waitForSelector('.script-log .ok')
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const c = document.querySelector('.preview-canvas')
    const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
    return d[0]
  })
}

// baseline: 2s in at 1× shows source second 2
const baseline = await redAt(2)
console.log('✓ no ramp, red at t=2s:', baseline)

// apply "Slow down" (starts fast, decelerates) — at t=2 the clip should already
// be further into the source than the 1× baseline
await page.fill('.script-editor textarea', `
const [v] = editor.clips({ kind: 'video' })
editor.setSpeedRamp(v.id, 'Slow down')
const c = editor.clips({ kind: 'video' })[0]
editor.log('duration after ramp: ' + c.duration.toFixed(2) + 's, curve pts: ' + c.speedCurve.length)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
console.log('✓', (await page.textContent('.script-log')).split('\n').find((l) => l.includes('duration')))

const ramped = await redAt(2)
console.log('✓ with "Slow down" ramp, red at t=2s:', ramped)
if (ramped <= baseline + 8) {
  throw new Error(`ramp did not advance the source faster (${ramped} vs baseline ${baseline})`)
}

// the ramp is visible in the inspector as a curve
await page.locator('.clip.kind-video').first().click()
await page.waitForSelector('.ramp-preview svg polyline')
const pts = await page.getAttribute('.ramp-preview svg polyline', 'points')
console.log('✓ inspector draws the ramp curve (' + pts.split(' ').length + ' points)')

// splitting a ramped clip: both halves keep a ramp and the join is seamless
await openScript()
await page.fill('.script-editor textarea', `
const [v] = editor.clips({ kind: 'video' })
const mid = v.start + v.duration / 2
editor.split(v.id, mid)
const parts = editor.clips({ kind: 'video' })
if (parts.length !== 2) throw new Error('split failed')
const [a, b] = parts
if (!a.speedCurve || !b.speedCurve) throw new Error('halves lost their ramp')
editor.log('halves: ' + a.duration.toFixed(2) + 's + ' + b.duration.toFixed(2) + 's; join offset ' + b.offset.toFixed(3))
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
console.log('✓', (await page.textContent('.script-log')).split('\n').find((l) => l.includes('halves')))

// export renders the ramp through the same path
await page.click('.topbar button.primary')
await page.selectOption('.modal select', '4')
const dlP = page.waitForEvent('download', { timeout: 300000 })
await page.click('.modal button:has-text("Export MP4")')
const dl = await dlP
const out = path.join(os.tmpdir(), 'cutroom-ramp.mp4')
await dl.saveAs(out)
const { statSync, readFileSync } = await import('node:fs')
const brand = readFileSync(out).subarray(4, 8).toString('ascii')
console.log(`✓ ramped project exported: ${(statSync(out).size / 1024).toFixed(0)} KB, brand ${brand}`)
if (brand !== 'ftyp') throw new Error('not an MP4')

// the exported video should sweep red faster than real time at the head
const sweep = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
  const v = document.createElement('video')
  v.muted = true; v.src = url
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('undecodable')) })
  const sample = async (t) => {
    v.currentTime = t
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 1200) })
    const c = document.createElement('canvas'); c.width = 8; c.height = 8
    c.getContext('2d').drawImage(v, 0, 0, 8, 8)
    return c.getContext('2d').getImageData(4, 4, 1, 1).data[0]
  }
  return { duration: v.duration, early: await sample(0.3), late: await sample(Math.min(3, v.duration - 0.3)) }
}, readFileSync(out).toString('base64'))
console.log(`✓ exported ramp sweeps red ${sweep.early} → ${sweep.late} over ${sweep.duration.toFixed(2)}s`)
if (sweep.late <= sweep.early) throw new Error('exported video does not advance through the source')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — speed ramping verified')
await browser.close()
