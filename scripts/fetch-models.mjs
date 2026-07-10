#!/usr/bin/env node
// Downloads the Whisper ONNX model into public/models/ so auto-captions work
// with zero network access at runtime. Run once: `npm run fetch-models`.
// Without this, the app downloads the same files on first use and caches them
// in the browser — also a one-time download, just not pre-bundled.

import { mkdir, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

// default: English-only tiny model. `npm run fetch-models -- --multilingual`
// also grabs the 90+ language variant (adds ~75 MB).
const MODELS = ['onnx-community/whisper-tiny.en']
if (process.argv.includes('--multilingual')) MODELS.push('onnx-community/whisper-tiny')

const FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]

async function download(model, file) {
  const dest = path.join(process.cwd(), 'public', 'models', model, file)
  if (existsSync(dest)) {
    console.log(`✓ ${model}/${file} (cached)`)
    return
  }
  await mkdir(path.dirname(dest), { recursive: true })
  const url = `https://huggingface.co/${model}/resolve/main/${file}`
  process.stdout.write(`↓ ${model}/${file} … `)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`)
}

for (const model of MODELS) {
  console.log(`Fetching ${model} → public/models/\n`)
  for (const f of FILES) {
    await download(model, f)
  }
}

// MediaPipe WASM runtime for person segmentation ("text behind person"):
// copied straight from node_modules — no network involved.
const wasmSrc = path.join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const wasmDest = path.join(process.cwd(), 'public', 'mediapipe-wasm')
if (existsSync(wasmSrc)) {
  await cp(wasmSrc, wasmDest, { recursive: true })
  console.log('✓ mediapipe wasm runtime → public/mediapipe-wasm/')
}

// `-- --segmentation`: the selfie segmentation model (~16 MB, one-time)
if (process.argv.includes('--segmentation')) {
  const dest = path.join(process.cwd(), 'public', 'models', 'mediapipe', 'selfie_segmenter.tflite')
  if (existsSync(dest)) {
    console.log('✓ selfie_segmenter.tflite (cached)')
  } else {
    await mkdir(path.dirname(dest), { recursive: true })
    const url = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
    process.stdout.write('↓ selfie_segmenter.tflite … ')
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(dest, buf)
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`)
  }
}

console.log('\nDone. AI features now run fully offline.')
