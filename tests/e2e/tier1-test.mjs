import { chromium } from 'playwright-core'

const SRT = `1
00:00:00,000 --> 00:00:02,000
keep these words but remove that filler phrase

2
00:00:02,500 --> 00:00:04,000
ending stays right here
`

const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('dialog', (d) => d.accept('My saved template'))

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.sidebar')

// ── text-based editing ──
await page.click('.sidebar button[title="Caps"]')
await page.waitForSelector('select:has(option[value="multilingual"])')
console.log('✓ speech model picker present (English / Multilingual)')
await page.setInputFiles('input[accept=".srt,.vtt,text/*"]', {
  name: 't.srt', mimeType: 'text/plain', buffer: Buffer.from(SRT),
})
await page.waitForSelector('.tr-block')
const before = await page.evaluate(() => document.querySelector('.transport .time').textContent.split('/')[1].trim())
console.log('✓ SRT imported, duration before cut:', before)

// select "remove that filler phrase" (words 4-7 of cue 1) via native selection
await page.evaluate(() => {
  const words = [...document.querySelectorAll('.tr-word')]
  const from = words.find((w) => w.textContent === 'remove')
  const to = words.find((w) => w.textContent === 'phrase')
  const sel = window.getSelection()
  const range = document.createRange()
  range.setStartBefore(from)
  range.setEndAfter(to)
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
})
await page.waitForSelector('.cut-words')
const btnText = await page.textContent('.cut-words')
console.log('✓ cut button appeared:', btnText.trim())
await page.click('.cut-words')
await page.waitForSelector('.toast:has-text("rippled together")')
const texts = await page.locator('.tr-word').allTextContents()
if (texts.includes('filler') || texts.includes('phrase')) throw new Error('cut words still present: ' + texts.join(' '))
if (!texts.includes('keep') || !texts.includes('ending')) throw new Error('kept words lost: ' + texts.join(' '))
const after = await page.evaluate(() => document.querySelector('.transport .time').textContent.split('/')[1].trim())
console.log(`✓ words cut from transcript, duration ${before} → ${after} (rippled)`)
if (after >= before) throw new Error('duration did not shrink')

// ── templates ──
await page.click('.topbar button:has-text("Projects")')
await page.waitForSelector('.preset-card:has-text("Hook")')
console.log('✓ built-in templates listed')
// save current as template (prompt auto-accepted)
await page.click('button:has-text("Save current as template")')
await page.waitForSelector('.toast:has-text("Template")')
await page.waitForSelector('.preset-card:has-text("My saved template")')
console.log('✓ saved current project as a reusable template')
// instantiate a built-in
await page.click('.preset-card:has-text("Product promo")')
await page.waitForSelector('.toast:has-text("ready")')
await page.waitForTimeout(400)
const clipCount = await page.locator('.clip').count()
console.log('✓ built-in template instantiated, overlay clips:', clipCount)
if (clipCount < 3) throw new Error('template clips missing')

// template project is distinct: projects list should show ≥2 projects, templates hidden from it
await page.click('.topbar button:has-text("Projects")')
await page.waitForSelector('.project-card')
const cards = await page.locator('.project-card').allTextContents()
if (cards.some((c) => c.includes('My saved template'))) throw new Error('template leaked into projects list')
console.log('✓ templates stay out of the projects list (' + cards.length + ' projects)')

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — Tier 1 verified')
await browser.close()
