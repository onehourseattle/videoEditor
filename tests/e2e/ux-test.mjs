import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.addInitScript(() => { try { if (!localStorage.getItem('cutroom.theme')) localStorage.setItem('cutroom.theme', 'dark') } catch {} })
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })

// empty state onboarding
await page.waitForSelector('.empty-state')
console.log('✓ empty state shows onboarding')
await page.screenshot({ path: 'ux-empty-dark.png' })

// theme toggle → light
await page.click('.topbar button[title*="light mode"]')
await page.waitForTimeout(200)
const theme = await page.evaluate(() => document.documentElement.dataset.theme)
console.log('✓ theme toggled to:', theme)
await page.screenshot({ path: 'ux-empty-light.png' })

// theme persists across reload
await page.reload({ waitUntil: 'networkidle' })
const theme2 = await page.evaluate(() => document.documentElement.dataset.theme)
console.log('✓ theme persisted after reload:', theme2)
if (theme2 !== 'light') throw new Error('theme did not persist')
await page.click('.topbar button[title*="dark mode"]') // back to dark

// help overlay via ?
await page.keyboard.press('?')
await page.waitForSelector('.shortcut-grid')
console.log('✓ help overlay opens with ?')
await page.keyboard.press('Escape')
await page.waitForSelector('.shortcut-grid', { state: 'detached' })
console.log('✓ Escape closes help')

// add content via script, then exercise context menu + preview drag
await page.click('.sidebar button[title="Script"]')
await page.fill('.script-editor textarea', `
editor.addText('DRAG ME', 0, 5, { animation: 'none', y: 0, style: { fontSize: 90 } })
editor.seek(1)
`)
await page.click('.script-editor button.primary')
await page.waitForSelector('.script-log .ok')
await page.click('.sidebar button[title="Script"]') // close drawer to free space

// right-click clip → context menu → duplicate
await page.locator('.clip').first().click({ button: 'right' })
await page.waitForSelector('.context-menu')
console.log('✓ context menu opens')
await page.click('.menu-item:has-text("Duplicate")')
await page.waitForTimeout(200)
const clipCount = await page.locator('.clip').count()
console.log('✓ duplicate via menu, clips:', clipCount)
if (clipCount !== 2) throw new Error('duplicate failed')

// select the text overlay and drag it on the preview canvas
await page.locator('.clip').first().click()
await page.waitForTimeout(300)
const before = await page.evaluate(() => {
  const s = window.localStorage // noop; we read transform via autosave later
  return true
})
const canvas = page.locator('.preview-canvas')
const box = await canvas.boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
await page.mouse.move(cx, cy)
await page.mouse.down()
await page.mouse.move(cx + 60, cy - 80, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
// read the moved transform out of the inspector x field
const xVal = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.inspector .field')]
  const xField = labels.find((l) => l.textContent.trim().startsWith('x'))
  return xField ? Number(xField.querySelector('input').value) : null
})
console.log('✓ preview drag moved overlay, transform.x =', xVal)
if (!xVal || Math.abs(xVal) < 10) throw new Error('preview drag did not move the clip')

// toast appears on save
await page.click('.topbar button:has-text("Save")')
await page.waitForSelector('.toast.ok')
console.log('✓ toast notification works')

await page.screenshot({ path: 'ux-final-dark.png' })

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — UX round verified')
await browser.close()
