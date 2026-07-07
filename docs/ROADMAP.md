# CutRoom → professional social-media-marketing grade

An honest gap analysis. ✅ = shipped today, 🔶 = partial, ⬜ = missing.
Priority: **P0** = table stakes for professional daily use, **P1** = what makes
marketers choose it over CapCut, **P2** = delighters. Effort: S / M / L.

---

## 1. Reliability & media handling (the trust layer)

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Persistent media storage** — store imported files in IndexedDB / File System Access API so closing the tab never asks to re-link | ⬜ | M | Single biggest trust gap. Today: object URLs die on reload |
| P0 | Project manager — multiple named projects with thumbnails, duplicate, delete | ⬜ | M | Today: one autosave slot + manual JSON files |
| P0 | Proxy media — auto-generate low-res proxies for smooth scrubbing of 4K/long files | ⬜ | M | Preview stutters on heavy sources |
| P0 | Export in a Web Worker (OffscreenCanvas) so editing continues during render; export queue + history | ⬜ | M | Export currently occupies the main thread |
| P1 | Version snapshots — named checkpoints you can roll back to | ⬜ | S | History exists in-session only |
| P1 | Crash recovery banner ("restore last session?") instead of silent restore | 🔶 | S | Autosave restores silently today |

## 2. Core editing (daily-driver ergonomics)

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Multi-select** — rubber-band drag, shift-click, group move/delete/copy | ⬜ | M | Single selection only |
| P0 | Copy/paste clips + **paste attributes** ("apply this style to all") | ⬜ | S | CapCut's most-used shortcut for caption styling |
| P0 | Keyframed **volume envelope drawn on the clip** (fade handles + points) | 🔶 | M | Fades exist as numbers; no visual curve |
| P0 | JKL shuttle, I/O in-out points, loop range playback | ⬜ | S | Core pro-editor muscle memory |
| P0 | Roll trim between adjacent clips + slip edit (change offset without moving) | ⬜ | M | Only in/out trim today |
| P1 | **Speed ramping** with curve editor + reverse + freeze frame | 🔶 | L | Constant speed only; reverse needs decode pipeline work |
| P1 | Markers on the timeline (color-coded, named) — e.g. "hook ends here" | ⬜ | S | |
| P1 | Adjustment layers — apply color/effects to everything below | ⬜ | M | Model supports it cleanly (new clip kind) |
| P1 | Keyframe **graph editor** (curves, copy easing) | ⬜ | M | Keyframes exist; UI is numeric only |
| P2 | Compound/nested clips | ⬜ | L | |
| P2 | Blend modes + shape/feather **masks** per clip | ⬜ | M | Canvas supports both natively |

## 3. Captions & typography (the #1 social feature)

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Inline transcript editor** — fix Whisper mistakes, retime words, merge/split pages in a side panel | ⬜ | M | Captions are edit-blind after generation; this is make-or-break |
| P0 | **Font import** (.ttf/.otf via FontFace) + a bundled set of licensed display fonts | ⬜ | S | System fonts only today — marketers live on brand fonts |
| P0 | SRT/VTT **import and export** | ⬜ | S | Repurposing + platform caption upload |
| P0 | Caption template gallery (Hormozi, MrBeast, podcast, minimal, karaoke…) with live preview thumbnails | 🔶 | M | 10 text presets exist; captions inherit only one style |
| P1 | Per-word styling (color/emoji injection on keywords), auto-emphasis of loud words | ⬜ | M | Word timings already exist |
| P1 | **Brand kit** — saved colors, fonts, logo watermark, default caption style applied on generate | ⬜ | M | Huge for agencies/consistency |
| P2 | Auto-translate captions (local model, e.g. NLLB via transformers.js) | ⬜ | L | Keeps the no-API promise |

## 4. Audio (where amateur edits get exposed)

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Auto-ducking** — music dips under speech automatically | ⬜ | M | Speech detection is already possible with existing RMS/VAD code |
| P0 | **Loudness normalization to −14 LUFS** (platform target) + meter | ⬜ | M | Platforms re-normalize; pros deliver to spec |
| P0 | Noise reduction (RNNoise WASM — local) | ⬜ | M | Room noise is the #1 giveaway of amateur content |
| P1 | Compressor/limiter + simple EQ per clip | ⬜ | M | OfflineAudioContext has DynamicsCompressor built in |
| P1 | Voice recording directly in the app (mic capture to a track) | ⬜ | S | getUserMedia is local |
| P1 | Beat markers rendered on music clips (beats already detectable) | 🔶 | S | Detection shipped; no visualization |
| P2 | Local TTS voiceover (system voices via Web Speech / Piper WASM) | ⬜ | M | CapCut parity, still no cloud |

