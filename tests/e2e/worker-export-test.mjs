import path from 'node:path'
import os from 'node:os'
import { chromium } from 'playwright-core'

// Worker export: correctness (real MP4, right duration, real pixels) and the
// thing it exists for — the main thread staying responsive during a render.
const browser = await chromium.launch({
  executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
const workerUrls = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('worker', (w) => workerUrls.push(w.url()))

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

// synthesize a 4s clip with audio so the audio path is exercised too
await page.evaluate(async () => {
  const ac = new AudioContext()
  const dest = ac.createMediaStreamDestination()
  const osc = ac.createOscillator(); osc.frequency.value = 330
  const g = ac.createGain(); g.gain.value = 0.3
  osc.connect(g); g.connect(dest); osc.start()
  const canvas = document.createElement('canvas')
  canvas.width = 640; canvas.height = 360
  const cs = canvas.captureStream(30)
  const stream = new MediaStream([...cs.getVideoTracks(), ...dest.stream.getAudioTracks()])
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(100)
  const t0 = performance.now()
  await new Promise((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = `hsl(${(t * 80) % 360},75%,50%)`
      ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = '#fff'
      ctx.fillRect((t * 150) % 560, 140, 80, 80)
      if (t < 4) requestAnimationFrame(tick); else res()
    }
    tick()
  })
  osc.stop(); rec.stop(); await done
  const dt = new DataTransfer()
  dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'src.webm', { type: 'video/webm' }))
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 20000 })
await page.locator('.media-item').first().click()
await page.waitForSelector('.clip')

// overlays exercise text + chart rendering inside the worker realm
await page.click('.sidebar button[title="Script"]')
await page.fill('.script-editor textarea', `
editor.addText('WORKER EXPORT', 0.2, 3.5, { animation: 'wordPop', y: -420, style: { fontSize: 78 } })
editor.addChart('counter', 0.5, 3, { spec: { title: 'Likes', suffix: '!', data: [{label:'a',value:0},{label:'b',value:5000}] } })
const [v] = editor.clips({ kind: 'video' })
editor.addEffect(v.id, 'chromaKey', { keyColor: '#ffffff', tolerance: 0.2, softness: 0.1 })
editor.log('clips: ' + editor.clips().length)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
console.log('✓ project built (video + text + chart + chroma key)')

// export, and hammer the main thread with UI work while it renders
await page.click('.topbar button.primary')
await page.selectOption('.modal select', '4')
const dlP = page.waitForEvent('download', { timeout: 300000 })
const t0 = Date.now()
await page.click('.modal button:has-text("Export MP4")')
await page.waitForSelector('.export-tray')

// responsiveness probe: measure main-thread rAF latency during the render
const probe = await page.evaluate(async () => {
  const gaps = []
  let last = performance.now()
  return await new Promise((resolve) => {
    let n = 0
    const tick = () => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
      if (++n < 90) requestAnimationFrame(tick)
      else {
        gaps.sort((a, b) => a - b)
        resolve({ median: gaps[Math.floor(gaps.length / 2)], worst: gaps[gaps.length - 1] })
      }
    }
    requestAnimationFrame(tick)
  })
})
console.log(`✓ main-thread frame gaps during export: median ${probe.median.toFixed(1)}ms, worst ${probe.worst.toFixed(0)}ms`)

// still interactive mid-render
await page.locator('.clip').first().click()
const inspector = await page.textContent('.inspector h3')
console.log('✓ UI interactive during export (inspector:', inspector.trim() + ')')

const dl = await dlP
const secs = (Date.now() - t0) / 1000
const outPath = path.join(os.tmpdir(), 'cutroom-worker-export.mp4')
await dl.saveAs(outPath)
const { statSync, readFileSync } = await import('node:fs')
const size = statSync(outPath).size
const brand = readFileSync(outPath).subarray(4, 8).toString('ascii')
console.log(`✓ export finished in ${secs.toFixed(1)}s — ${(size / 1024).toFixed(0)} KB, brand ${brand}`)
if (brand !== 'ftyp') throw new Error('not an MP4')

console.log('· workers spawned:', workerUrls.length ? workerUrls.map((u) => u.split('/').pop()).join(', ') : 'none')
if (!workerUrls.some((u) => /worker/i.test(u))) throw new Error('export did not run in a Worker')

// decode the result back and check duration + pixels
const check = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
  const v = document.createElement('video')
  v.muted = true; v.src = url
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('undecodable')) })
  v.currentTime = 2
  await new Promise((res) => { v.onseeked = res; setTimeout(res, 1500) })
  const c = document.createElement('canvas'); c.width = 80; c.height = 80
  c.getContext('2d').drawImage(v, 0, 0, 80, 80)
  const d = c.getContext('2d').getImageData(0, 0, 80, 80).data
  let lit = 0
  for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 40) lit++
  return { duration: v.duration, lit }
}, readFileSync(outPath).toString('base64'))
console.log(`✓ exported mp4 decodes: ${check.duration.toFixed(2)}s, ${check.lit} lit samples`)
if (Math.abs(check.duration - 4) > 0.7) throw new Error('wrong duration: ' + check.duration)
if (check.lit < 20) throw new Error('exported frames look black')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — Worker export verified')
await browser.close()
