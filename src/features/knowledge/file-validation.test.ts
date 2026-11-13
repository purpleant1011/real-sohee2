import { File as NodeFile } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_MEDIA_MAX_BYTES,
  KNOWLEDGE_MAX_BYTES,
  validateContentMedia,
  validateKnowledgeFile,
} from './file-validation'

type FileReaderOptions = {
  name?: string
  size?: number
  failFileRead?: boolean
  failBlobRead?: boolean
}

function createFile(
  bytes: number[],
  type: string,
  options: FileReaderOptions = {},
): File {
  const data = new Uint8Array(bytes)
  const file = {
    name: options.name ?? 'untrusted-upload',
    type,
    size: options.size ?? data.byteLength,
    arrayBuffer: async () => {
      if (options.failFileRead) throw new Error('read failed')
      return data.slice().buffer
    },
    slice: (start = 0, end = data.byteLength) => ({
      arrayBuffer: async () => {
        if (options.failBlobRead) throw new Error('read failed')
        return data.slice(start, end).buffer
      },
    }),
  }

  return file as unknown as File
}

function utf8Bytes(text: string): number[] {
  return [...new TextEncoder().encode(text)]
}

function createNativeFile(bytes: Uint8Array, type: string): File {
  const backingBytes = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(backingBytes).set(bytes)
  return new NodeFile([backingBytes], 'native-upload', { type }) as unknown as File
}

function createNativeFileAtSize(size: number, prefix: number[], type: string): File {
  const backingBytes = new ArrayBuffer(size)
  new Uint8Array(backingBytes).set(prefix)
  return new NodeFile([backingBytes], 'native-upload', { type }) as unknown as File
}

function replaceMetadataGetter(
  file: File,
  key: 'size' | 'type',
  getter: () => unknown,
): File {
  Object.defineProperty(file, key, { configurable: true, get: getter })
  return file
}

const jpeg = [0xff, 0xd8, 0xff, 0x00]
const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d]
const webp = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]

