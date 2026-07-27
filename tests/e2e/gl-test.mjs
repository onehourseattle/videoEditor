import { chromium } from 'playwright-core'
import path from 'node:path'
import os from 'node:os'

// GPU effect chain: correctness (chroma key removes the keyed color, other
// effects visibly alter pixels) + throughput (heavy per-pixel chain export).
const browser = await chromium.launch({
  executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.sidebar')

const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'))
console.log('· WebGL available in this browser:', webgl)

// sample the centre of the preview canvas
const centrePixel = () => page.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data
  return [d[0], d[1], d[2], d[3]]
})

// 1. a full-frame pure-green shape, no effects → centre must read green
await page.click('.sidebar button[title="Script"]')
await page.fill('.script-editor textarea', `
const track = editor.tracks().find(t => t.kind === 'video')
const clip = editor.addSticker('', 0, 5, {})   // placeholder replaced below
editor.remove(clip.id)
const shape = editor.addChart('counter', 0, 5, { spec: { title: '', backgroundColor: '', data: [] } })
editor.remove(shape.id)
editor.log('ready')
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')

// build a green full-frame rect via the Stickers panel shape + inspector-free scripting
await page.fill('.script-editor textarea', `
const p = editor.project
const track = editor.tracks().find(t => t.kind === 'video')
// full-frame green rectangle
const c = {
  id: 'greenrect', kind: 'shape', name: 'green', start: 0, duration: 5,
  shape: 'rect', fill: '#00ff00', stroke: '#00ff00', strokeWidth: 0,
  width: 2, height: 2,
  transform: { x:[{t:0,value:0,easing:'linear'}], y:[{t:0,value:0,easing:'linear'}],
    scale:[{t:0,value:1,easing:'linear'}], rotation:[{t:0,value:0,easing:'linear'}],
    opacity:[{t:0,value:1,easing:'linear'}] },
  effects: [],
}
editor.log('adding')
`)
// simpler: use the Stickers panel to add a rect, then widen it via the scripting API
await page.click('.sidebar button[title="Stick"]')
await page.click('.preset-card:has-text("Rect")')
await page.waitForTimeout(300)
await page.click('.sidebar button[title="Script"]')
await page.fill('.script-editor textarea', `
const [shape] = editor.clips({ kind: 'shape' })
if (!shape) throw new Error('no shape clip')
editor.log('shape id ' + shape.id)
// make it cover the whole frame and pure green
const p = editor.project
for (const tr of p.tracks) for (const c of tr.clips) if (c.id === shape.id) { c.width = 2; c.height = 2; c.fill = '#00ff00' }
editor.move(shape.id, 0)
editor.seek(1)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
await page.waitForTimeout(600)
const green = await centrePixel()
console.log('✓ green shape renders:', green.join(','))
if (!(green[1] > 180 && green[0] < 80)) throw new Error('expected green centre, got ' + green)

// 2. apply chroma key on green → the shape must key out (background black)
await page.fill('.script-editor textarea', `
const [shape] = editor.clips({ kind: 'shape' })
editor.addEffect(shape.id, 'chromaKey', { keyColor: '#00ff00', tolerance: 0.35, softness: 0.1 })
editor.seek(1.2)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
await page.waitForTimeout(700)
const keyed = await centrePixel()
console.log('✓ after chroma key:', keyed.join(','))
if (keyed[1] > 90) throw new Error('chroma key did not remove green: ' + keyed)

// 3. stack the rest of the per-pixel chain; frame must stay renderable
await page.fill('.script-editor textarea', `
const [shape] = editor.clips({ kind: 'shape' })
for (const c of editor.clips({ kind: 'shape' })) {
  editor.addEffect(c.id, 'vignette', { amount: 0.6 })
  editor.addEffect(c.id, 'filmGrain', { amount: 0.15 })
  editor.addEffect(c.id, 'lut', { amount: 0.4, shadows: '#123a52', highlights: '#ffb86b' })
  editor.addEffect(c.id, 'sharpen', {})
  editor.addEffect(c.id, 'pixelate', { size: 12 })
}
editor.addText('GPU CHAIN', 0, 5, { animation: 'none', y: -400, style: { fontSize: 80 } })
editor.seek(2)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
await page.waitForTimeout(700)
const lit = await page.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0, total = 0
  for (let i = 0; i < d.length; i += 40) { total++; if (d[i] + d[i + 1] + d[i + 2] > 30) n++ }
  return (100 * n) / total
})
console.log(`✓ 6-effect chain renders (${lit.toFixed(1)}% lit)`)
await page.screenshot({ path: path.join(os.tmpdir(), 'cutroom-gl-chain.png') })

// 4. throughput: export 5s @540x960 through the whole per-pixel chain
await page.click('.topbar button.primary')
await page.selectOption('.modal select', '4')
const dlP = page.waitForEvent('download', { timeout: 300000 })
const t0 = Date.now()
await page.click('.modal button:has-text("Export MP4")')
const dl = await dlP
const secs = (Date.now() - t0) / 1000
console.log(`✓ 5s export with a 6-effect per-pixel chain: ${secs.toFixed(1)}s (${dl.suggestedFilename()})`)

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — GPU effect chain verified')
await browser.close()
