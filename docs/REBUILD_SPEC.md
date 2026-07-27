# CutRoom — build spec & hard-won knowledge

Two audiences, one document:

1. **A model or engineer rebuilding this from scratch.** Read it top to bottom;
   it is written to be usable verbatim as a build prompt.
2. **Anyone extending the existing codebase.** §3 is the part you cannot
   reconstruct by reading source — it is the list of browser behaviors that
   cost real debugging time to discover.

---

## 1. The product

A CapCut-class social-media video editor that runs **entirely on the user's
machine**. No cloud rendering, no accounts, no telemetry, **no API calls at
runtime**. Every frame, every AI feature, and every export is computed locally
in the browser (and as an iOS PWA / Capacitor app).

The positioning is not "a cheaper editor." It is:

> Your footage never leaves your machine, no feature can ever be retroactively
> paywalled, and your projects are files you own.

That claim is load-bearing — it is why the product exists (see
`COMPETITIVE.md` for the market conditions that make it valuable), so any
architectural choice that would require a server is out of scope by definition.

**Stack:** React 18 + TypeScript + Vite + Zustand. Rendering is Canvas 2D (with
a WebGL path for per-pixel effects). Encoding is WebCodecs + `mp4-muxer`.
Decoding is `mediabunny`. Speech recognition is Whisper via
`@huggingface/transformers` (ONNX/WASM). Everything else — beat detection,
loudness, denoise, scene detection, reframing — is DSP written in-repo.

---

## 2. Architecture (and why)

### 2.1 The one rule that makes everything else work

```ts
renderFrame(ctx, project, t, frames, scale?, ox?, oy?)
```

Rendering is a **pure function of (project, time)**. The realtime preview and
the frame-exact exporter call the *same function*; they differ only in the
`FrameProvider` they pass (live `<video>` elements vs. sequentially decoded
frames) and the scale they render at.

Consequences, all of which you want:

- What you preview is bit-for-bit what you export. There is no second renderer
  to keep in sync, which is where every homegrown editor rots.
- Any animation is `f(t)`: keyframes, text entrances, chart draw-ins, sticker
  bounces. Nothing accumulates state between frames, so seeking is exact and
  export can render frames in any order.
- Layout is expressed in **project coordinates**, and `scale`/`ox`/`oy` map to
  device pixels. The preview renders only the pixels it displays; export at a
  different resolution letterboxes rather than re-flowing. Text never resizes
  differently between preview and output.

Keep this invariant. If you ever need per-frame state (motion blur, temporal
denoise), thread it explicitly rather than making the renderer stateful.

### 2.2 Project model: plain JSON, always

`src/types/model.ts` defines a `Project` that is pure serializable JSON —
tracks, clips, keyframe arrays, effect params. No class instances, no
functions, no binary.

This buys, for free:
- Undo/redo as a stack of snapshots (structural sharing via spread).
- Save/load as a `.json` file.
- Autosave to IndexedDB.
- A scripting API that is just typed mutations over the same structures.
- Templates: a project with the media removed.

**Binary lives elsewhere.** `assetStore` owns Blobs, decoded `AudioBuffer`s,
pooled `<video>` elements, filmstrips, waveforms — keyed by asset id. The
project references assets by id only. This split is why persistence,
archiving, and templates were each a small change rather than a refactor.

### 2.3 State

Zustand, one store (`src/state/store.ts`). Every project mutation flows through
`updateProject(fn, { transient? })`:

- Normal calls push an undo snapshot.
- `transient: true` skips history — used during drags, where you want *one*
  undo entry for the whole gesture. The gesture captures the pre-drag project
  and pushes it once on pointerup.

Helper functions (`replaceClip`, `removeClips`, `splitClipAt`,
`rippleDeleteRange`, `rippleDeleteAllTracks`) are pure `Project → Project`, so
the UI, the scripting API, and the AI tools all share one set of edit
primitives. Do not let a component mutate the project shape directly.

### 2.4 Layering

