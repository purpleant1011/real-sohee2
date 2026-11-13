/**
 * Visual Verification Calibration Corpus (Wave 5: ANI-1135)
 * 
 * Defines standard ground-truth calibration datasets for visual perceptual verification:
 * - Positive: identical, recompressed (JPEG artifacts), resized/resampled
 * - Borderline: subtle lighting/filter edits (0.65 .. 0.84) -> MANUAL_REVIEW_REQUIRED
 * - Hard Negative: distinct products, cross-domain (salon vs bakery), inverted, scrambled
 */

import type { VerificationOutcome } from '../provider-readback-types'

export const CALIBRATION_CORPUS_VERSION = 'v1.0-meta-calibration'

export type CalibrationSampleKind =
  | 'POSITIVE_IDENTICAL'
  | 'POSITIVE_RECOMPRESSED'
  | 'POSITIVE_RESIZED'
  | 'BORDERLINE_SUBTLE_EDIT'
  | 'HARD_NEGATIVE_DIFFERENT_PRODUCT'
  | 'HARD_NEGATIVE_CROSS_DOMAIN'
  | 'HARD_NEGATIVE_CAROUSEL_REORDER'
  | 'HARD_NEGATIVE_INVERTED'

export interface CalibrationCorpusItem {
  id: string
  kind: CalibrationSampleKind
  description: string
  sourceBytes: Uint8Array
  observedBytes: Uint8Array
  expectedOutcome: VerificationOutcome
}

/**
 * Creates synthetic PNG bytes with specified pattern generator.
 */
function createSyntheticPattern(
  width: number,
  height: number,
  patternFn: (i: number, x: number, y: number) => number
): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const ihdr = [
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]

  const bodyLength = 4096
  const body = new Uint8Array(bodyLength)
  for (let i = 0; i < bodyLength; i++) {
    const x = i % 64
    const y = Math.floor(i / 64)
    body[i] = patternFn(i, x, y) & 0xff
  }

  const full = new Uint8Array(header.length + ihdr.length + body.length)
  full.set(header, 0)
  full.set(ihdr, header.length)
  full.set(body, header.length + ihdr.length)
  return full
}

// 1. Base Tart Image Pattern (Warm bakery gradients)
const baseTart = createSyntheticPattern(1024, 1024, (_i, x, y) => (x * 3 + y * 4) % 256)

// 2. Recompressed Tart Image Pattern (Same gradient with minor compression noise)
const recompressedTart = createSyntheticPattern(1024, 1024, (_i, x, y) => {
  const base = (x * 3 + y * 4) % 256
  const noise = (x % 5 === 0) ? 2 : (y % 7 === 0) ? -2 : 0
  return (base + noise + 256) % 256
})

// 3. Resized Tart Image Pattern (Slightly varied grid step, same overall features)
const resizedTart = createSyntheticPattern(1080, 1080, (_i, x, y) => {
  const base = (x * 3 + y * 4) % 256
  const noise = (x % 11 === 0) ? 1 : 0
  return (base + noise) % 256
})

// 4. Borderline Subtle Filter Edit (Moderate luminance shift and localized shadow, ~75% similarity)
const borderlineTart = createSyntheticPattern(1024, 1024, (_i, x, y) => {
  const base = (x * 3 + y * 4) % 256
  // Shift roughly 25% of the blocks to fall within the 0.65 .. 0.84 gray band
  const filterNoise = (x > 32 && y > 32) ? 75 : 0
  return (base + filterNoise) % 256
})

// 5. Hard Negative: Fig Tart (Different bakery product with inverted diagonal gradient)
const figTart = createSyntheticPattern(1024, 1024, (_i, x, y) => (255 - (x * 4 + y * 2)) % 256)

// 6. Hard Negative: Beauty Salon (Cool inverted checkerboard aesthetic)
const beautySalon = createSyntheticPattern(1024, 1024, (_i, x, y) =>
  (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 230 : 25
)

// 7. Hard Negative: Inverted High-Contrast Image
const invertedTart = createSyntheticPattern(1024, 1024, (_i, x, y) =>
  (255 - ((x * 3 + y * 4) % 256))
)

// 8. Hard Negative: Carousel Reorder Pattern (Vertical stripes vs horizontal)
const verticalStripes = createSyntheticPattern(1024, 1024, (_i, x, _y) =>
  x % 16 < 8 ? 200 : 30
)

export const CALIBRATION_CORPUS_V1: CalibrationCorpusItem[] = [
  {
    id: 'calib-pos-01',
    kind: 'POSITIVE_IDENTICAL',
    description: 'Same exact binary tart image (100% match)',
    sourceBytes: baseTart,
    observedBytes: baseTart,
    expectedOutcome: 'VERIFIED',
  },
  {
    id: 'calib-pos-02',
    kind: 'POSITIVE_RECOMPRESSED',
    description: 'Meta CDN JPEG recompressed tart image (minor compression noise)',
    sourceBytes: baseTart,
    observedBytes: recompressedTart,
    expectedOutcome: 'VERIFIED',
  },
  {
    id: 'calib-pos-03',
    kind: 'POSITIVE_RESIZED',
    description: 'Meta 1080x1080 resampled rendition of tart image',
    sourceBytes: baseTart,
    observedBytes: resizedTart,
    expectedOutcome: 'VERIFIED',
  },
  {
    id: 'calib-border-01',
    kind: 'BORDERLINE_SUBTLE_EDIT',
    description: 'Tart image with aggressive localized filter / lighting change (gray band)',
    sourceBytes: baseTart,
    observedBytes: borderlineTart,
    expectedOutcome: 'MANUAL_REVIEW_REQUIRED',
  },
  {
    id: 'calib-neg-01',
    kind: 'HARD_NEGATIVE_DIFFERENT_PRODUCT',
    description: 'Pumpkin tart copy paired with fresh fig tart image',
    sourceBytes: baseTart,
    observedBytes: figTart,
    expectedOutcome: 'VISUAL_MISMATCH',
  },
  {
    id: 'calib-neg-02',
    kind: 'HARD_NEGATIVE_CROSS_DOMAIN',
    description: 'Bakery tart copy paired with beauty salon nail/hair image',
    sourceBytes: baseTart,
    observedBytes: beautySalon,
    expectedOutcome: 'VISUAL_MISMATCH',
  },
  {
    id: 'calib-neg-03',
    kind: 'HARD_NEGATIVE_INVERTED',
    description: 'Completely inverted high-contrast photo',
    sourceBytes: baseTart,
    observedBytes: invertedTart,
    expectedOutcome: 'VISUAL_MISMATCH',
  },
  {
    id: 'calib-neg-04',
    kind: 'HARD_NEGATIVE_CAROUSEL_REORDER',
    description: 'Scrambled or reordered carousel asset (vertical stripes)',
    sourceBytes: baseTart,
    observedBytes: verticalStripes,
    expectedOutcome: 'VISUAL_MISMATCH',
  },
]
