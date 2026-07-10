import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.topbar .logo')

// 1. synthesize a 3s test video in-page (canvas stream → MediaRecorder webm)
console.log('· recording synthetic test video…')
const made = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 640; c.height = 360
  const ctx = c.getContext('2d')
  const stream = c.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks = []
  rec.ondataavailable = (e) => chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(100)
  const t0 = performance.now()
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      // moving colored bars so frames differ visibly
      ctx.fillStyle = `hsl(${(t * 120) % 360}, 80%, 45%)`
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#fff'
      ctx.fillRect((t * 200) % c.width, 100, 80, 160)
      ctx.font = '48px sans-serif'
      ctx.fillText(t.toFixed(1), 40, 60)
      if (t < 3) requestAnimationFrame(tick)
      else resolve()
    }
    tick()
  })
  rec.stop()
  await done
  const blob = new Blob(chunks, { type: 'video/webm' })
  window.__testFile = new File([blob], 'synthetic.webm', { type: 'video/webm' })
  return blob.size
})
console.log('✓ synthetic webm:', made, 'bytes')

// 2. import it via the Media panel dropzone (already open by default)
await page.waitForSelector('.dropzone')
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(window.__testFile)
  const el = document.querySelector('.dropzone')
  el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 15000 })
console.log('✓ imported into media library')

// 3. add to timeline + overlays via scripting (exercises captions/charts/text paths)
await page.locator('.media-item').first().click()
await page.click('.sidebar button[title="Script"]')
await page.fill('.script-editor textarea', `
const [clip] = editor.clips({ kind: 'video' })
if (!clip) throw new Error('no video clip')
editor.split(clip.id, 1.5)
const vids = editor.clips({ kind: 'video' })
editor.setTransition(vids[0].id, 'zoomIn', 0.4)
editor.addEffect(vids[1].id, 'lut', { amount: 0.4, shadows: '#123a52', highlights: '#ffb86b' })
editor.addText('EXPORT TEST', 0.2, 2.5, { animation: 'wordPop', y: -420, style: { fontSize: 84 } })
editor.addChart('counter', 0.5, 2.5, { spec: { title: 'Likes', suffix: '!', data: [{label:'a',value:0},{label:'b',value:9999}] } })
editor.keyframe(vids[0].id, 'scale', 0, 1.0)
editor.keyframe(vids[0].id, 'scale', 1.4, 1.12)
editor.log('timeline clips: ' + editor.clips().length + ', duration: ' + editor.duration().toFixed(2))
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok', { timeout: 10000 })
console.log('✓ edit script:', (await page.textContent('.script-log')).replace(/\n/g, ' | '))

// 4. export via the real dialog (draft preset = index 4)
await page.click('.topbar button.primary')
await page.selectOption('.modal select', '4')
const downloadP = page.waitForEvent('download', { timeout: 120000 })
const t0 = Date.now()
await page.click('.modal button.primary')
const download = await downloadP
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
const path = await download.path()
const { statSync, readFileSync } = await import('node:fs')
const size = statSync(path).size
const head = readFileSync(path).subarray(0, 12)
const brand = head.subarray(4, 8).toString('ascii')
console.log(`✓ exported ${download.suggestedFilename()} — ${(size / 1024).toFixed(0)} KB in ${elapsed}s, container brand: ${brand}`)
if (brand !== 'ftyp') throw new Error('not an MP4 file')
if (size < 20000) throw new Error('suspiciously small export')

// 5. sanity: exported file plays back in the browser and has ~3s duration + real pixels
const check = await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
  const v = document.createElement('video')
  v.muted = true
  v.src = url
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('mp4 not decodable')) })
  v.currentTime = 1.0
  await new Promise((res) => { v.onseeked = res; setTimeout(res, 1500) })
  const c = document.createElement('canvas')
  c.width = 64; c.height = 64
  const ctx = c.getContext('2d')
  ctx.drawImage(v, 0, 0, 64, 64)
  const d = ctx.getImageData(0, 0, 64, 64).data
  let lit = 0
  for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 40) lit++
  return { duration: v.duration, lit }
}, readFileSync(path).toString('base64'))
console.log(`✓ exported mp4 decodes: duration=${check.duration.toFixed(2)}s, lit pixels=${check.lit}`)
if (Math.abs(check.duration - 3) > 0.6) throw new Error('wrong duration')
if (check.lit < 30) throw new Error('exported frames look black')

const realErrors = errors.filter((e) => !e.includes('Failed to load resource'))
if (realErrors.length) {
  console.log('PAGE ERRORS:'); realErrors.forEach((e) => console.log('  ' + e))
  process.exitCode = 1
} else {
  console.log('✓ zero page errors — export pipeline verified end-to-end')
}
await browser.close()
