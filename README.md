# CutRoom — local AI video editor for social media

A CapCut-class video editing platform that runs **entirely on your own machine**.
No cloud rendering, no accounts, no telemetry, **no API calls** — every frame,
every AI feature, and every export is computed locally.

## Quick start (Mac)

```bash
npm install
npm run fetch-models   # one-time: bundles the Whisper model (~75 MB) for offline AI captions
npm run dev            # → http://localhost:5180 (use Chrome for fastest export)
```

That's it. Import footage in the **Media** panel, edit, hit **Export**.

> After `npm install` + `npm run fetch-models`, you can unplug the network —
> everything keeps working, including transcription and MP4 export.

## What it does

### Editing engine
- Multi-track timeline: video, audio, and unlimited overlay tracks
- Trim, split (S), ripple delete, duplicate (⌘D), drag with magnetic snapping
- Speed control (0.1×–4×), volume, mute, audio fades
- Keyframe animation on position / scale / rotation / opacity with easing
  (linear, ease, spring, bounce)
- 11 transitions: crossfade, fade-to-black, slides, wipe, zooms, blur-through, glitch, spin
- 15 effects: brightness/contrast/saturation/hue, blur, B&W, sepia,
  cinematic teal-orange LUT, vignette, **green-screen chroma key**, glitch, VHS,
  film grain, pixelate, sharpen
- Full undo/redo history (⌘Z / ⇧⌘Z), autosave, project save/load as JSON

### AI suite — 100% on-device
| Tool | How it works locally |
|---|---|
| 💬 Auto captions | Whisper (ONNX, WASM/WebGPU) with word-level timestamps → karaoke captions |
| 🚫 Filler-word removal | transcript-driven cuts of "um", "uh", stutters |
| ✂️ Silence removal | adaptive RMS loudness analysis → ripple jump-cuts |
| 🥁 Beat-synced cuts | spectral-flux onset detection + BPM estimation (FFT written in-repo) |
| 🎬 Scene detection | per-frame color-histogram chi-square distance |
| 📱 Auto-reframe | motion center-of-mass tracking → smoothed crop keyframes for 9:16 |
| ⚡️ Auto highlights | audio energy + dynamics scoring picks the best moments |

### Graphics & charts
Animated, data-driven overlays rendered straight into your video: like/follower
**counters**, growth **line/area** charts, **bar races**, donuts, goal progress
bars and sparklines — plus 10 CapCut-style animated text presets (karaoke word
pop, highlight box, neon, typewriter, bounce…), emoji stickers with animations,
and shapes/arrows.

### Scripting
A built-in JavaScript automation console (**Script** panel). The `editor` API
reaches everything — clips, keyframes, effects, and all AI tools:

```js
const [clip] = editor.clips({ kind: 'video' })
await editor.removeSilences(clip.id)
await editor.autoCaption(clip.id)
editor.addChart('counter', editor.duration() - 4, 4, {
  spec: { title: 'Likes', suffix: ' ❤️', data: [{label:'a',value:0},{label:'b',value:250000}] },
})
```

Full reference: [docs/SCRIPTING.md](docs/SCRIPTING.md)

### Export
H.264 + AAC MP4 encoded in-browser with WebCodecs (hardware-accelerated on
Apple Silicon). Presets for TikTok/Reels/Shorts (1080×1920 @30/@60), square,
YouTube 16:9, and fast drafts.

## iOS

Three ways, all local — see [docs/IOS.md](docs/IOS.md):

1. **PWA**: serve the built app on your Mac (`npm run build && npm run preview`),
   open it in Safari on the iPhone/iPad, **Add to Home Screen**. Works offline
   after first load (service worker).
2. **Same-network dev**: `npm run dev:lan` and open your Mac's LAN address on the phone.
3. **Native app**: `npm run ios:init && npm run ios:open` → build in Xcode
   (Capacitor wraps the same code in a WKWebView shell; no services involved).

## Privacy / locality guarantees

- **No API calls.** The app never contacts any server at runtime. The Whisper
  runtime (ONNX WASM) is bundled into the build; model weights load only from
  the app's own `/models` directory. If they're missing, transcription refuses
  to run rather than fetch from a hub.
- The only network use in the whole lifecycle is `npm install` /
  `npm run fetch-models` — one-time downloads at setup, same as installing any app.
- Media files are read via object URLs in memory and never uploaded anywhere.

## Architecture

```
src/
  types/model.ts        project data model — plain JSON, undoable, scriptable
  state/                zustand store, undo history, asset store, persistence
  engine/               compositor (canvas), keyframes, effects, transitions,
                        text/caption renderer, chart renderer, audio graph, playback
  export/exporter.ts    WebCodecs H.264/AAC MP4 encode + mp4 muxing
  ai/                   silence, beats (FFT), scenes, reframe, highlights,
                        transcribe (Whisper), auto-captions
  scripting/            the `editor` automation API + runner + examples
  components/           React UI: timeline, preview, inspector, panels
```

Preview and export share one code path: `renderFrame(project, t)` is a pure
function of time, so what you see is exactly what encodes.

## Requirements

- **Best**: Chrome/Edge on macOS (full WebCodecs incl. AAC audio export)
- Safari 16.4+: works; on versions without `AudioEncoder` the export falls back
  to video-only automatically
- Node 18+ for the dev server

## Development

```bash
npm run typecheck   # strict TS
npm run build       # production bundle → dist/
npm run gen-icons   # regenerate PWA/iOS icons (zero-dependency PNG writer)
```