```
types/model.ts     the data model — everything else depends on this and nothing else
state/             store, undo, asset store (binary), persistence, archive, clipboard
engine/            compositor, keyframes, effects, transitions, text, charts,
                   audio graph, playback  ← pure-ish, no React
export/            WebCodecs encode + muxing + job queue
ai/                DSP + Whisper, all local
scripting/         `editor` API (a thin layer over state helpers) + runner
components/        React UI only; no rendering logic lives here
```

The rule: **`engine/` and `ai/` never import from `components/`.** The UI is
replaceable; the engine is the product.

### 2.5 Audio

One scheduling function, `scheduleAudio(ctx, dest, project, from, when)`,
targets either an `AudioContext` (preview) or an `OfflineAudioContext`
(export). Same code path, same mix, same result. Volume envelopes are sampled
onto `gain.setValueCurveAtTime`.

Playback is driven by the **Web Audio clock**, not `requestAnimationFrame` —
`currentTime` derives from `audioCtx.currentTime`. `<video>` elements are
re-seeked when drift exceeds a threshold. Video is slaved to audio because
audio glitches are far more perceptible than a dropped frame.

### 2.6 Export

Frames are composited to a canvas and encoded with `VideoEncoder`. Source video
is decoded **sequentially** with mediabunny's `CanvasSink` — export time only
moves forward, so each clip is one forward pass and each packet is decoded at
most once. A precise-seek `<video>` fallback exists for containers WebCodecs
can't demux.

Codec selection probes `VideoEncoder.isConfigSupported` down a chain
(H.264 High → Baseline → VP9 → AV1; AAC → Opus) rather than assuming H.264.

Jobs run in a queue on immutable project snapshots, so the user keeps editing
while a render is in flight.

---

## 3. Browser landmines — the expensive knowledge

Every item below was discovered by driving a real browser. None are inferable
from documentation. **If you rebuild, port this section first.**

1. **`MediaRecorder`-produced WebM reports `duration: Infinity`.**
   Any screen or camera recording hits this. It propagated into a timeline
   ruler loop and white-screened the entire app. Fix: after `loadedmetadata`,
   if `duration` is not finite, set `currentTime = 1e7` and wait for
   `durationchange`/`seeked` to force the browser to scan the file. Also clamp
   defensively anywhere a duration drives a loop bound.

2. **`onnxruntime-node` breaks `npm install`.**
   It is a transitive dependency of `@huggingface/transformers` and tries to
   download a CUDA binary (403s in sandboxes, fails without `nvcc`). Fix:
   `.npmrc` with `onnxruntime-node-install-cuda=skip`. Only the browser
   WASM/WebGPU runtime is used anyway.

3. **Naive timestamp formatting emits invalid SRT.**
   Rounding milliseconds independently of seconds produces `00:00:01,1000`.
   Round to total milliseconds *first*, then decompose. Assert with a
   round-trip test, not by reading the code.

4. **Only one clip per track was rendering.**
   Using `find()` to locate "the active clip" silently drops overlapping
   overlays. Render *all* clips active at `t`, stacked in start order.

5. **Exporting at a non-project resolution re-flowed text.**
   Rendering into a differently-sized canvas changed font layout, so exports
   didn't match the preview. Fix: lay out in project coordinates, apply a
   uniform scale transform, letterbox on aspect mismatch.

6. **Re-linked assets lost their blob registration.**
   Adopting a re-imported file under an existing asset id updated the metadata
   but not the blob map, silently breaking audio mixing, waveforms, and
   WebCodecs export for that asset. Any id remap must move the binary too.

7. **Canvas backing store ≠ CSS size.**
   Once the preview renders at display resolution with `object-fit: contain`,
   pointer→project coordinate mapping must account for letterbox offsets, or
   direct manipulation drifts. Compute `disp = min(rect.w/W, rect.h/H)` and
   subtract the centering offsets.

8. **Web Audio is main-thread-only in practice.**
   `OfflineAudioContext` is not available in Workers. A "move export to a
   Worker" refactor must render the audio mix on the main thread and transfer
   PCM to the Worker, not naively port the whole pipeline.

