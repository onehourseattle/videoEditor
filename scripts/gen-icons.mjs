#!/usr/bin/env node
// Generates the app icons (PNG) with zero dependencies — a rounded purple
// square with a white play triangle, encoded by a minimal PNG writer on top
// of Node's built-in zlib. Run: node scripts/gen-icons.mjs

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const r = size * 0.22 // corner radius
  const cx = size / 2
  // play triangle geometry
  const triLeft = size * 0.38
  const triRight = size * 0.72
  const triHalf = size * 0.19

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // rounded-rect mask
      const dx = Math.max(r - x, x - (size - 1 - r), 0)
      const dy = Math.max(r - y, y - (size - 1 - r), 0)
      const inside = dx * dx + dy * dy <= r * r
      if (!inside) continue
      // vertical gradient #7d6ef0 → #5a48d6
      const t = y / size
      let R = Math.round(0x7d + (0x5a - 0x7d) * t)
      let G = Math.round(0x6e + (0x48 - 0x6e) * t)
      let B = Math.round(0xf0 + (0xd6 - 0xf0) * t)
      // play triangle (white)
      if (x >= triLeft && x <= triRight) {
        const span = triHalf * (1 - (x - triLeft) / (triRight - triLeft))
        if (Math.abs(y - cx) <= span) {
          R = G = B = 255
        }
      }
      px[i] = R
      px[i + 1] = G
      px[i + 2] = B
      px[i + 3] = 255
    }
  }
  return encodePng(size, size, px)
}

const outDir = path.join(process.cwd(), 'public', 'icons')
mkdirSync(outDir, { recursive: true })
for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`)
  writeFileSync(file, drawIcon(size))
  console.log(`✓ ${file}`)
}
