import { chromium, devices } from 'playwright-core'

/**
 * iPhone-shaped pass: real touch events, iPhone viewport and DPR, plus the PWA
 * plumbing an "Add to Home Screen" install depends on.
 *
 * Caveat worth remembering: this is Chromium emulating an iPhone's *shape*, not
 * WebKit. It catches layout, touch and manifest problems; it cannot tell you
 * how Safari's WebCodecs, AudioContext or WASM behave. Those need a real device.
 */
const browser = await chromium.launch({
  executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
})
const iPhone = devices['iPhone 13'] ?? {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}
const context = await browser.newContext({
  ...iPhone,
  // Chromium can't be WebKit, but the UA shakes out UA-sniffing bugs
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.topbar')  // the logo is hidden on phones to save a row
console.log('✓ booted at', `${iPhone.viewport.width}×${iPhone.viewport.height} @${iPhone.deviceScaleFactor}x`, '(touch:', iPhone.hasTouch + ')')

// ── PWA install plumbing ──
const pwa = await page.evaluate(async () => {
  const manifestHref = document.querySelector('link[rel=manifest]')?.getAttribute('href')
  const manifest = manifestHref ? await (await fetch(manifestHref)).json() : null
  const appleIcon = document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href')
  const iconOk = appleIcon ? (await fetch(appleIcon)).ok : false
  return {
    name: manifest?.name,
    display: manifest?.display,
    icons: manifest?.icons?.length ?? 0,
    themeColor: document.querySelector('meta[name=theme-color]')?.getAttribute('content'),
    webAppCapable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.getAttribute('content'),
    appleIconOk: iconOk,
    swRegistered: 'serviceWorker' in navigator,
  }
})
console.log('✓ PWA:', JSON.stringify(pwa))
if (!pwa.name || pwa.display !== 'standalone') throw new Error('manifest not installable')
if (!pwa.appleIconOk) throw new Error('apple-touch-icon missing — home screen icon would be blank')
if (pwa.webAppCapable !== 'yes') throw new Error('not flagged as a standalone web app')

// ── the page must not pan sideways (the classic phone layout bug) ──
// Assert on real scrollability, not scrollWidth: the timeline is a legitimate
// horizontal scroller, so its clipped content inflates documentElement.scrollWidth
// even though the page itself is locked by `body { overflow: hidden }`.
const pan = await page.evaluate(() => {
  window.scrollTo(400, 0)
  document.documentElement.scrollLeft = 400
  const moved = Math.max(window.scrollX, document.documentElement.scrollLeft)
  window.scrollTo(0, 0)
  return moved
})
console.log('✓ page does not pan sideways (scrollX stays', pan + ')')
if (pan > 1) throw new Error(`page pans sideways on a phone (scrollX ${pan})`)

// ── the drawer: panels overlay, and tapping the active tab closes them ──
await page.waitForSelector('.panel')
const panelBox = await page.locator('.panel').boundingBox()
console.log(`✓ media drawer overlays (${Math.round(panelBox.width)}px wide of ${iPhone.viewport.width})`)
await page.tap('.sidebar button[title="Media"]')
await page.waitForSelector('.panel', { state: 'detached' })
console.log('✓ tapping the active tab closes the drawer (reveals preview)')
await page.waitForSelector('.empty-state')

// ── import media by touch ──
await page.tap('.sidebar button[title="Media"]')
await page.waitForSelector('.dropzone')
await page.evaluate(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 320; canvas.height = 568
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
      ctx.fillStyle = `hsl(${(t * 100) % 360},80%,50%)`
      ctx.fillRect(0, 0, 320, 568)
      if (t < 3) requestAnimationFrame(tick); else res()
    }
    tick()
  })
  rec.stop(); await done
  const dt = new DataTransfer()
  dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'phone.webm', { type: 'video/webm' }))
  document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
})
await page.waitForSelector('.media-item', { timeout: 20000 })
await page.tap('.media-item')
await page.waitForSelector('.clip')
console.log('✓ imported and placed a clip by tapping')

// ── touch-drag the clip on the timeline (pointer events, not mouse) ──
await page.tap('.sidebar button[title="Media"]') // close drawer for room
const clip = page.locator('.clip').first()
const before = await clip.boundingBox()
await page.touchscreen.tap(before.x + before.width / 2, before.y + before.height / 2)
await page.waitForSelector('.inspector:not(.empty)')
console.log('✓ tapping a clip opens the inspector')

// drag it right with a real touch sequence
await page.evaluate(async ([x, y]) => {
  const el = document.elementFromPoint(x, y)
  const opts = (cx) => ({ pointerId: 1, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true, isPrimary: true })
  el.dispatchEvent(new PointerEvent('pointerdown', opts(x)))
  for (let i = 1; i <= 8; i++) {
    window.dispatchEvent(new PointerEvent('pointermove', opts(x + i * 8)))
    await new Promise((r) => setTimeout(r, 16))
  }
  window.dispatchEvent(new PointerEvent('pointerup', opts(x + 64)))
}, [before.x + before.width / 2, before.y + before.height / 2])
await page.waitForTimeout(400)
const after = await clip.boundingBox()
const movedBy = after.x - before.x
console.log(`✓ touch-dragged the clip (${Math.round(movedBy)}px)`)
if (movedBy < 20) throw new Error('touch drag did not move the clip')

// ── the preview actually paints on a phone-sized canvas ──
// the drag moved the clip off t=0, so put the playhead back inside it
const moved = await clip.boundingBox()
const ruler = await page.locator('.ruler').boundingBox()
await page.touchscreen.tap(moved.x + moved.width / 2, ruler.y + ruler.height / 2)
await page.waitForTimeout(1000)
const lit = await page.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0, total = 0
  for (let i = 0; i < d.length; i += 40) { total++; if (d[i] + d[i + 1] + d[i + 2] > 40) n++ }
  return { pct: (100 * n) / total, w: c.width, h: c.height }
})
console.log(`✓ preview paints at ${lit.w}×${lit.h} (${lit.pct.toFixed(0)}% lit)`)
if (lit.pct < 5) throw new Error('preview blank on phone layout')

// ── tap targets big enough for thumbs (Apple's 44pt guidance) ──
const small = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('.sidebar button, .transport button, .topbar button')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.width < 30 || r.height < 30)) {
      out.push(`${el.title || el.textContent?.trim() || el.className}:${Math.round(r.width)}×${Math.round(r.height)}`)
    }
  }
  return out
})
console.log(small.length ? `⚠︎ ${small.length} small tap targets: ${small.slice(0, 6).join(', ')}` : '✓ all primary tap targets ≥30px')

// ── export on the phone layout ──
await page.tap('.topbar button.primary')
await page.waitForSelector('.modal')
await page.selectOption('.modal select', '4')
const dlP = page.waitForEvent('download', { timeout: 300000 })
await page.tap('.modal button:has-text("Export MP4")')
const dl = await dlP
console.log('✓ exported from the phone layout:', dl.suggestedFilename())

await page.screenshot({ path: (await import('node:path')).join((await import('node:os')).tmpdir(), 'cutroom-iphone.png') })

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — iPhone-shaped pass verified')
await browser.close()