9. **Pixel-level `getImageData` loops are the real bottleneck**, not the
   compositing. CSS `ctx.filter` is GPU-accelerated and cheap; per-pixel JS is
   not. Split effects into those two classes and give the second a GPU path.

10. **Empty flex children read as "hidden" to automation.**
    A zero-height container fails Playwright's visibility check. Test with
    `{ state: 'attached' }` when asserting on a container that may be empty.

11. **Playwright download temp files die with their browser context.**
    `download.saveAs(path)` before closing the context, or the file vanishes.

---

## 4. Feature inventory

Editing: multi-track timeline (video/audio/unlimited overlays), trim, split,
ripple delete, cross-track drag, magnetic snapping with a visible indicator,
speed 0.1–4×, volume, mute, fades, keyframe animation (position/scale/rotation/
opacity) with linear/ease/spring/bounce easing, 11 transitions, 15 effects
including chroma key, undo/redo, autosave, multi-project manager, portable
`.cutroompkg` archives (project + all media in one file).

Captions & text: on-device Whisper (English or 90+ language), **word-level
transcript editor** (click to seek, type to fix, clear to cut), **text-based
editing** (select words → cut that range from every track), 8 caption style
templates, 10 animated text presets, SRT/VTT import + export, font import
(`.ttf/.otf/.woff2`, persisted), style clipboard with apply-to-all.

Graphics: animated counters, line/area, bar, bar race, donut, progress,
sparkline charts (CVD-validated palette), emoji stickers with animations,
shapes/arrows.

Local AI: auto-captions, filler-word removal, silence removal, beat detection
(in-repo FFT), scene detection, motion-tracked auto-reframe, energy-based
highlights, auto-duck music under speech, −14 LUFS normalization, spectral
noise reduction, one-click Auto Edit, long-video → Shorts with ranked triage
cards.

Publish: safe-zone guides, platform-UI overlay (so captions don't hide behind
the like button), pre-flight checklist, batch export to 9:16 + 1:1 + 16:9,
cover-frame PNG.

Automation: a JavaScript scripting console whose `editor` API reaches every
edit primitive and every AI tool.

---

## 5. How to verify (non-negotiable)

Unit tests are not sufficient for this product. **Drive a real browser.** The
harness pattern that caught every bug in §3:

1. **Synthesize media in-page.** Draw to a canvas, capture with
   `canvas.captureStream()` + `MediaRecorder`, optionally mix in oscillator
   audio for speech/music simulation, and drop the resulting `File` onto the
   app's dropzone via a synthetic `DragEvent`. No fixture files needed, and it
   exercises the exact codepath real recordings take (see landmine #1).
2. **Assert on observable behavior, not internals** — timeline clip counts,
   inspector values, canvas pixel statistics, downloaded file bytes.
3. **Verify exports end-to-end**: export → check the MP4 container brand →
   decode it back in the page → seek → sample pixels → assert non-black and
   correct duration.
4. **Test persistence across a real reload**, and archive round-trips across a
   **fresh browser context** (which is the honest simulation of "another
   machine").
5. **Collect `pageerror` and `console.error` throughout and fail on any.**
   This alone catches more than assertions do.
6. **Screenshot and actually look.** Two visual bugs (overlapping overlays,
   onboarding text colliding with the canvas) were invisible to assertions.

---

## 6. If you are rebuilding from scratch

Build in this order; each stage is verifiable before the next exists.

1. `types/model.ts`, then the store with undo. No UI.
2. The compositor + keyframes + text renderer, rendered into a static canvas at
   a fixed `t`. Screenshot it.
3. Timeline UI + preview + transport. Playback via the Web Audio clock.
4. Export (WebCodecs + muxer) — verify preview/export parity immediately, before
   adding features, because parity is cheap to keep and expensive to retrofit.
5. Persistence (IndexedDB blobs + project records) — do this **before**
   accumulating features, so no work is ever lost during development.
6. Effects, transitions, charts, stickers.
7. Local AI, starting with the pure-DSP tools (silence, beats), then Whisper.
8. Everything in §4 that remains.

Two things to resist: putting rendering logic in React components, and adding
any runtime network call. Both are one-way doors for this product.
