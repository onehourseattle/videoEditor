#!/usr/bin/env node
// Downloads the Whisper ONNX model into public/models/ so auto-captions work
// with zero network access at runtime. Run once: `npm run fetch-models`.
// Without this, the app downloads the same files on first use and caches them
// in the browser — also a one-time download, just not pre-bundled.

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const MODEL = 'onnx-community/whisper-tiny.en'
const BASE = `https://huggingface.co/${MODEL}/resolve/main`
const FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]

const outDir = path.join(process.cwd(), 'public', 'models', MODEL)

async function download(file) {
  const dest = path.join(outDir, file)
  if (existsSync(dest)) {
    console.log(`✓ ${file} (cached)`)
    return
  }
  await mkdir(path.dirname(dest), { recursive: true })
  const url = `${BASE}/${file}`
  process.stdout.write(`↓ ${file} … `)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`)
}

console.log(`Fetching ${MODEL} → public/models/\n`)
for (const f of FILES) {
  await download(f)
}
console.log('\nDone. Auto-captions now run fully offline.')
