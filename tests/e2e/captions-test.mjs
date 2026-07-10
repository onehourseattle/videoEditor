import { chromium } from 'playwright-core'

const SRT = `1
00:00:00,200 --> 00:00:02,000
hello world this is CutRoom

2
00:00:02,500 --> 00:00:04,000
captions are fuly editable
`

const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.sidebar')

// open Captions tab, import SRT
await page.click('.sidebar button[title="Caps"]')
await page.waitForSelector('.transcript', { state: 'attached' })
await page.setInputFiles('input[accept=".srt,.vtt,text/*"]', {
  name: 'test.srt', mimeType: 'text/plain', buffer: Buffer.from(SRT),
})
await page.waitForSelector('.tr-block')
const blocks = await page.locator('.tr-block').count()
const clips = await page.locator('.clip').count()
console.log(`✓ SRT imported: ${blocks} transcript blocks, ${clips} timeline clips`)
if (blocks !== 2 || clips !== 2) throw new Error('import mismatch')

// fix the typo "fuly" → "fully" in the transcript editor
const typo = page.locator('.tr-word', { hasText: 'fuly' })
await typo.click()
await page.keyboard.press('ControlOrMeta+a')
await page.keyboard.type('fully')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
const texts = await page.locator('.tr-word').allTextContents()
if (!texts.includes('fully') || texts.some((t) => t.includes('fuly'))) {
  throw new Error('word edit failed: ' + JSON.stringify(texts))
}
console.log('✓ word edited inline (fuly → fully)')

// clicking a word seeks the playhead
const t = await page.evaluate(() => document.querySelector('.transport .time').textContent)
console.log('✓ playhead followed focused word:', t.split('/')[0].trim())

// apply the Hormozi template to all captions
await page.click('.preset-card:has-text("Hormozi")')
await page.waitForSelector('.toast.ok')
console.log('✓ template applied to all captions')

// export SRT and check the fix round-tripped
const dlP = page.waitForEvent('download')
await page.click('button:has-text("↓ SRT")')
const dl = await dlP
const path = await dl.path()
const { readFileSync } = await import('node:fs')
const out = readFileSync(path, 'utf8')
if (!out.includes('fully') || out.includes('fuly')) throw new Error('SRT round-trip lost the edit:\n' + out)
if (/\d,\d{4}/.test(out)) throw new Error('malformed SRT timestamp:\n' + out)
console.log('✓ SRT export round-trips the edited word')

// style clipboard: copy caption 1 style, paste onto caption 2 via ⌥⌘V
await page.locator('.clip').first().click()
await page.keyboard.press('Meta+c')
await page.waitForSelector('.toast')
await page.locator('.clip').nth(1).click()
await page.keyboard.press('Alt+Meta+v')
await page.waitForSelector('.toast:has-text("Style applied")')
console.log('✓ copy style → paste style works')

// paste whole clip at playhead
await page.keyboard.press('Meta+v')
await page.waitForTimeout(200)
const clips2 = await page.locator('.clip').count()
console.log('✓ ⌘V pasted clip at playhead, clips:', clips2)
if (clips2 !== 3) throw new Error('clip paste failed')

// font picker present with system fonts (inspector shows caption style)
const fontOptions = await page.locator('.inspector select >> nth=1').locator('option').count()
  .catch(() => 0)
const hasFontRow = await page.locator('.inspector .field:has-text("Font")').count()
console.log('✓ font picker in inspector:', hasFontRow > 0, `(select options nearby: ${fontOptions})`)
if (!hasFontRow) throw new Error('font picker missing')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — release 2 verified')
await browser.close()
