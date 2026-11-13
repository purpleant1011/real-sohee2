import { createHash } from 'node:crypto'

/**
 * ANI-1121: GPT-Image Binary Validator
 *
 * Strict binary header signature, MIME consistency, and dimension parsing
 * for PNG, JPEG, and WebP (Lossy VP8, Lossless VP8L, Extended VP8X).
 *
 * Enforces Zero False-Green:
 * - Pure byte parsing (no external native bindings required, Edge & Worker safe)
 * - Strict Fail-Closed on truncated, empty, mislabeled, or corrupted image payloads
 */

export class ImageBinaryValidationError extends Error {
  readonly code: string
  constructor(message: string, code = 'IMAGE_BINARY_VALIDATION_ERROR') {
    super(message)
    this.name = 'ImageBinaryValidationError'
    this.code = code
  }
}

export type SupportedMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
export type SupportedImageFormat = 'png' | 'jpeg' | 'webp'

export interface ValidatedImageBinary {
  mimeType: SupportedMimeType
  format: SupportedImageFormat
  width: number
  height: number
  byteLength: number
  sha256Digest: string
}

export interface ValidateImageBinaryOptions {
  expectedMime?: SupportedMimeType
  expectedDimensions?: {
    width: number
    height: number
  }
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOI = [0xff, 0xd8, 0xff]
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] // "WEBP"

/**
 * Parses and validates raw image binary bytes against strict standards.
 */
export function validateImageBinary(
  bytes: Uint8Array,
  options?: ValidateImageBinaryOptions
): ValidatedImageBinary {
  if (!bytes || bytes.byteLength === 0) {
    throw new ImageBinaryValidationError(
      'EMPTY_IMAGE_BYTES: Provided image binary payload is empty (0 bytes).',
      'EMPTY_IMAGE_BYTES'
    )
  }

  if (bytes.byteLength < 8) {
    throw new ImageBinaryValidationError(
      `TRUNCATED_IMAGE_HEADER: Image payload of ${bytes.byteLength} bytes is too short for any valid image header.`,
      'TRUNCATED_IMAGE_HEADER'
    )
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  let mimeType: SupportedMimeType
  let format: SupportedImageFormat
  let width: number
  let height: number

  // 1. Detect PNG
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b)
  if (isPng) {
    if (bytes.byteLength < 24) {
      throw new ImageBinaryValidationError(
        'TRUNCATED_PNG: PNG payload is too short for IHDR chunk.',
        'TRUNCATED_PNG'
      )
    }

    // Check IHDR signature at bytes 12..15
    const ihdrHeader = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (ihdrHeader !== 'IHDR') {
      throw new ImageBinaryValidationError(
        `INVALID_PNG_IHDR: Expected IHDR chunk header at offset 12, but found "${ihdrHeader}".`,
        'INVALID_PNG_IHDR'
      )
    }

    width = view.getUint32(16, false) // Big-endian
    height = view.getUint32(20, false) // Big-endian
    mimeType = 'image/png'
    format = 'png'
  }
  // 2. Detect JPEG
  else if (JPEG_SOI.every((b, i) => bytes[i] === b)) {
    const dims = parseJpegDimensions(bytes, view)
    // EXIF orientation 5~8 은 90도 회전을 포함한다. 브라우저는 EXIF 를 적용해 그린 뒤
    // naturalWidth/Height 를 회전된 값으로 알려주므로(CSS Images 3 `from-image`), 저장 치수도
    // 같은 기준이어야 화면이 세로 사진을 가로 틀에 넣지 않는다.
    const transposed = isTransposingOrientation(parseExifOrientation(bytes, view))
    width = transposed ? dims.height : dims.width
    height = transposed ? dims.width : dims.height
    mimeType = 'image/jpeg'
    format = 'jpeg'
  }
  // 3. Detect WebP (RIFF....WEBP)
  else if (
    bytes.byteLength >= 12 &&
    RIFF_MAGIC.every((b, i) => bytes[i] === b) &&
    WEBP_MAGIC.every((b, i) => bytes[i + 8] === b)
  ) {
    const dims = parseWebpDimensions(bytes, view)
    width = dims.width
    height = dims.height
    mimeType = 'image/webp'
    format = 'webp'
  } else {
    throw new ImageBinaryValidationError(
      'UNKNOWN_IMAGE_SIGNATURE: Bytes do not match PNG, JPEG, or WebP signatures.',
      'UNKNOWN_IMAGE_SIGNATURE'
    )
  }

  // Dimension sanity check
  if (!width || width <= 0 || !height || height <= 0) {
    throw new ImageBinaryValidationError(
      `INVALID_IMAGE_DIMENSIONS: Parsed invalid dimensions ${width}x${height}.`,
      'INVALID_IMAGE_DIMENSIONS'
    )
  }

  // Policy / Options Checks
  if (options?.expectedMime && options.expectedMime !== mimeType) {
    throw new ImageBinaryValidationError(
      `MIME_MISMATCH: Expected MIME type "${options.expectedMime}", but actual payload is "${mimeType}".`,
      'MIME_MISMATCH'
    )
  }

  if (options?.expectedDimensions) {
    const { width: expW, height: expH } = options.expectedDimensions
    if (width !== expW || height !== expH) {
      throw new ImageBinaryValidationError(
        `DIMENSIONS_MISMATCH: Expected ${expW}x${expH}, but actual payload dimensions are ${width}x${height}.`,
        'DIMENSIONS_MISMATCH'
      )
    }
  }

  const sha256Digest = createHash('sha256').update(bytes).digest('hex')

  return {
    mimeType,
    format,
    width,
    height,
    byteLength: bytes.byteLength,
    sha256Digest,
  }
}

