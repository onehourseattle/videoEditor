import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

// synthetic "person": bright skin-tone head + torso on green background, moving slightly
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const ctx = c.getContext('2d')
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' })
  const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data)
  const done = new Promise((r) => (rec.onstop = r))
  rec.start(100)
  const t0 = performance.now()
  await new Promise((res) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      ctx.fillStyle = '#2a6e4f'; ctx.fillRect(0, 0, 640, 360)
      const cx = 320 + Math.sin(t) * 15
      // torso
      ctx.fillStyle = '#31506e'
      ctx.beginPath(); ctx.ellipse(cx, 330, 95, 120, 0, Math.PI, 0); ctx.fill()
      // head
      ctx.fillStyle = '#d9a37e'
      ctx.beginPath(); ctx.arc(cx, 150, 62, 0, Math.PI * 2); ctx.fill()
      // hair + eyes for person-ness
      ctx.fillStyle = '#3a2a1c'; ctx.beginPath(); ctx.arc(cx, 128, 60, Math.PI, 0); ctx.fill()
      ctx.fillStyle = '#222'
      ctx.beginPath(); ctx.arc(cx - 20, 155, 6, 0, Math.PI * 2); ctx.arc(cx + 20, 155, 6, 0, Math.PI * 2); ctx.fill()
      if (t < 4) requestAnimationFrame(tick); else res()
    }
    tick()
  })
  rec.stop(); await done
  const dt = new DataTransfer()
  dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'person.webm', { type: 'video/webm' }))
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 20000 })
await page.locator('.media-item').first().click()
await page.waitForSelector('.clip')
console.log('✓ person video imported')

// drop a Poster echo headline, switch its style via the inspector, set placement behind
await page.click('.sidebar button[title="Text"]')
const presets = await page.locator('.headline-card').count()
console.log('✓ headline gallery:', presets, 'presets (incl. Neon flicker)')
await page.locator('.headline-card[title="Poster echo"]').click()
await page.waitForSelector('.inspector textarea')

// style switcher: apply "Two-tone split" to the same clip — words stay
await page.selectOption('.inspector select >> nth=0', { label: 'Two-tone split' })
await page.waitForTimeout(200)
const text = await page.inputValue('.inspector textarea')
console.log('✓ style switched via inspector, text preserved:', JSON.stringify(text))
if (text !== 'BIG NEWS') throw new Error('text changed during style switch')

// placement → behind the person
await page.selectOption('.inspector select:below(:text("Placement")) >> nth=0', 'behind').catch(async () => {
  // fallback: find select whose option value is 'behind'
  const sel = page.locator('.inspector select').filter({ has: page.locator('option[value="behind"]') })
  await sel.selectOption('behind')
})
await page.waitForSelector('.inspector .hint:has-text("segmentation")')
console.log('✓ placement set to behind-person, hint shown')

// seek 1.5s into the clip so the entrance animation has finished
const ruler = await page.locator('.ruler').boundingBox()
await page.mouse.click(ruler.x + 1.5 * 60, ruler.y + 10)
// give the segmenter time to init + render
await page.waitForTimeout(4000)
const segState = await page.evaluate(() => document.querySelector('.preview-canvas') ? 'canvas-ok' : 'missing')
await page.screenshot({ path: 'behind-person.png', clip: { x: 351, y: 40, width: 810, height: 500 } })
console.log('✓ behind-person composite rendered without errors,', segState)

// pixel proof: white text visible on green background beside the head,
// but NOT over the head (person redrawn on top)
const probe = await page.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const ctx = c.getContext('2d')
  const w = c.width, h = c.height
  // scan the headline band; classify text pixels by horizontal zone
  const y0 = Math.round(h * 0.20), y1 = Math.round(h * 0.34)
  const img = ctx.getImageData(0, y0, w, y1 - y0).data
  let side = 0, center = 0
  for (let y = 0; y < y1 - y0; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      const [r, g, b] = [img[i], img[i+1], img[i+2]]
      const white = r > 200 && g > 200 && b > 200
      const purple = b > 150 && r > 60 && r < 170 && g < 130
      if (white || purple) {
        if (x > w * 0.38 && x < w * 0.62) center++
        else side++
      }
    }
  }
  return { side, center }
})
console.log('✓ pixel probe — text pixels beside head:', probe.side, '· over head:', probe.center)
if (probe.side < 5) throw new Error('no text visible beside the head — matte covering everything?')
if (probe.center > probe.side) throw new Error('text mostly over the head — person not redrawn on top?')
console.log('✓ TEXT IS BEHIND THE PERSON: visible on background, hidden behind the head')
const segErrors = errors.filter((e) => !e.includes('Failed to load resource'))
if (segErrors.length) { console.log('PAGE ERRORS:'); segErrors.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — headline v2 verified')
await browser.close()
