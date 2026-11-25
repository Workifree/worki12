// Gera os ícones do PWA a partir da marca "W." (sem dependências: rasteriza e codifica o PNG).
// Uso (de frontend/): node scripts/gerar-icones-pwa.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const GREEN = [0, 166, 81]
const WHITE = [255, 255, 255]

// Marca num espaço próprio de 372 x 190: polígono do "W" + ponto.
const W = [[0, 0], [58, 0], [95, 125], [125, 20], [175, 20], [205, 125], [242, 0], [300, 0], [238, 190], [184, 190], [150, 75], [116, 190], [62, 190]]
const DOT = { x: 344, y: 162, r: 28 }
const BOX = { w: 372, h: 190 }

function inPolygon(x, y) {
  let inside = false
  for (let i = 0, j = W.length - 1; i < W.length; j = i++) {
    const [xi, yi] = W[i]
    const [xj, yj] = W[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inRoundedSquare(x, y, size, radius) {
  const dx = Math.max(radius - x, x - (size - radius), 0)
  const dy = Math.max(radius - y, y - (size - radius), 0)
  return dx * dx + dy * dy <= radius * radius
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of body) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4)
  return out
}

/**
 * markWidth: largura da marca como fração do lado. radius: cantos (fração); 0 = sangria total e
 * PNG opaco (maskable e apple-touch: o sistema aplica a própria máscara).
 */
function render(size, { markWidth, radius }) {
  const alpha = radius > 0
  const channels = alpha ? 4 : 3
  const raw = Buffer.alloc((size * channels + 1) * size)
  const scale = (size * markWidth) / BOX.w
  const offX = (size - BOX.w * scale) / 2
  const offY = (size - BOX.h * scale) / 2
  const SS = 4
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0
      let mark = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          if (alpha && !inRoundedSquare(x, y, size, size * radius)) continue
          bg++
          const mx = (x - offX) / scale
          const my = (y - offY) / scale
          if (inPolygon(mx, my) || (mx - DOT.x) ** 2 + (my - DOT.y) ** 2 <= DOT.r ** 2) mark++
        }
      }
      const at = py * (size * channels + 1) + 1 + px * channels
      const t = bg ? mark / bg : 0
      for (let c = 0; c < 3; c++) raw[at + c] = Math.round(GREEN[c] + (WHITE[c] - GREEN[c]) * t)
      if (alpha) raw[at + 3] = Math.round((bg / (SS * SS)) * 255)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = alpha ? 6 : 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const ANY = { markWidth: 0.72, radius: 0.22 }
// Área segura do maskable: círculo de raio 40% do lado. A 0.62 de largura, o ponto mais distante fica em ~35%.
const MASKABLE = { markWidth: 0.62, radius: 0 }

writeFileSync(out('icon-192.png'), render(192, ANY))
writeFileSync(out('icon-512.png'), render(512, ANY))
writeFileSync(out('icon-maskable-192.png'), render(192, MASKABLE))
writeFileSync(out('icon-maskable-512.png'), render(512, MASKABLE))
writeFileSync(out('apple-touch-icon.png'), render(180, { markWidth: 0.7, radius: 0 }))

const s = (512 * ANY.markWidth) / BOX.w
const transform = `translate(${((512 - BOX.w * s) / 2).toFixed(2)} ${((512 - BOX.h * s) / 2).toFixed(2)}) scale(${s.toFixed(4)})`
writeFileSync(
  out('favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${Math.round(512 * ANY.radius)}" fill="#00A651"/><g fill="#fff" transform="${transform}"><polygon points="${W.map((p) => p.join(',')).join(' ')}"/><circle cx="${DOT.x}" cy="${DOT.y}" r="${DOT.r}"/></g></svg>\n`,
)