/**
 * Scans JPEG markers to locate SOF0/SOF1/SOF2 and extract image dimensions.
 */
function parseJpegDimensions(bytes: Uint8Array, view: DataView): { width: number; height: number } {
  let offset = 2 // Skip SOI (0xFF, 0xD8)

  while (offset < bytes.byteLength - 1) {
    // Find next 0xFF marker prefix
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }

    const marker = bytes[offset + 1]

    // Skip padding 0xFF bytes or standalone markers (0x00, 0xD8, 0xD9, 0x01, 0xD0..0xD7)
    if (marker === 0x00 || marker === 0xff || marker === 0xd8) {
      offset += 2
      continue
    }

    // Stop at Start of Scan (0xDA) or End of Image (0xD9)
    if (marker === 0xda || marker === 0xd9) {
      break
    }

    const chunkLength = view.getUint16(offset + 2, false)
    if (chunkLength < 2 || offset + 2 + chunkLength > bytes.byteLength) {
      break
    }

    // SOF0 (0xC0 Baseline), SOF1 (0xC1 Extended Sequential), SOF2 (0xC2 Progressive)
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // Structure: [0xFF, marker, length(2), precision(1), height(2), width(2), ...]
      if (chunkLength >= 7 && offset + 9 <= bytes.byteLength) {
        const height = view.getUint16(offset + 5, false)
        const width = view.getUint16(offset + 7, false)
        return { width, height }
      }
    }

    offset += 2 + chunkLength
  }

  throw new ImageBinaryValidationError(
    'INVALID_JPEG_SOF: Unable to locate Start of Frame (SOF) marker in JPEG binary.',
    'INVALID_JPEG_SOF'
  )
}

/** EXIF orientation 5~8 은 90도 회전으로 가로·세로가 뒤바뀐다(2~4 는 뒤집기/180도). */
function isTransposingOrientation(orientation: number | null): boolean {
  return orientation !== null && orientation >= 5 && orientation <= 8
}

/**
 * APP1 EXIF 의 IFD0 Orientation(0x0112) 을 읽는다. 없거나 깨졌으면 null.
 * 방향은 표시 힌트일 뿐이므로 읽기 실패가 이미지 검증을 막지 않는다(회전 없는 치수와 같게 둔다).
 */
function parseExifOrientation(bytes: Uint8Array, view: DataView): number | null {
  let offset = 2 // Skip SOI (0xFF, 0xD8)
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    // SOS/EOI 전에 APP1 이 없으면 방향 정보가 없다.
    if (marker === 0xda || marker === 0xd9 || marker === 0x00 || marker === 0xff) return null
    const segmentLength = view.getUint16(offset + 2, false)
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.byteLength) return null
    if (marker === 0xe1) {
      const orientation = readTiffOrientation(bytes, view, offset + 4, offset + 2 + segmentLength)
      if (orientation !== null) return orientation
    }
    offset += 2 + segmentLength
  }
  return null
}

