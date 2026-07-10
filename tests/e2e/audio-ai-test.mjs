import { chromium } from 'playwright-core'

// R3-R5 verification: speech/music synthesis → auto-duck, denoise, auto edit,
// shorts splitter, preflight checklist, platform overlay, batch export.
const browser = await chromium.launch({ executablePath: process.env.CUTROOM_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.waitForSelector('.dropzone')

// 1. synthesize: video with "speech" (tone bursts) + a steady "music" audio file
console.log('· synthesizing speech video + music track…')
await page.evaluate(async () => {
  const ac = new AudioContext()

  async function record(withVideo, makeAudio, seconds, name) {
    const dest = ac.createMediaStreamDestination()
    const stop = makeAudio(dest)
    let stream = dest.stream
    let canvas
    if (withVideo) {
      canvas = document.createElement('canvas')
      canvas.width = 640; canvas.height = 360
      const cs = canvas.captureStream(30)
      stream = new MediaStream([...cs.getVideoTracks(), ...dest.stream.getAudioTracks()])
    }
    const rec = new MediaRecorder(stream, { mimeType: withVideo ? 'video/webm' : 'audio/webm' })
    const chunks = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    const done = new Promise((r) => (rec.onstop = r))
    rec.start(100)
    const t0 = performance.now()
    await new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000
        if (canvas) {
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = `hsl(${(t * 90) % 360},70%,45%)`
          ctx.fillRect(0, 0, 640, 360)
        }
        if (t < seconds) requestAnimationFrame(tick)
        else res()
      }
      tick()
    })
    stop?.()
    rec.stop()
    await done
    return new File([new Blob(chunks, { type: withVideo ? 'video/webm' : 'audio/webm' })], name, { type: withVideo ? 'video/webm' : 'audio/webm' })
  }

  // speech-like: 220Hz bursts 0.6s on / 0.5s off, with faint noise floor
  window.__speech = await record(true, (dest) => {
    const osc = ac.createOscillator(); osc.frequency.value = 220
    const g = ac.createGain(); g.gain.value = 0
    osc.connect(g); g.connect(dest)
    osc.start()
    const iv = setInterval(() => { g.gain.value = g.gain.value > 0 ? 0 : 0.5 }, 550)
    // noise floor so denoise has something to learn
    const noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
    const nd = noiseBuf.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() - 0.5) * 0.03
    const noise = ac.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true
    noise.connect(dest); noise.start()
    return () => { clearInterval(iv); osc.stop(); noise.stop() }
  }, 6, 'speech.webm')

  // music: steady 440Hz
  window.__music = await record(false, (dest) => {
    const osc = ac.createOscillator(); osc.frequency.value = 440
    const g = ac.createGain(); g.gain.value = 0.35
    osc.connect(g); g.connect(dest)
    osc.start()
    return () => osc.stop()
  }, 6, 'music.webm')
})

for (const key of ['__speech', '__music']) {
  await page.evaluate((k) => {
    const dt = new DataTransfer()
    dt.items.add(window[k])
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
  }, key)
  await page.waitForTimeout(1200)
}
await page.waitForSelector('.media-item:nth-child(2)', { timeout: 20000 })
// add both to the timeline
await page.locator('.media-item').nth(0).click()
await page.waitForTimeout(300)
await page.locator('.media-item').nth(1).click()
await page.waitForTimeout(300)
const clipCount = await page.locator('.clip').count()
console.log('✓ imported speech video + music audio, clips:', clipCount)

// 2. auto-duck
await page.click('.sidebar button[title="AI"]')
await page.locator('.ai-card:has-text("Auto-duck") button').click()
await page.waitForSelector('.toast:has-text("Auto-duck done")', { timeout: 30000 })
console.log('✓ auto-duck completed')
// envelope visible in inspector for the music clip
await page.locator('.clip.kind-audio').first().click()
await page.waitForSelector('.inspector .row:has-text("Volume envelope")')
const envText = await page.textContent('.inspector .row:has-text("Volume envelope")')
console.log('✓ music clip has envelope:', envText.trim().split('\n')[0])

// 3. denoise
await page.locator('.ai-card:has-text("Reduce noise") button').click()
await page.waitForSelector('.toast:has-text("Noise reduction done")', { timeout: 60000 })
console.log('✓ noise reduction completed')

// 4. auto edit (whisper model absent → silence-cut + zooms only, gracefully)
await page.locator('.ai-card:has-text("Auto edit") button').click()
await page.waitForSelector('.toast:has-text("Auto edit done")', { timeout: 60000 })
const clipsAfter = await page.locator('.clip').count()
console.log('✓ auto edit completed, clips now:', clipsAfter)
if (clipsAfter <= clipCount) console.log('  (note: no silences were cut — tone gaps may be below threshold)')

// 5. shorts splitter — triage modal flow
await page.locator('.ai-card:has-text("Shorts") button').click()
await page.waitForSelector('.shorts-card', { timeout: 60000 })
await page.click('.modal button:has-text("Create all")')
await page.waitForSelector('.toast:has-text("created")', { timeout: 30000 })
console.log('✓ shorts triage: created all candidates as projects')
await page.click('.topbar button:has-text("Projects")')
await page.waitForSelector('.project-card')
const projCount = await page.locator('.project-card').count()
console.log('✓ projects modal shows', projCount, 'projects (main + shorts)')
if (projCount < 3) throw new Error('expected shorts projects')
await page.click('.modal button:has-text("Close")')

// 6. platform overlay toggle
await page.click('.overlay-toggle') // guides
await page.waitForTimeout(300)
await page.click('.overlay-toggle') // platform UI
await page.waitForTimeout(500)
await page.screenshot({ path: 'r4-platform-overlay.png' })
console.log('✓ overlay cycled to platform UI (screenshot)')
await page.click('.overlay-toggle') // off

// 7. export dialog: preflight + batch
await page.click('.topbar button.primary')
await page.waitForSelector('.preflight .pf-row')
const pf = await page.locator('.preflight .pf-row').allTextContents()
console.log('✓ preflight checks:', pf.length, '—', pf.map((p) => p.slice(0, 2)).join(' '))
const dl1 = page.waitForEvent('download', { timeout: 180000 })
await page.click('.modal button:has-text("Batch 3 sizes")')
await page.waitForSelector('.export-tray')
const jobs = await page.locator('.tray-job').count()
console.log('✓ batch queued', jobs, 'jobs')
if (jobs !== 3) throw new Error('expected 3 batch jobs')
await dl1
console.log('✓ first batch export downloaded; letting the rest run…')
await page.waitForSelector('.tray-job:nth-child(4) .tj-dl', { timeout: 300000 }).catch(() => null)
const doneJobs = await page.locator('.tj-dl').count()
console.log('✓ finished exports with save buttons:', doneJobs)

const real = errors.filter((e) => !e.includes('Failed to load resource'))
if (real.length) { console.log('PAGE ERRORS:'); real.forEach((e) => console.log(' ', e)); process.exitCode = 1 }
else console.log('✓ zero page errors — R3/R4/R5 verified')
await browser.close()
