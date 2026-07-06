# CutRoom on iOS

All three paths keep everything local — the app never calls any service.

## 1. PWA (fastest, no Xcode)

On your Mac:

```bash
npm run build
npm run preview -- --host     # serves dist/ on your LAN
```

On the iPhone/iPad (same Wi-Fi): open `http://<your-mac-name>.local:4173`
in Safari → Share → **Add to Home Screen**. You get a full-screen, home-screen
app with the CutRoom icon; the service worker caches the app so it opens
offline afterwards.

Notes:
- If you ran `npm run fetch-models` before building, AI captions work on the
  phone too (the model is part of the served files and gets cached).
- iOS Safari supports WebCodecs video from 16.4; on versions without
  `AudioEncoder`, export automatically falls back to video-only MP4.

## 2. Dev mode on the phone

```bash
npm run dev:lan
```

Open `http://<mac-lan-ip>:5180` on the phone. Live-reloads as you edit code.

## 3. Native app (Capacitor + Xcode)

Capacitor is an open-source WKWebView shell — your app runs as a real iOS app
with no intermediary service. On your Mac (requires Xcode):

```bash
npm run ios:init    # builds web assets, generates the ios/ Xcode project, syncs
npm run ios:open    # opens it in Xcode → select your device → Run
```

After code changes: `npm run ios:sync`, then build again in Xcode.

Tips:
- Set your signing team in Xcode (Signing & Capabilities) to install on a device.
- The generated `ios/` directory is a plain Xcode project you own; commit it if
  you want CI builds.
- File import uses the standard file picker, which on iOS reads from the Files
  app and Photos.

## Touch UI

The editor is pointer-events based, so all timeline gestures (drag, trim,
scrub) work with touch. On screens ≤900px the tool panels become drawers — tap
the active tab icon again to close one — and the inspector slides in from the
right when a clip is selected (tap empty timeline space to dismiss).

## Honest limitations on iOS

- Export encodes H.264 in real-time-ish; long 1080p exports are slower than on
  a Mac. The 540×960 draft preset is quick.
- Whisper transcription on a phone uses the `tiny` model (already the default)
  and takes roughly the clip's duration.
- Safari caps memory per tab; very large source files (>1 GB) are better edited
  on the Mac.
