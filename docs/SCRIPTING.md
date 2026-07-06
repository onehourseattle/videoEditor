# CutRoom scripting reference

Open the **Script** panel (⌘ icon) and write plain JavaScript. Your code runs
as an async function with an `editor` object in scope; `await` works anywhere.
Every mutation goes through the normal undo history — ⌘Z reverts a script run.

Scripts run locally in the app with the same trust as the app itself. Only run
scripts you wrote or read.

## Inspection

| API | Returns |
|---|---|
| `editor.project` | the whole project (read-only snapshot) |
| `editor.duration()` | timeline length in seconds |
| `editor.tracks()` | all tracks `{ id, kind, name, clips }` |
| `editor.clips(filter?)` | all clips, sorted by start. Filter: `{ kind?, trackId? }` |
| `editor.assets()` | imported media `{ id, name, type, duration }` |
| `editor.playhead` / `editor.seek(t)` | read / move the playhead |
| `editor.log(msg)` | print to the script console |

## Building the timeline

```js
const track = editor.addTrack('overlay', 'My overlays')  // 'video' | 'audio' | 'overlay'

editor.addVideoClip(assetId, trackId, start, { offset, duration, speed, volume })
editor.addAudioClip(assetId, trackId, start, { offset, duration, volume, fadeIn, fadeOut })

editor.addText('HELLO', start, duration, {
  style: { fontSize: 90, color: '#fff', strokeWidth: 8, uppercase: true },
  animation: 'wordPop',   // none|fadeIn|popIn|slideUp|typewriter|wordPop|wordHighlight|bounceIn|waveIn|shake
  y: -500,                // px from center; negative = up
})

editor.addChart('counter', start, duration, {
  spec: {
    title: 'Likes', prefix: '', suffix: ' ❤️',
    data: [{ label: 'from', value: 0 }, { label: 'to', value: 128000 }],
    animateIn: 'pop',     // draw | rise | pop | none
  },
})
// chart types: line, area, bar, barRace, counter, donut, progress, sparkline

editor.addSticker('🔥', start, duration, { animation: 'pulse', x: 380, y: 300 })
```

## Editing

```js
editor.split(clipId, t)                 // split at timeline time
editor.remove(clipId)                   // or an array of ids
editor.move(clipId, newStart)
editor.trim(clipId, { start, end })     // either or both edges
editor.setSpeed(clipId, 2)              // 0.1–4, duration rescales
editor.setVolume(clipId, 0.5)
editor.setTransition(clipId, 'zoomIn', 0.3)
// crossfade|fadeToBlack|slideLeft|slideRight|slideUp|wipe|zoomIn|zoomOut|blurThrough|glitch|spin

editor.addEffect(clipId, 'chromaKey', { keyColor: '#00ff00', tolerance: 0.35 })
editor.rippleDelete(trackId, from, to)  // cut a time range, close the gap

editor.keyframe(clipId, 'scale', 0, 1.0)          // prop: x|y|scale|rotation|opacity
editor.keyframe(clipId, 'scale', 3, 1.15, 'easeInOut')
```

## Local AI

All of these run on-device; the transcription APIs need the bundled model
(`npm run fetch-models`, one time).

```js
await editor.transcribe(assetId)          // → [{ text, start, end }] word timestamps
await editor.autoCaption(clipId)          // adds karaoke caption clips
await editor.removeFillerWords(clipId)    // cuts um/uh/stutters
await editor.removeSilences(clipId, { threshold: 0.18, minSilence: 0.45 })
await editor.detectSilences(assetId)      // → [{ start, end }] source time
await editor.detectBeats(assetId)         // → [t, t, ...] + logs BPM
await editor.detectScenes(assetId)        // → [t, t, ...] scene cuts
await editor.findHighlights(assetId, 3, 5)// → [{ start, end, score }]
await editor.autoReframe(clipId)          // motion-tracked crop keyframes
```

## Recipes

Every example in the panel's dropdown is a working recipe: rough-cut + captions,
silence + filler removal, beat-synced montage, likes counter outro, hook/CTA
text, highlight reel, Ken Burns zoom. Compose them — e.g. a full "podcast →
Shorts" pipeline:

```js
const [clip] = editor.clips({ kind: 'video' })
await editor.removeSilences(clip.id)
await editor.removeFillerWords(clip.id)
await editor.autoCaption(clip.id)
for (const c of editor.clips({ kind: 'video' })) {
  editor.keyframe(c.id, 'scale', 0, 1.0)
  editor.keyframe(c.id, 'scale', c.duration, 1.1)
}
editor.addText('FOLLOW FOR PART 2 →', editor.duration() - 2.5, 2.5, { animation: 'popIn', y: 520 })
```
