import { chromium } from 'playwright-core'

const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.topbar .logo', { timeout: 10000 })
console.log('✓ app booted:', await page.textContent('.topbar .logo'))

// panels render
for (const name of ['Text', 'Charts', 'AI', 'Script']) {
  await page.click(`.sidebar button[title="${name}"]`)
  await page.waitForTimeout(150)
  console.log(`✓ panel ${name}:`, (await page.textContent('.panel h3')).trim())
}

// run a script through the real scripting engine: add chart + text + sticker
await page.fill('.script-editor textarea', `
editor.addChart('counter', 0, 4, { spec: { title: 'Likes', suffix: ' \\u2764\\ufe0f', data: [{label:'a',value:0},{label:'b',value:128000}] } })
editor.addChart('line', 0, 4, {})
editor.addText('SMOKE TEST OK', 0, 4, { animation: 'wordPop', y: -520, style: { fontSize: 80 } })
editor.addSticker('\\u{1F525}', 0, 4, { animation: 'pulse', x: 350, y: 400 })
editor.log('clips now: ' + editor.clips().length)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok', { timeout: 10000 })
console.log('✓ script ran:', (await page.textContent('.script-log')).replace(/\n/g, ' | '))

// timeline shows the clips; seek into the middle so animations are mid-flight
const clipCount = await page.locator('.clip').count()
console.log('✓ timeline clips rendered:', clipCount)
await page.evaluate(() => { /* seek via ruler click */ })
await page.mouse.click(400, 900 - 320 + 40 + 13) // ruler area
await page.waitForTimeout(400)

// select a clip → inspector shows properties (clips overlap at t=0, click the topmost)
await page.locator('.clip.kind-sticker').first().click({ force: true })
await page.waitForTimeout(200)
console.log('✓ inspector:', (await page.textContent('.inspector h3')).trim())

// undo removes a clip
await page.keyboard.press('Meta+z')
await page.waitForTimeout(200)
console.log('✓ undo, clips now:', await page.locator('.clip').count())

// preview canvas has non-black pixels (chart/text actually composited)
const painted = await page.evaluate(() => {
  const c = document.querySelector('.preview-canvas')
  const ctx = c.getContext('2d')
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let lit = 0, total = 0
  for (let i = 0; i < d.length; i += 40) { total++; if (d[i] + d[i + 1] + d[i + 2] > 30) lit++ }
  return { pct: (100 * lit) / total, w: c.width, h: c.height }
})
console.log(`✓ preview canvas ${painted.w}x${painted.h}, lit ${painted.pct.toFixed(2)}%`)
if (painted.pct < 1) throw new Error('preview appears blank')

await page.screenshot({ path: 'smoke-editor.png' })

// mobile viewport: drawer behavior
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(300)
await page.screenshot({ path: 'smoke-mobile.png' })
console.log('✓ mobile viewport rendered')

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log('  ' + e)
  process.exitCode = 1
} else {
  console.log('✓ zero page errors')
}
await browser.close()
