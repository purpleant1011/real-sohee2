// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { convertHeicPhoto, inspectHeic, isHeicPhoto } from './heic-conversion'

function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((sum, part) => sum + part.length, 0)
  const bytes = new Uint8Array(size)
  new DataView(bytes.buffer).setUint32(0, size)
  bytes.set(new TextEncoder().encode(type), 4)
  let offset = 8
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
function heic(width = 1200, height = 800) {
  const dimensions = new Uint8Array(12)
  const view = new DataView(dimensions.buffer)
  view.setUint32(4, width); view.setUint32(8, height)
  const bytes = box('meta', new Uint8Array(4), box('iprp', box('ipco', box('ispe', dimensions))))
  return new File([box('ftyp', new TextEncoder().encode('heic\0\0\0\0heic')), bytes], 'photo.HEIC', { type: 'image/heic' })
}
function workerPort() {
  return { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as ((event: MessageEvent) => void) | null, onerror: null as (() => void) | null }
}
const jpeg = new Blob([new Uint8Array([255, 216, 255, 224, 0, 0])], { type: 'image/jpeg' })
afterEach(() => vi.useRealTimers())

describe('local HEIC preparation', () => {
  it('accepts the synthetic portrait HEIC encoded by macOS sips', async () => {
    const bytes = await readFile('tests/fixtures/firstpost-web/synthetic-photo.heic')
    expect(inspectHeic(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toEqual({ maxPixels: 307200 })
  })
  it('recognizes empty-MIME iPhone filenames without treating JPEG as HEIC', () => {
    expect(isHeicPhoto(new File([], 'IMG.HEIC'))).toBe(true)
    expect(isHeicPhoto(new File([], 'photo.jpg', { type: 'image/jpeg' }))).toBe(false)
  })
  it('reads dimensions inside the real HEIF property hierarchy', async () => {
    expect(inspectHeic(await heic().arrayBuffer())).toEqual({ maxPixels: 960000 })
  })
  it('rejects oversized dimensions before a decoder is created', async () => {
    const create = vi.fn()
    await expect(convertHeicPhoto(heic(12000, 12000), { createWorker: create })).rejects.toThrow('HEIC_DIMENSIONS_UNSUPPORTED')
    expect(create).not.toHaveBeenCalled()
  })
  it('rejects forged brands and missing dimensions rather than trusting the extension', async () => {
    expect(() => inspectHeic(new TextEncoder().encode('not a heic file').buffer)).toThrow('HEIC_INVALID')
    const empty = box('ftyp', new TextEncoder().encode('heic\0\0\0\0heic'))
    expect(() => inspectHeic(empty.buffer)).toThrow('HEIC_INVALID')
  })
  it('rejects truncated boxes and sequence brands', async () => {
    const bytes = new Uint8Array(await heic().arrayBuffer())
    new DataView(bytes.buffer).setUint32(0, bytes.length + 1)
    expect(() => inspectHeic(bytes.buffer)).toThrow('HEIC_INVALID')
    bytes.set(new TextEncoder().encode('hevc'), 8)
    new DataView(bytes.buffer).setUint32(0, 20)
    expect(() => inspectHeic(bytes.buffer)).toThrow('HEIC_INVALID')
  })
  it('returns a JPEG file only after local conversion and terminates the decoder', async () => {
    const worker = workerPort()
    worker.postMessage.mockImplementation(() => queueMicrotask(() => worker.onmessage?.({ data: { jpeg } } as MessageEvent)))
    const file = await convertHeicPhoto(heic(), { createWorker: () => worker })
    expect(file.name).toBe('photo.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([255, 216, 255, 224, 0, 0])
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('aborts before decoding without creating a worker', async () => {
    const abort = new AbortController(); abort.abort()
    const create = vi.fn()
    await expect(convertHeicPhoto(heic(), { signal: abort.signal, createWorker: create })).rejects.toMatchObject({ name: 'AbortError' })
    expect(create).not.toHaveBeenCalled()
  })
  it('terminates on cancellation and ignores late results', async () => {
    const worker = workerPort(), abort = new AbortController()
    worker.postMessage.mockImplementation(() => abort.abort())
    await expect(convertHeicPhoto(heic(), { signal: abort.signal, createWorker: () => worker })).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.onmessage).toBeNull()
  })
  it('terminates a hung decoder after the deadline', async () => {
    vi.useFakeTimers()
    const worker = workerPort()
    const pending = convertHeicPhoto(heic(), { createWorker: () => worker })
    const rejected = expect(pending).rejects.toThrow('HEIC_TIMEOUT')
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('rejects invalid output instead of uploading disguised bytes', async () => {
    const worker = workerPort()
    worker.postMessage.mockImplementation(() => queueMicrotask(() => worker.onmessage?.({ data: { jpeg: new Blob(['not jpeg'], { type: 'image/jpeg' }) } } as MessageEvent)))
    await expect(convertHeicPhoto(heic(), { createWorker: () => worker })).rejects.toThrow('HEIC_OUTPUT_INVALID')
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
