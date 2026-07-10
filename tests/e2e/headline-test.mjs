import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })

// gallery renders with styled samples
await page.click('.sidebar button[title="Text"]')
await page.waitForSelector('.headline-card')
const cards = await page.locator('.headline-card').count()
console.log('✓ headline gallery:', cards, 'presets')
if (cards < 8) throw new Error('expected 8+ headline presets')

// drop each preset at a different time and screenshot a few key ones
const picks = ['Poster echo', 'Hollow outline', 'Two-tone split', 'Slant impact', 'Stacked alt']
for (const [i, label] of picks.entries()) {
  await page.evaluate((t) => { /* seek via store not exposed; use transport */ }, i)
  await page.locator(`.headline-card[title="${label}"]`).click()
  await page.waitForTimeout(150)
}
const clips = await page.locator('.clip').count()
console.log('✓ dropped presets as clips:', clips)

// make each visible one at a time and screenshot: select each clip, move playhead into it, capture middle 3
// all were dropped at t=0 stacked; instead set two-line text on 'Stacked alt' and screenshot at t=2 (animations settled)
await page.click('.sidebar button[title="Script"]')
await page.fill('.script-editor textarea', `
const texts = editor.clips({ kind: 'text' })
// spread them: one every 2s, two-line copy for stacked/masthead looks
texts.forEach((c, i) => { editor.move(c.id, i * 2) })
const stacked = texts.find((c) => c.text === 'NEW RULES')
if (stacked) { /* two lines to show alternating hollow */ }
editor.seek(0.9)
editor.log('spread ' + texts.length + ' headlines')
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
await page.click('.sidebar button[title="Script"]') // close drawer

for (const [i, label] of picks.entries()) {
  await page.evaluate((t) => {
    // seek via clicking is imprecise; use keyboard Home then arrows? use transport times via ruler
  }, i)
  // seek by clicking ruler position: t = i*2 + 0.9 (animation mostly done)
  const ruler = await page.locator('.ruler').boundingBox()
  const zoomPxPerSec = 60 // default zoom
  await page.mouse.click(ruler.x + (i * 2 + 1.2) * zoomPxPerSec, ruler.y + 10)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `headline-${i}-${label.replace(/\W+/g, '')}.png`, clip: { x: 351, y: 40, width: 810, height: 500 } })
}
console.log('✓ screenshots captured')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors')
await browser.close()