describe('validateKnowledgeFile', () => {
  it.each([
    ['PDF', createFile(pdf, 'application/pdf'), 'pdf'],
    ['UTF-8 TXT', createFile(utf8Bytes('안녕하세요'), 'text/plain'), 'text'],
    ['UTF-8 BOM TXT', createFile([0xef, 0xbb, 0xbf, ...utf8Bytes('내용')], 'text/plain'), 'text'],
    ['JPEG', createFile(jpeg, 'image/jpeg'), 'jpeg'],
    ['PNG', createFile(png, 'image/png'), 'png'],
  ] as const)('accepts a valid %s knowledge file', async (_label, file, kind) => {
    await expect(validateKnowledgeFile(file)).resolves.toEqual({ ok: true, kind })
  })

  it.each([
    ['WebP', createFile(webp, 'image/webp')],
    ['executable', createFile([0x4d, 0x5a], 'application/octet-stream')],
    ['SVG', createFile(utf8Bytes('<svg/>'), 'image/svg+xml')],
    ['HTML', createFile(utf8Bytes('<html/>'), 'text/html')],
    ['unknown MIME', createFile(pdf, 'application/x-unknown')],
  ])('rejects an unsupported %s knowledge file before trusting bytes', async (_label, file) => {
    await expect(validateKnowledgeFile(file)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_TYPE_INVALID' },
    })
  })

  it('rejects a declared PDF whose bytes are a PNG', async () => {
    await expect(validateKnowledgeFile(createFile(png, 'application/pdf'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_SIGNATURE_INVALID' },
    })
  })

  it.each([
    ['PDF', createFile([0x25, 0x50, 0x44], 'application/pdf')],
    ['JPEG', createFile([0xff, 0xd8], 'image/jpeg')],
    ['PNG', createFile([0x89, 0x50, 0x4e, 0x47], 'image/png')],
  ])('rejects a truncated %s header', async (_label, file) => {
    await expect(validateKnowledgeFile(file)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_SIGNATURE_INVALID' },
    })
  })

  it('rejects invalid UTF-8 text', async () => {
    await expect(validateKnowledgeFile(createFile([0xc3, 0x28], 'text/plain'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_TEXT_ENCODING_INVALID' },
    })
  })

  it('does not trust a replaced global TextDecoder', async () => {
    const OriginalTextDecoder = globalThis.TextDecoder
    const file = createFile([0xc3, 0x28], 'text/plain')
    try {
      globalThis.TextDecoder = class ForgedTextDecoder {
        decode() {
          return 'forged safe text'
        }
      } as unknown as typeof TextDecoder

      await expect(validateKnowledgeFile(file)).resolves.toMatchObject({
        ok: false,
        error: { code: 'UPLOAD_TEXT_ENCODING_INVALID' },
      })
    } finally {
      globalThis.TextDecoder = OriginalTextDecoder
    }
  })

  it('rejects an empty file before reading it', async () => {
    await expect(
      validateKnowledgeFile(createFile([], 'application/pdf', { failFileRead: true })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_EMPTY' } })
  })

  it('accepts exactly 8 MiB and rejects one byte over for knowledge files', async () => {
    await expect(
      validateKnowledgeFile(createFile(pdf, 'application/pdf', { size: KNOWLEDGE_MAX_BYTES })),
    ).resolves.toEqual({ ok: true, kind: 'pdf' })
    await expect(
      validateKnowledgeFile(createFile(pdf, 'application/pdf', { size: KNOWLEDGE_MAX_BYTES + 1 })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_TOO_LARGE' } })
  })

  it('maps File.arrayBuffer failures to a safe upload error', async () => {
    await expect(
      validateKnowledgeFile(createFile(utf8Bytes('text'), 'text/plain', { failFileRead: true })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_READ_FAILED' } })
  })

  it('maps sliced Blob.arrayBuffer failures to a safe upload error', async () => {
    await expect(
      validateKnowledgeFile(createFile(pdf, 'application/pdf', { failBlobRead: true })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_READ_FAILED' } })
  })

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['negative', -1],
    ['fractional', 0.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a %s file size as unreadable metadata', async (_label, size) => {
    const file = replaceMetadataGetter(createFile(pdf, 'application/pdf'), 'size', () => size)

    await expect(validateKnowledgeFile(file)).resolves.toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_READ_FAILED',
        message: '파일을 읽을 수 없습니다. 다시 시도해 주세요.',
      },
    })
  })

  it('maps a throwing size getter to a stable Korean error', async () => {
    const file = replaceMetadataGetter(createFile(pdf, 'application/pdf'), 'size', () => {
      throw new Error('size metadata must not leak')
    })

    await expect(validateKnowledgeFile(file)).resolves.toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_READ_FAILED',
        message: '파일을 읽을 수 없습니다. 다시 시도해 주세요.',
      },
    })
  })

  it('maps a throwing type getter to a stable Korean error', async () => {
    const file = replaceMetadataGetter(createFile(pdf, 'application/pdf'), 'type', () => {
      throw new Error('type metadata must not leak')
    })

    await expect(validateKnowledgeFile(file)).resolves.toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_READ_FAILED',
        message: '파일을 읽을 수 없습니다. 다시 시도해 주세요.',
      },
    })
  })

  it('maps malformed type metadata to a stable Korean error', async () => {
    const file = replaceMetadataGetter(createFile(pdf, 'application/pdf'), 'type', () => null)

    await expect(validateKnowledgeFile(file)).resolves.toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_READ_FAILED',
        message: '파일을 읽을 수 없습니다. 다시 시도해 주세요.',
      },
    })
  })

  it.each([
    ['text reader', 'text/plain', 'arrayBuffer'],
    ['binary slicer', 'application/pdf', 'slice'],
  ])('maps a missing %s method to a stable Korean error', async (_label, type, method) => {
    const file = createFile(pdf, type) as unknown as Record<string, unknown>
    delete file[method]

    await expect(validateKnowledgeFile(file as unknown as File)).resolves.toEqual({
      ok: false,
      error: {
        code: 'UPLOAD_READ_FAILED',
        message: '파일을 읽을 수 없습니다. 다시 시도해 주세요.',
      },
    })
  })

  it('accepts a real Node File with a UTF-8 text payload', async () => {
    await expect(
      validateKnowledgeFile(createNativeFile(new TextEncoder().encode('실제 텍스트'), 'text/plain')),
    ).resolves.toEqual({ ok: true, kind: 'text' })
  })

  it('accepts a real Node File at the exact 8 MiB knowledge limit', async () => {
    await expect(
      validateKnowledgeFile(createNativeFileAtSize(KNOWLEDGE_MAX_BYTES, pdf, 'application/pdf')),
    ).resolves.toEqual({ ok: true, kind: 'pdf' })
  })

  it('rejects a real Node File one byte over the 8 MiB knowledge limit', async () => {
    await expect(
      validateKnowledgeFile(createNativeFileAtSize(KNOWLEDGE_MAX_BYTES + 1, pdf, 'application/pdf')),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_TOO_LARGE' } })
  })
})

