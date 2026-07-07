import { assetStore } from '../state/assetStore'

export interface TranscriptWord {
  text: string
  /** source-time seconds */
  start: number
  end: number
}

export type WhisperModel = 'english' | 'multilingual'

const MODEL_IDS: Record<WhisperModel, string> = {
  english: 'onnx-community/whisper-tiny.en',
  multilingual: 'onnx-community/whisper-tiny',
}

const LANG_KEY = 'cutroom.captionModel'

export function getCaptionModel(): WhisperModel {
  try {
    return localStorage.getItem(LANG_KEY) === 'multilingual' ? 'multilingual' : 'english'
  } catch {
    return 'english'
  }
}

export function setCaptionModel(m: WhisperModel) {
  try { localStorage.setItem(LANG_KEY, m) } catch { /* private mode */ }
}

const pipelines = new Map<WhisperModel, Promise<any>>()

/**
 * On-device speech-to-text with Whisper via transformers.js (ONNX/WASM/WebGPU).
 * Strictly local: the inference runtime is bundled with the app, and model
 * weights are ONLY loaded from this app's own /models directory (populated
 * once by `npm run fetch-models`, `-- --multilingual` for 90+ languages).
 * No remote fetching, ever — if the weights aren't there, we fail with
 * instructions rather than call out to a hub.
 */
async function getPipeline(model: WhisperModel, onProgress?: (msg: string) => void) {
  let p = pipelines.get(model)
  if (!p) {
    p = (async () => {
      const id = MODEL_IDS[model]
      const check = await fetch(`/models/${id}/config.json`, { method: 'HEAD' }).catch(() => null)
      if (!check?.ok) {
        throw new Error(
          model === 'multilingual'
            ? 'Multilingual Whisper model not found. Run `npm run fetch-models -- --multilingual` once, then restart the dev server.'
            : 'Whisper model not found. Run `npm run fetch-models` once (downloads ~75 MB to public/models/), then restart the dev server. After that, captions work fully offline.',
        )
      }
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowLocalModels = true
      env.allowRemoteModels = false // hard guarantee: never contact a model hub
      env.localModelPath = `${location.origin}/models/`
      onProgress?.('Loading Whisper model…')
      return pipeline('automatic-speech-recognition', id, { dtype: 'q8' })
    })()
    pipelines.set(model, p)
    p.catch(() => pipelines.delete(model))
  }
  return p
}

/** Decode an asset's audio to 16kHz mono — Whisper's expected input. */
async function decodeTo16k(assetId: string): Promise<Float32Array | null> {
  const probe = new OfflineAudioContext(1, 1, 16000)
  const buffer = await assetStore.getAudioBuffer(assetId, probe)
  if (!buffer) return null
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000)
  const src = off.createBufferSource()
  src.buffer = buffer
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0).slice()
}

export async function transcribe(
  assetId: string,
  onProgress?: (msg: string) => void,
): Promise<TranscriptWord[]> {
  const audio = await decodeTo16k(assetId)
  if (!audio) throw new Error('This asset has no decodable audio track.')

  const model = getCaptionModel()
  const asr = await getPipeline(model, onProgress)
  onProgress?.('Transcribing…')
  const result = await asr(audio, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(model === 'multilingual' ? { language: null, task: 'transcribe' } : {}),
  })

  const words: TranscriptWord[] = []
  const chunks = result?.chunks ?? []
  for (const c of chunks) {
    const text = String(c.text ?? '').trim()
    if (!text) continue
    const [start, end] = c.timestamp ?? [0, 0]
    words.push({ text, start: start ?? 0, end: end ?? (start ?? 0) + 0.3 })
  }
  return words
}

const FILLERS = new Set(['um', 'uh', 'umm', 'uhh', 'erm', 'hmm', 'mmm', 'ah', 'er'])

/** Words worth cutting: classic fillers, plus optional repeated-word stutters ("I I think"). */
export function findFillerWords(words: TranscriptWord[], includeStutters = true): TranscriptWord[] {
  const out: TranscriptWord[] = []
  for (let i = 0; i < words.length; i++) {
    const norm = words[i].text.toLowerCase().replace(/[^a-z]/g, '')
    if (FILLERS.has(norm)) {
      out.push(words[i])
      continue
    }
    if (includeStutters && i > 0) {
      const prev = words[i - 1].text.toLowerCase().replace(/[^a-z]/g, '')
      if (norm && norm === prev && words[i].start - words[i - 1].end < 0.4) out.push(words[i - 1])
    }
  }
  return out
}