## 5. Local AI (the differentiator — keep pushing)

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Face/subject-aware auto-reframe** (MediaPipe face detection, local) | 🔶 | M | Motion-based version shipped; faces are what matter for talking heads |
| P0 | **One-click "Auto edit"** pipeline: silence cut → filler cut → captions → punch-in zooms on sentence starts → done | 🔶 | S | All pieces exist as separate tools + scripting; needs one hero button |
| P1 | **Long video → multiple Shorts**: hook-scored segmentation, each segment becomes a project | ⬜ | L | The single most valuable marketing workflow in 2026 |
| P1 | Background removal / virtual green screen (MediaPipe segmentation, local) | ⬜ | M | |
| P1 | Whisper model picker (tiny→small→medium) + language selection | 🔶 | S | Hardcoded tiny.en today |
| P1 | Auto punch-in zoom on sentence boundaries (transcript-driven) | ⬜ | S | Trivially scriptable already; productize |
| P2 | Local LLM (WebLLM) for hook lines, captions, hashtags — optional heavy module | ⬜ | L | Only if it stays 100% local |
| P2 | Auto sound-effect markers (whoosh on cuts, ding on keywords) | ⬜ | M | Needs a bundled SFX pack |

## 6. Graphics, templates & motion

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Project templates** — save any edit as a reusable template; starter pack (podcast clip, product promo, talking head, listicle) | ⬜ | M | Templates are how marketers scale output |
| P0 | Lower-thirds / CTA pack ("follow", "link in bio", subscribe button animations) | 🔶 | S | Charts/stickers/text exist; needs curated composed presets |
| P1 | Lottie playback (lottie-web, local JSON stickers) | ⬜ | M | Unlocks whole animation ecosystems offline |
| P1 | Chart data from CSV/clipboard paste | 🔶 | S | Manual label:value entry today |
| P1 | Transition preview thumbnails (hover to see it) | ⬜ | S | Names only today |
| P1 | Image pan/zoom presets (Ken Burns gallery) | 🔶 | S | Doable via keyframes; needs one-click presets |
| P2 | GIF export (for thumbnails/teasers) | ⬜ | S | |
| P2 | Chroma key spill suppression + edge feather | 🔶 | M | Basic key shipped |

## 7. Publish-readiness (marketing-specific, nobody else does this locally)

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | **Platform UI overlay preview** — TikTok/Reels/Shorts interface mockup over the canvas so captions never hide behind the like button | ⬜ | S | Cheap to build, enormous perceived value |
| P0 | Title-safe / action-safe guides + center/thirds guides with snapping in the preview | ⬜ | S | |
| P0 | **Batch export**: one click → 9:16 + 1:1 + 16:9 renditions queued | ⬜ | M | Cross-posting is the whole job |
| P0 | Cover-frame picker + PNG thumbnail export (with text overlays) | ⬜ | S | |
| P1 | Pre-flight checklist per platform: duration limit, resolution, loudness, caption coverage, hook-in-first-3s | ⬜ | M | Reads like an agency QA sheet |
| P1 | "Hook report" — visual-change rate, loudness, on-screen text presence for seconds 0–3 | ⬜ | M | All computable locally with shipped analyzers |
| P2 | A/B variant builder — same body, swap hook segments/first captions | ⬜ | M | Scripting can prototype this today |

## 8. UX & platform polish

| P | Item | Status | Effort | Notes |
|---|---|---|---|---|
| P0 | Undo/redo **toasts with action names** ("Undid: split clip") | ⬜ | S | |
| P0 | Accessibility pass: focus rings, ARIA labels, reduced-motion, full keyboard nav | 🔶 | M | |
| P0 | Real iPad/iPhone gesture pass: pinch-zoom timeline, long-press context menu | 🔶 | M | Pointer events work; gestures aren't tuned |
| P1 | Command palette (⌘K) — every action searchable | ⬜ | S | |
| P1 | Interactive tutorial project that teaches by doing | ⬜ | M | |
| P1 | Panel resize + saved workspace layout | ⬜ | S | |
| P2 | Localization (es, pt, de, fr first) | ⬜ | M | |
| P2 | Plugin API — third-party panels/effects built on the scripting layer | 🔶 | L | Scripting API is the seed |

---

## Suggested build order (ships in coherent releases)

1. **"Never lose work"** — IndexedDB media persistence, project manager, worker export + queue. *(Reliability is the price of admission.)*
2. **"Captions people brag about"** — transcript editor, font import, caption template gallery, SRT in/out, paste-attributes.
3. **"Sounds professional"** — auto-ducking, −14 LUFS normalization, noise reduction, volume envelopes.
4. **"Publish like an agency"** — platform UI overlays, safe zones, batch multi-aspect export, cover picker, pre-flight checklist.
5. **"The AI editor"** — one-click Auto edit, face-aware reframe, long-video→Shorts splitter.
6. **"Scale content"** — project templates, brand kits, Lottie, command palette.

Everything above preserves the core promise: **no cloud, no API calls, runs on your Mac (and iPhone).**
