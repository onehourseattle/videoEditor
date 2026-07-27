/** Codec negotiation shared by the main-thread and Worker export paths. */

export type MuxVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1'

export interface CodecChoice {
  mux: MuxVideoCodec
  codec: string
}

/** First codec this environment can actually encode, best first. */
export async function pickVideoCodec(s: {
  width: number
  height: number
  fps: number
  videoBitrate: number
}): Promise<CodecChoice> {
  const mbps = (s.width * s.height * s.fps) / 256
  const avcLevel = mbps > 983040 ? '33' : '2a'
  const candidates: CodecChoice[] = [
    { mux: 'avc', codec: `avc1.6400${avcLevel}` }, // H.264 High
    { mux: 'avc', codec: `avc1.4200${avcLevel}` }, // H.264 Baseline
    { mux: 'vp9', codec: 'vp09.00.41.08' },
    { mux: 'av1', codec: 'av01.0.08M.08' },
  ]
  for (const c of candidates) {
    try {
      const res = await VideoEncoder.isConfigSupported({
        codec: c.codec, width: s.width, height: s.height, bitrate: s.videoBitrate, framerate: s.fps,
      })
      if (res.supported) return c
    } catch { /* try next */ }
  }
  throw new Error('No supported video encoder found in this browser.')
}

export async function pickAudioCodec(sampleRate: number): Promise<{ mux: 'aac' | 'opus'; codec: string } | null> {
  if (typeof AudioEncoder === 'undefined') return null
  const candidates = [
    { mux: 'aac' as const, codec: 'mp4a.40.2' },
    { mux: 'opus' as const, codec: 'opus' },
  ]
  for (const c of candidates) {
    try {
      const res = await AudioEncoder.isConfigSupported({
        codec: c.codec, sampleRate, numberOfChannels: 2, bitrate: 192_000,
      })
      if (res.supported) return c
    } catch { /* try next */ }
  }
  return null
}

/** Interleave planar stereo PCM and drive an AudioEncoder. */
export async function encodePcm(
  channels: Float32Array[],
  sampleRate: number,
  codec: string,
  emit: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
) {
  let err: Error | null = null
  const encoder = new AudioEncoder({
    output: emit,
    error: (e) => { err = e instanceof Error ? e : new Error(String(e)) },
  })
  encoder.configure({ codec, sampleRate, numberOfChannels: 2, bitrate: 192_000 })

  const left = channels[0]
  const right = channels[1] ?? channels[0]
  const total = left.length
  const chunkFrames = 4800 // 0.1s per AudioData
  for (let offset = 0; offset < total; offset += chunkFrames) {
    if (err) throw err
    const n = Math.min(chunkFrames, total - offset)
    const interleaved = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      interleaved[i * 2] = left[offset + i]
      interleaved[i * 2 + 1] = right[offset + i]
    }
    const data = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((offset / sampleRate) * 1e6),
      data: interleaved,
    })
    encoder.encode(data)
    data.close()
  }
  await encoder.flush()
  encoder.close()
}
