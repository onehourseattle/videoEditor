import type { Effect, EffectType } from '../types/model'

/**
 * GPU path for per-pixel effects.
 *
 * The CSS-filter effects (brightness, blur, …) are already GPU-accelerated by
 * the browser; the expensive ones were the `getImageData` loops — chroma key,
 * grain, convolution. Those run here as fragment shaders instead, chained
 * through ping-pong framebuffers so a clip with four effects still costs one
 * upload and one readback.
 *
 * Returns a canvas holding the result, or null when WebGL is unavailable or
 * a program fails to compile — callers fall back to the CPU implementation,
 * which stays authoritative for correctness.
 */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

const GPU_EFFECTS: ReadonlySet<EffectType> = new Set<EffectType>([
  'chromaKey', 'vignette', 'glitch', 'vhs', 'filmGrain', 'pixelate', 'sharpen', 'lut',
])

export function isGpuEffect(type: EffectType): boolean {
  return GPU_EFFECTS.has(type)
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const HEAD = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
varying vec2 vUV;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`

/** Fragment shaders — deliberately mirroring the CPU maths in effects.ts. */
const FRAG: Partial<Record<EffectType, string>> = {
  chromaKey: `${HEAD}
uniform vec3 uKey;
uniform float uTol;
uniform float uSoft;
void main() {
  vec4 c = texture2D(uTex, vUV);
  float d = distance(c.rgb, uKey);
  float a = clamp((d - uTol) / max(uSoft, 0.0001), 0.0, 1.0);
  gl_FragColor = vec4(c.rgb, c.a * a);
}`,

  vignette: `${HEAD}
uniform float uAmount;
void main() {
  vec4 c = texture2D(uTex, vUV);
  float inner = min(uRes.x, uRes.y) * 0.4;
  float outer = max(uRes.x, uRes.y) * 0.75;
  float d = length((vUV - 0.5) * uRes);
  float t = clamp((d - inner) / max(outer - inner, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(mix(c.rgb, vec3(0.0), t * uAmount), c.a);
}`,

  filmGrain: `${HEAD}
uniform float uAmount;
void main() {
  vec4 c = texture2D(uTex, vUV);
  float n = (hash(vUV * uRes + uTime * 97.0) - 0.5) * uAmount;
  gl_FragColor = vec4(c.rgb + n, c.a);
}`,

  pixelate: `${HEAD}
uniform float uSize;
void main() {
  vec2 blocks = max(uRes / max(uSize, 1.0), vec2(1.0));
  vec2 uv = (floor(vUV * blocks) + 0.5) / blocks;
  gl_FragColor = texture2D(uTex, uv);
}`,

  sharpen: `${HEAD}
void main() {
  vec2 t = 1.0 / uRes;
  vec4 mid = texture2D(uTex, vUV);
  vec3 sum = mid.rgb * 5.0
    - texture2D(uTex, vUV + vec2(t.x, 0.0)).rgb
    - texture2D(uTex, vUV - vec2(t.x, 0.0)).rgb
    - texture2D(uTex, vUV + vec2(0.0, t.y)).rgb
    - texture2D(uTex, vUV - vec2(0.0, t.y)).rgb;
  gl_FragColor = vec4(clamp(sum, 0.0, 1.0), mid.a);
}`,

  lut: `${HEAD}
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform float uMix;
void main() {
  vec4 c = texture2D(uTex, vUV);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 target = mix(uShadows, uHighlights, lum);
  gl_FragColor = vec4(mix(c.rgb, target, uMix), c.a);
}`,

  vhs: `${HEAD}
void main() {
  vec4 c = texture2D(uTex, vUV);
  float line = mod(floor(vUV.y * uRes.y) + floor(uTime * 30.0), 3.0);
  vec3 col = c.rgb * (line < 1.0 ? 0.88 : 1.0);
  float r = texture2D(uTex, vUV + vec2(2.0 / uRes.x, 0.0)).r;
  col.r = mix(col.r, r, 0.35);
  gl_FragColor = vec4(col, c.a);
}`,

  glitch: `${HEAD}
uniform float uAmount;
void main() {
  float seed = floor(uTime * 12.0);
  float band = floor(vUV.y * 24.0);
  float pick = hash(vec2(band, seed));
  float off = pick > 0.72 ? (hash(vec2(band, seed + 7.0)) - 0.5) * 0.08 * uAmount : 0.0;
  vec2 uv = vec2(clamp(vUV.x + off, 0.0, 1.0), vUV.y);
  vec4 c = texture2D(uTex, uv);
  float r = texture2D(uTex, vec2(clamp(uv.x + 0.004 * uAmount, 0.0, 1.0), uv.y)).r;
  gl_FragColor = vec4(mix(c.r, r, 0.6), c.g, c.b, c.a);
}`,
}

interface Pass {
  program: WebGLProgram
  apply: (gl: WebGLRenderingContext, program: WebGLProgram) => void
}

class GlRenderer {
  private canvas: AnyCanvas | null = null
  private gl: WebGLRenderingContext | null = null
  private programs = new Map<EffectType, WebGLProgram | null>()
  private quad: WebGLBuffer | null = null
  private srcTex: WebGLTexture | null = null
  private pingTex: (WebGLTexture | null)[] = [null, null]
  private pingFbo: (WebGLFramebuffer | null)[] = [null, null]
  private pingSize = { w: 0, h: 0 }
  failed = false

  private init(w: number, h: number): boolean {
    if (this.failed) return false
    if (!this.gl) {
      try {
        this.canvas =
          typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined'
            ? new OffscreenCanvas(w, h)
            : document.createElement('canvas')
        const gl = (this.canvas as HTMLCanvasElement).getContext('webgl', {
          alpha: true,
          premultipliedAlpha: false,
          preserveDrawingBuffer: true,
          antialias: false,
          depth: false,
        }) as WebGLRenderingContext | null
        if (!gl) {
          this.failed = true
          return false
        }
        this.gl = gl
        this.quad = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
        this.srcTex = this.makeTexture(gl)
        gl.disable(gl.BLEND)
        gl.disable(gl.DEPTH_TEST)
      } catch {
        this.failed = true
        return false
      }
    }
    const gl = this.gl!
    if (this.canvas!.width !== w || this.canvas!.height !== h) {
      this.canvas!.width = w
      this.canvas!.height = h
    }
    gl.viewport(0, 0, w, h)
    return true
  }

  private makeTexture(gl: WebGLRenderingContext): WebGLTexture | null {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return tex
  }

  /** Ping-pong targets, rebuilt when the frame size changes. */
  private ensurePingPong(w: number, h: number) {
    const gl = this.gl!
    if (this.pingSize.w === w && this.pingSize.h === h && this.pingFbo[0]) return
    for (let i = 0; i < 2; i++) {
      if (this.pingTex[i]) gl.deleteTexture(this.pingTex[i])
      if (this.pingFbo[i]) gl.deleteFramebuffer(this.pingFbo[i])
      const tex = this.makeTexture(gl)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.pingTex[i] = tex
      this.pingFbo[i] = fbo
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.pingSize = { w, h }
  }

  private program(type: EffectType): WebGLProgram | null {
    if (this.programs.has(type)) return this.programs.get(type)!
    const gl = this.gl!
    const src = FRAG[type]
    let program: WebGLProgram | null = null
    if (src) {
      const vs = this.compile(gl.VERTEX_SHADER, VERT)
      const fs = this.compile(gl.FRAGMENT_SHADER, src)
      if (vs && fs) {
        program = gl.createProgram()
        if (program) {
          gl.attachShader(program, vs)
          gl.attachShader(program, fs)
          gl.linkProgram(program)
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) program = null
        }
      }
    }
    this.programs.set(type, program)
    return program
  }

  private compile(kind: number, source: string): WebGLShader | null {
    const gl = this.gl!
    const sh = gl.createShader(kind)
    if (!sh) return null
    gl.shaderSource(sh, source)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh)
      return null
    }
    return sh
  }

  render(source: AnyCanvas, effects: Effect[], time: number): AnyCanvas | null {
    const w = source.width
    const h = source.height
    if (w < 1 || h < 1) return null
    const active = effects.filter((e) => e.enabled && isGpuEffect(e.type))
    if (!active.length) return null
    if (!this.init(w, h)) return null
    const gl = this.gl!

    // bail (once) if any shader in the chain failed to build
    const passes: { type: EffectType; effect: Effect; program: WebGLProgram }[] = []
    for (const e of active) {
      const p = this.program(e.type)
      if (!p) return null
      passes.push({ type: e.type, effect: e, program: p })
    }

    this.ensurePingPong(w, h)

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)

    let readTex = this.srcTex
    for (let i = 0; i < passes.length; i++) {
      const last = i === passes.length - 1
      const { program, effect, type } = passes[i]
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : this.pingFbo[i % 2])
      gl.useProgram(program)

      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
      const loc = gl.getAttribLocation(program, 'aPos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, readTex)
      gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0)
      gl.uniform2f(gl.getUniformLocation(program, 'uRes'), w, h)
      gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time)
      setUniforms(gl, program, type, effect)

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (!last) readTex = this.pingTex[i % 2]
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.canvas
  }
}

function hexToVec3(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (isNaN(n)) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function setUniforms(gl: WebGLRenderingContext, p: WebGLProgram, type: EffectType, e: Effect) {
  const u = (name: string) => gl.getUniformLocation(p, name)
  const num = (key: string, fallback: number) => {
    const v = Number(e.params[key])
    return isFinite(v) ? v : fallback
  }
  switch (type) {
    case 'chromaKey': {
      const [r, g, b] = hexToVec3(String(e.params.keyColor ?? '#00ff00'))
      gl.uniform3f(u('uKey'), r, g, b)
      // CPU compares 0-255 distances against tolerance*255*sqrt(3); normalized here
      gl.uniform1f(u('uTol'), num('tolerance', 0.35) * Math.sqrt(3))
      gl.uniform1f(u('uSoft'), num('softness', 0.1))
      break
    }
    case 'vignette':
      gl.uniform1f(u('uAmount'), Math.min(1, num('amount', 0.6)))
      break
    case 'filmGrain':
      gl.uniform1f(u('uAmount'), num('amount', 0.15))
      break
    case 'pixelate':
      gl.uniform1f(u('uSize'), num('size', 16))
      break
    case 'glitch':
      gl.uniform1f(u('uAmount'), num('amount', 1))
      break
    case 'lut': {
      const [sr, sg, sb] = hexToVec3(String(e.params.shadows ?? '#123a52'))
      const [hr, hg, hb] = hexToVec3(String(e.params.highlights ?? '#ffb86b'))
      gl.uniform3f(u('uShadows'), sr, sg, sb)
      gl.uniform3f(u('uHighlights'), hr, hg, hb)
      gl.uniform1f(u('uMix'), num('amount', 0.35))
      break
    }
    default:
      break
  }
}

const renderer = new GlRenderer()

/**
 * Run the GPU effect chain. Returns a canvas to draw (valid until the next
 * call — callers composite immediately) or null to fall back to the CPU path.
 */
export function applyPixelEffectsGPU(source: AnyCanvas, effects: Effect[], time: number): AnyCanvas | null {
  if (cpuForced()) return null
  try {
    return renderer.render(source, effects, time)
  } catch {
    renderer.failed = true
    return null
  }
}

/**
 * `?cpufx=1` forces the CPU implementation — an escape hatch for machines
 * whose GPU driver renders effects incorrectly, and the A/B for benchmarking.
 */
let cpuFlag: boolean | null = null
function cpuForced(): boolean {
  if (cpuFlag === null) {
    try {
      cpuFlag = new URLSearchParams(location.search).get('cpufx') === '1'
    } catch {
      cpuFlag = false
    }
  }
  return cpuFlag
}

export function gpuAvailable(): boolean {
  return !renderer.failed
}
