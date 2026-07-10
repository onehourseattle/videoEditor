import { chromium } from 'playwright-core'

// Persistence across reload: import media + build a timeline, reload the page,
// expect the project AND its media to come back with zero re-linking.
const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

// synthesize + import a real video file
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const ctx = c.getContext('2d')
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' })
  const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(100)
  const t0 = performance.now()
  await new Promise((res) => { const tick = () => { const t = (performance.now() - t0) / 1000
    ctx.fillStyle = `hsl(${(t * 200) % 360},70%,50%)`; ctx.fillRect(0,0,640,360)
    if (t < 2) requestAnimationFrame(tick); else res() }; tick() })
  rec.stop(); await done
  const dt = new DataTransfer()
  dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'persist-me.webm', { type: 'video/webm' }))
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 15000 })

// add it to the timeline + rename the project
await page.locator('.media-item').first().click()
await page.waitForSelector('.clip')
await page.fill('.topbar .project-name', 'Persistence proof')
await page.waitForTimeout(1600) // autosave debounce + IDB write
console.log('✓ imported, placed on timeline, autosaved')

// ── reload ──
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.clip', { timeout: 15000 })
console.log('✓ timeline restored after reload')

const name = await page.inputValue('.topbar .project-name')
if (name !== 'Persistence proof') throw new Error(`project name lost: "${name}"`)
console.log('✓ project name restored:', name)

const mediaText = await page.textContent('.media-item .meta')
if (mediaText.includes('⚠️')) throw new Error('media needed re-linking after reload')
console.log('✓ media re-hydrated from IndexedDB (no re-link):', mediaText.trim())

// media must be genuinely usable: preview paints video pixels after reload
await page.waitForTimeout(1200)
const lit = await page.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let n = 0, total = 0
  for (let i = 0; i < d.length; i += 40) { total++; if (d[i] + d[i + 1] + d[i + 2] > 40) n++ }
  return (100 * n) / total
})
console.log(`✓ preview paints restored video: ${lit.toFixed(1)}% lit`)
if (lit < 10) throw new Error('restored video does not render')

// ── project manager ──
await page.click('.topbar button:has-text("Projects")')
await page.waitForSelector('.project-card')
const cards = await page.locator('.project-card').count()
console.log('✓ projects modal lists', cards, 'project(s)')
await page.click('.modal button:has-text("New project")')
await page.waitForSelector('.empty-state')
console.log('✓ new project created (empty state)')
await page.click('.topbar button:has-text("Projects")')
await page.waitForSelector('.project-card')
const cards2 = await page.locator('.project-card').count()
if (cards2 < 2) throw new Error('expected 2+ projects, got ' + cards2)
// switch back to the first project
await page.locator('.project-card:has-text("Persistence proof")').click()
await page.waitForSelector('.clip', { timeout: 15000 })
console.log('✓ switched back — clips and media intact')

// ── export queue: keep-editing while rendering ──
await page.click('.topbar button.primary') // Export
await page.selectOption('.modal select', '4') // draft preset
const downloadP = page.waitForEvent('download', { timeout: 120000 })
await page.click('.modal button:has-text("Export MP4")')
await page.waitForSelector('.export-tray')
console.log('✓ export queued in tray, dialog closed')
// prove the UI is alive during export: select a clip
await page.locator('.clip').first().click()
const inspTitle = await page.textContent('.inspector h3')
console.log('✓ still editable during export (inspector:', inspTitle.trim() + ')')
const download = await downloadP
console.log('✓ export finished + auto-downloaded:', download.suggestedFilename())
await page.waitForSelector('.tray-job .tj-dl') // save button appears when done

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — release 1 verified')
await browser.close()
