import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../artifacts/byreum-noor-campaign-2026-08-15/', import.meta.url))
const baseDir = join(root, 'base')
const finalDir = join(root, 'final')

const assets = [
  ['natural-instagram-cover.png', 'instagram', 'NATURAL TEXTURE', 'cover'],
  ['natural-instagram-detail.png', 'instagram', 'NATURAL TEXTURE', 'detail'],
  ['natural-instagram-brand.png', 'instagram', 'NATURAL TEXTURE', 'brand'],
  ['natural-threads.png', 'threads', 'NATURAL TEXTURE', 'threads'],
  ['soft-instagram-cover.png', 'instagram', 'SOFT SHADOW', 'cover'],
  ['soft-instagram-detail.png', 'instagram', 'SOFT SHADOW', 'detail'],
  ['soft-instagram-brand.png', 'instagram', 'SOFT SHADOW', 'brand'],
  ['soft-threads.png', 'threads', 'SOFT SHADOW', 'threads'],
  ['balance-instagram-cover.png', 'instagram', 'PERSONAL BALANCE', 'cover'],
  ['balance-instagram-detail.png', 'instagram', 'PERSONAL BALANCE', 'detail'],
  ['balance-instagram-brand.png', 'instagram', 'PERSONAL BALANCE', 'brand'],
  ['balance-threads.png', 'threads', 'PERSONAL BALANCE', 'threads'],
]

const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function overlay({ width, height, title, role }) {
  const brand = 'BY.REUM BROW'
  const dark = '#302B29'
  const cocoa = '#6E5146'
  const blush = '#D8A9A0'
  const safe = role === 'threads' ? 58 : 72

  if (role === 'brand') {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${safe}" y="${Math.round(height * 0.37)}" width="${width - safe * 2}" height="${Math.round(height * 0.26)}" rx="4" fill="#FFFDF8" fill-opacity="0.86"/>
      <line x1="${safe + 52}" y1="${Math.round(height * 0.43)}" x2="${width - safe - 52}" y2="${Math.round(height * 0.43)}" stroke="${blush}" stroke-width="3"/>
      <text x="${width / 2}" y="${Math.round(height * 0.51)}" text-anchor="middle" font-family="Georgia,serif" font-size="74" letter-spacing="7" fill="${cocoa}">${brand}</text>
      <text x="${width / 2}" y="${Math.round(height * 0.57)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" letter-spacing="6" fill="${dark}">${escapeXml(title)}</text>
      <circle cx="${width / 2 - 12}" cy="${Math.round(height * 0.59)}" r="3" fill="${blush}"/><circle cx="${width / 2}" cy="${Math.round(height * 0.59)}" r="3" fill="${blush}"/><circle cx="${width / 2 + 12}" cy="${Math.round(height * 0.59)}" r="3" fill="${blush}"/>
    </svg>`)
  }

  if (role === 'detail') {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${safe}" y="${height - 270}" width="${width - safe * 2}" height="170" rx="4" fill="#FFFDF8" fill-opacity="0.84"/>
      <line x1="${safe + 34}" y1="${height - 231}" x2="${safe + 154}" y2="${height - 231}" stroke="${blush}" stroke-width="4"/>
      <text x="${safe + 34}" y="${height - 176}" font-family="Arial,sans-serif" font-size="34" font-weight="600" letter-spacing="4" fill="${dark}">${escapeXml(title)}</text>
      <text x="${safe + 34}" y="${height - 130}" font-family="Georgia,serif" font-size="28" letter-spacing="3" fill="${cocoa}">${brand}</text>
    </svg>`)
  }

  const panelY = role === 'threads' ? safe : height - 290
  const titleY = panelY + 70
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${safe}" y="${panelY}" width="${width - safe * 2}" height="190" rx="4" fill="#FFFDF8" fill-opacity="0.84"/>
    <circle cx="${safe + 34}" cy="${panelY + 34}" r="5" fill="${blush}"/>
    <text x="${safe + 34}" y="${titleY}" font-family="Arial,sans-serif" font-size="${role === 'threads' ? 46 : 42}" font-weight="600" letter-spacing="4" fill="${dark}">${escapeXml(title)}</text>
    <line x1="${safe + 34}" y1="${titleY + 26}" x2="${width - safe - 34}" y2="${titleY + 26}" stroke="${blush}" stroke-width="3"/>
    <text x="${safe + 34}" y="${titleY + 78}" font-family="Georgia,serif" font-size="30" letter-spacing="4" fill="${cocoa}">${brand}</text>
  </svg>`)
}

await mkdir(finalDir, { recursive: true })

for (const [filename, channel, title, role] of assets) {
  const width = 1088
  const height = channel === 'instagram' ? 1360 : 1350
  const input = join(baseDir, filename)
  const output = join(finalDir, filename)
  await sharp(input)
    .resize(width, height, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlay({ width, height, title, role }), top: 0, left: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .withMetadata({ density: 72 })
    .toFile(output)
  const metadata = await sharp(output).metadata()
  console.log(`${filename}\t${metadata.width}x${metadata.height}\t${metadata.format}`)
}