/** APP1 페이로드('Exif\0\0' + TIFF)에서 IFD0 Orientation SHORT 값을 읽는다. */
function readTiffOrientation(bytes: Uint8Array, view: DataView, start: number, end: number): number | null {
  if (start + 6 > end) return null
  if (bytes[start] !== 0x45 || bytes[start + 1] !== 0x78 || bytes[start + 2] !== 0x69 || bytes[start + 3] !== 0x66) {
    return null
  }
  const tiff = start + 6
  if (tiff + 8 > end) return null
  const littleEndian = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
  const bigEndian = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d
  if (!littleEndian && !bigEndian) return null
  if (view.getUint16(tiff + 2, littleEndian) !== 0x002a) return null

  const ifd = tiff + view.getUint32(tiff + 4, littleEndian)
  if (ifd + 2 > end) return null
  const entryCount = view.getUint16(ifd, littleEndian)
  for (let index = 0; index < entryCount; index++) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) return null
    if (view.getUint16(entry, littleEndian) !== 0x0112) continue
    // SHORT(3) 하나짜리 태그만 방향이다. 다른 형식은 해석하지 않는다.
    if (view.getUint16(entry + 2, littleEndian) !== 3) return null
    const value = view.getUint16(entry + 8, littleEndian)
    return value >= 1 && value <= 8 ? value : null
  }
  return null
}

/**
 * Parses WebP VP8, VP8L, or VP8X chunks to extract canvas dimensions.
 */
function parseWebpDimensions(bytes: Uint8Array, view: DataView): { width: number; height: number } {
  if (bytes.byteLength < 16) {
    throw new ImageBinaryValidationError(
      'TRUNCATED_WEBP: WebP payload is too short for chunk inspection.',
      'TRUNCATED_WEBP'
    )
  }

  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])

  // 1. VP8X (Extended WebP)
  if (chunkType === 'VP8X') {
    if (bytes.byteLength < 30) {
      throw new ImageBinaryValidationError(
        'TRUNCATED_WEBP_VP8X: WebP VP8X chunk payload is truncated.',
        'TRUNCATED_WEBP_VP8X'
      )
    }
    // Canvas Width - 1 is a 24-bit integer at offset 24..26 (little-endian)
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    // Canvas Height - 1 is a 24-bit integer at offset 27..29 (little-endian)
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return { width, height }
  }

  // 2. VP8L (Lossless WebP)
  if (chunkType === 'VP8L') {
    if (bytes.byteLength < 25) {
      throw new ImageBinaryValidationError(
        'TRUNCATED_WEBP_VP8L: WebP VP8L chunk payload is truncated.',
        'TRUNCATED_WEBP_VP8L'
      )
    }

    const signature = bytes[20]
    if (signature !== 0x2f) {
      throw new ImageBinaryValidationError(
        `INVALID_WEBP_VP8L: Expected VP8L signature 0x2F at offset 20, found 0x${signature.toString(16)}.`,
        'INVALID_WEBP_VP8L'
      )
    }

    // 4-byte packed field at offset 21..24 (little-endian)
    const b0 = bytes[21]
    const b1 = bytes[22]
    const b2 = bytes[23]
    const b3 = bytes[24]
    const bits = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0

    // Width: bits 0..13 (14 bits) + 1
    const width = (bits & 0x3fff) + 1
    // Height: bits 14..27 (14 bits) + 1
    const height = ((bits >>> 14) & 0x3fff) + 1

    return { width, height }
  }

  // 3. VP8 (Lossy WebP)
  if (chunkType === 'VP8 ') {
    if (bytes.byteLength < 30) {
      throw new ImageBinaryValidationError(
        'TRUNCATED_WEBP_VP8: WebP VP8 chunk payload is truncated.',
        'TRUNCATED_WEBP_VP8'
      )
    }

    // Frame tag is 3 bytes at offset 20..22.
    // Keyframe signature at bytes 23..25: 0x9D, 0x01, 0x2A
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new ImageBinaryValidationError(
        'INVALID_WEBP_VP8: WebP VP8 chunk missing valid keyframe signature (0x9D, 0x01, 0x2A).',
        'INVALID_WEBP_VP8'
      )
    }

    // 16-bit little endian width (14-bit value)
    const width = ((bytes[26] | (bytes[27] << 8)) & 0x3fff)
    // 16-bit little endian height (14-bit value)
    const height = ((bytes[28] | (bytes[29] << 8)) & 0x3fff)

    return { width, height }
  }

  throw new ImageBinaryValidationError(
    `UNKNOWN_WEBP_CHUNK: Unrecognized WebP chunk type "${chunkType}".`,
    'UNKNOWN_WEBP_CHUNK'
  )
}
