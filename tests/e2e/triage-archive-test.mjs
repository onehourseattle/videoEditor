import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

// import a synthetic video with varied audio energy (for segment scoring)
await page.evaluate(async () => {
  const ac = new AudioContext()
  const dest = ac.createMediaStreamDestination()
  const osc = ac.createOscillator(); osc.frequency.value = 300
  const g = ac.createGain(); g.gain.value = 0.1
  osc.connect(g); g.connect(dest)
  osc.start()
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
      // vary loudness in waves + brief gaps so segments differ
      g.gain.value = (Math.floor(t / 1.5) % 2 === 0) ? 0.08 : 0.5 * (0.6 + 0.4 * Math.sin(t * 3))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = `hsl(${(t * 60) % 360},70%,45%)`
      ctx.fillRect(0, 0, 640, 360)
      if (t < 8) requestAnimationFrame(tick); else res()
    }
    tick()
  })
  osc.stop(); rec.stop(); await done
  const dt = new DataTransfer()
  dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'long.webm', { type: 'video/webm' }))
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 20000 })
await page.locator('.media-item').first().click()
await page.waitForSelector('.clip')
await page.fill('.topbar .project-name', 'Archive me')
await page.waitForTimeout(1200)
console.log('✓ media imported and on timeline')

// ── shorts triage cards ──
await page.click('.sidebar button[title="AI"]')
await page.locator('.ai-card:has-text("Shorts") button').click()
await page.waitForSelector('.shorts-card', { timeout: 60000 })
const cards = await page.locator('.shorts-card').count()
const hasThumb = await page.locator('.shorts-card img').count()
console.log(`✓ triage modal: ${cards} ranked cards, ${hasThumb} with thumbnails`)
if (cards < 1) throw new Error('no candidate cards')
await page.locator('.shorts-card button:has-text("Create")').first().click()
await page.waitForSelector('.toast:has-text("Short project(s) created")')
console.log('✓ created one Short from its card')

// ── archive export ──
await page.click('.topbar button:has-text("Projects")')
const dlP = page.waitForEvent('download')
await page.click('button:has-text("Archive current")')
const dl = await dlP
const pkgPath = new URL('./tmp-archive.cutroompkg', import.meta.url).pathname
await dl.saveAs(pkgPath)
const { statSync } = await import('node:fs')
console.log(`✓ archive exported: ${dl.suggestedFilename()} (${(statSync(pkgPath).size / 1e6).toFixed(1)} MB)`)
await page.click('.modal button:has-text("Close")')

// ── wipe everything (fresh context = new machine) and restore from the archive ──
await context.close()
const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page2 = await context2.newPage()
page2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message))
page2.on('console', (m) => { if (m.type() === 'error') errors.push('console2: ' + m.text()) })
await page2.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page2.waitForSelector('.empty-state') // brand-new browser: nothing here
console.log('✓ fresh browser context is empty (simulates another machine)')

await page2.locator('.topbar input[type="file"]').setInputFiles(pkgPath)
await page2.waitForSelector('.toast:has-text("Package restored")', { timeout: 30000 })
await page2.waitForSelector('.clip', { timeout: 15000 })
const name = await page2.inputValue('.topbar .project-name')
const mediaMeta = await page2.textContent('.media-item .meta')
console.log(`✓ package restored on the "new machine": project "${name}", media: ${mediaMeta.trim()}`)
if (name !== 'Archive me') throw new Error('project name lost in archive round-trip')
if (mediaMeta.includes('⚠️')) throw new Error('media not restored from archive')

// restored media actually renders
await page2.waitForTimeout(1200)
const lit = await page2.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let n = 0, total = 0
  for (let i = 0; i < d.length; i += 40) { total++; if (d[i] + d[i + 1] + d[i + 2] > 40) n++ }
  return (100 * n) / total
})
console.log(`✓ restored video renders: ${lit.toFixed(0)}% lit`)
if (lit < 10) throw new Error('restored video did not render')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — triage + archive verified')
await browser.close()
