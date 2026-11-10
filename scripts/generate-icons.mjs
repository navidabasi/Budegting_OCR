// Generates the PWA icon set in public/ from "wallet icon.svg".
// Usage: node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pub = (f) => resolve(root, 'public', f)

const FOREST = '#00573F'
const svg = readFileSync(resolve(root, 'wallet icon.svg'), 'utf8')
const pathD = svg.match(/<path d="([^"]+)"/)[1]

// Wallet glyph (16x16 viewBox) centred in a size x size canvas, occupying `scale` of it.
function iconSvg(size, { scale, radius, fill = '#FFFFFF', bg = FOREST }) {
    const glyph = size * scale
    const offset = (size - glyph) / 2
    const k = glyph / 16
    const rect = bg
        ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>`
        : ''
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rect}` +
            `<g transform="translate(${offset} ${offset}) scale(${k})"><path d="${pathD}" fill="${fill}"/></g></svg>`
    )
}

const png = (buf, out) => sharp(buf).png().toFile(pub(out))

// Rounded "any" icons: glyph ~62% of canvas. Maskable: full-bleed, glyph inside the 80% safe zone.
await png(iconSvg(192, { scale: 0.62, radius: 40 }), 'pwa-192x192.png')
await png(iconSvg(512, { scale: 0.62, radius: 108 }), 'pwa-512x512.png')
await png(iconSvg(192, { scale: 0.5, radius: 0 }), 'pwa-maskable-192x192.png')
await png(iconSvg(512, { scale: 0.5, radius: 0 }), 'pwa-maskable-512x512.png')
await png(iconSvg(180, { scale: 0.58, radius: 0 }), 'apple-touch-icon.png') // iOS applies its own mask

// favicon.ico: ICO container holding PNG images (valid for all modern browsers).
const sizes = [16, 32, 48]
const pngs = await Promise.all(sizes.map((s) => sharp(iconSvg(s, { scale: 0.7, radius: Math.round(s * 0.2) })).png().toBuffer()))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = pngs.map((buf, i) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(sizes[i], 0)
    e.writeUInt8(sizes[i], 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += buf.length
    return e
})
writeFileSync(pub('favicon.ico'), Buffer.concat([header, ...entries, ...pngs]))

// Safari pinned-tab mask icon: monochrome glyph, no background.
writeFileSync(
    pub('mask-icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${pathD}" fill="#000000"/></svg>\n`
)
console.log('Icons written to public/')