describe('validateContentMedia', () => {
  it('does not trust a poisoned Array iterator helper when checking signatures', async () => {
    const originalEvery = Array.prototype.every
    try {
      Array.prototype.every = (() => true) as unknown as typeof Array.prototype.every
      expect([false].every(Boolean)).toBe(true)
      await expect(
        validateContentMedia(createFile([0x25, 0x50, 0x44, 0x46], 'image/png')),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'UPLOAD_SIGNATURE_INVALID' },
      })
    } finally {
      Array.prototype.every = originalEvery
    }
  })

  it('does not trust a replaced global Uint8Array constructor', async () => {
    const OriginalUint8Array = globalThis.Uint8Array
    const file = createFile([0x25, 0x50, 0x44, 0x46], 'image/png')
    try {
      globalThis.Uint8Array = function ForgedUint8Array() {
        return new OriginalUint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ])
      } as unknown as Uint8ArrayConstructor

      await expect(validateContentMedia(file)).resolves.toMatchObject({
        ok: false,
        error: { code: 'UPLOAD_SIGNATURE_INVALID' },
      })
    } finally {
      globalThis.Uint8Array = OriginalUint8Array
    }
  })

  it.each([
    ['JPEG', createFile(jpeg, 'image/jpeg'), 'jpeg'],
    ['PNG', createFile(png, 'image/png'), 'png'],
    ['WebP', createFile(webp, 'image/webp'), 'webp'],
  ] as const)('accepts a valid %s media file', async (_label, file, kind) => {
    await expect(validateContentMedia(file)).resolves.toEqual({ ok: true, kind })
  })

  it.each([
    ['PDF', createFile(pdf, 'application/pdf')],
    ['TXT', createFile(utf8Bytes('text'), 'text/plain')],
    ['SVG', createFile(utf8Bytes('<svg/>'), 'image/svg+xml')],
    ['HTML', createFile(utf8Bytes('<html/>'), 'text/html')],
    ['unknown MIME', createFile(jpeg, 'application/x-unknown')],
  ])('rejects a non-media %s file', async (_label, file) => {
    await expect(validateContentMedia(file)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_TYPE_INVALID' },
    })
  })

  it('rejects a declared WebP whose RIFF or WEBP signature is incomplete', async () => {
    await expect(validateContentMedia(createFile(webp.slice(0, 11), 'image/webp'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_SIGNATURE_INVALID' },
    })
  })

  it.each([
    ['RIFF marker', 0],
    ['WEBP marker', 8],
  ])('rejects a WebP with a corrupted %s byte', async (_label, byteIndex) => {
    const corrupted = [...webp]
    corrupted[byteIndex] = 0x00

    await expect(validateContentMedia(createFile(corrupted, 'image/webp'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_SIGNATURE_INVALID' },
    })
  })

  it('rejects a declared PNG whose bytes are JPEG', async () => {
    await expect(validateContentMedia(createFile(jpeg, 'image/png'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPLOAD_SIGNATURE_INVALID' },
    })
  })

  it('accepts exactly 10 MiB and rejects one byte over for content media', async () => {
    await expect(
      validateContentMedia(createFile(jpeg, 'image/jpeg', { size: CONTENT_MEDIA_MAX_BYTES })),
    ).resolves.toEqual({ ok: true, kind: 'jpeg' })
    await expect(
      validateContentMedia(createFile(jpeg, 'image/jpeg', { size: CONTENT_MEDIA_MAX_BYTES + 1 })),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_TOO_LARGE' } })
  })

  it('reads a real Node File through the binary slice path', async () => {
    await expect(
      validateContentMedia(createNativeFile(new Uint8Array(png), 'image/png')),
    ).resolves.toEqual({ ok: true, kind: 'png' })
  })

  it('accepts a real Node File at the exact 10 MiB content media limit', async () => {
    await expect(
      validateContentMedia(createNativeFileAtSize(CONTENT_MEDIA_MAX_BYTES, jpeg, 'image/jpeg')),
    ).resolves.toEqual({ ok: true, kind: 'jpeg' })
  })

  it('rejects a real Node File one byte over the 10 MiB content media limit', async () => {
    await expect(
      validateContentMedia(createNativeFileAtSize(CONTENT_MEDIA_MAX_BYTES + 1, jpeg, 'image/jpeg')),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UPLOAD_TOO_LARGE' } })
  })
})

describe('file read limits', () => {
  it('reads only a short binary prefix and does not use File.arrayBuffer', async () => {
    const data = new Uint8Array([...png, ...new Array(64).fill(0)])
    const sliceEnds: number[] = []
    const file = {
      name: 'untrusted-upload',
      type: 'image/png',
      size: data.byteLength,
      arrayBuffer: async () => {
        throw new Error('full read must not happen for a binary file')
      },
      slice: (start = 0, end = data.byteLength) => {
        sliceEnds.push(end)
        return { arrayBuffer: async () => data.slice(start, end).buffer }
      },
    } as unknown as File

    await expect(validateContentMedia(file)).resolves.toEqual({ ok: true, kind: 'png' })
    expect(sliceEnds).toEqual([12])
  })
})
