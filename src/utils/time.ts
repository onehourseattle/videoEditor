export function formatTime(seconds: number, fps?: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  if (fps) {
    const f = Math.floor((seconds % 1) * fps)
    return `${pad(m)}:${pad(s)}.${pad(f)}`
  }
  const ms = Math.floor((seconds % 1) * 10)
  return `${pad(m)}:${pad(s)}.${ms}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
