const MAX_BYTES = 10 * 1024 * 1024
export const HEIC_MAX_PIXELS = 24_000_000
const MAX_EDGE = 8192

type DecoderWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>

export function isHeicPhoto(file: File): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

// Conservative preflight, not a substitute for the decoder or server byte validation.
// Reject sequences and dimensions we cannot inspect rather than guessing a safe size.
export function inspectHeic(buffer: ArrayBuffer): { maxPixels: number } {
  const view = new DataView(buffer)
  const text = (start: number) => String.fromCharCode(...new Uint8Array(buffer, start, 4))
  let brand = false, maxPixels = 0, boxes = 0
  function walk(start: number, end: number, path: string) {
    for (let offset = start; offset < end;) {
      if (++boxes > 4096 || end - offset < 8) throw new Error('HEIC_INVALID')
      let size = view.getUint32(offset), headerSize = 8
      if (size === 1) {
        if (end - offset < 16) throw new Error('HEIC_INVALID')
        const extended = view.getBigUint64(offset + 8)
        if (extended > BigInt(end - offset)) throw new Error('HEIC_INVALID')
        size = Number(extended)
        headerSize = 16
      } else if (size === 0) size = end - offset
      if (size < headerSize || size > end - offset) throw new Error('HEIC_INVALID')
      const type = text(offset + 4), body = offset + headerSize, next = offset + size
      if (path === '' && type === 'ftyp') {
        if (size < 16 || !['heic', 'heix', 'mif1'].includes(text(body))) throw new Error('HEIC_INVALID')
        brand = true
      } else if (path === '' && type === 'meta') {
        if (size < 12) throw new Error('HEIC_INVALID')
        walk(body + 4, next, 'meta')
      } else if ((path === 'meta' && type === 'iprp') || (path === 'iprp' && type === 'ipco')) {
        walk(body, next, type)
      } else if (path === 'ipco' && type === 'ispe') {
        if (size !== 20 || view.getUint32(body) !== 0) throw new Error('HEIC_INVALID')
        const width = view.getUint32(body + 4), height = view.getUint32(body + 8)
        if (!width || !height || width > MAX_EDGE || height > MAX_EDGE || width * height > HEIC_MAX_PIXELS) throw new Error('HEIC_DIMENSIONS_UNSUPPORTED')
        maxPixels = Math.max(maxPixels, width * height)
      }
      offset = next
    }
  }
  walk(0, buffer.byteLength, '')
  if (!brand || !maxPixels) throw new Error('HEIC_INVALID')
  return { maxPixels }
}

export async function convertHeicPhoto(file: File, options: { signal?: AbortSignal; createWorker?: () => DecoderWorker } = {}): Promise<File> {
  const { signal } = options
  const aborted = () => new DOMException('Photo conversion cancelled', 'AbortError')
  if (signal?.aborted) throw aborted()
  if (!file.size || file.size > MAX_BYTES) throw new Error('HEIC_SIZE_UNSUPPORTED')
  const buffer = await file.arrayBuffer()
  inspectHeic(buffer)
  if (signal?.aborted) throw aborted()
  const worker = options.createWorker?.() ?? new Worker(new URL('./heic-conversion.worker.ts', import.meta.url), { type: 'module' })
  const jpeg = await new Promise<Blob>((resolve, reject) => {
    let settled = false
    function finish(error?: Error, result?: Blob) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      worker.onmessage = null
      worker.onerror = null
      // A dedicated worker owns the decoder and its child worker. No shared decoder
      // survives a cancelled request; terminate also stops its owned child workers.
      worker.terminate()
      if (error) reject(error)
      else resolve(result!)
    }
    const cancel = () => finish(aborted())
    const timer = setTimeout(() => finish(new Error('HEIC_TIMEOUT')), 30000)
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onerror = () => finish(new Error('HEIC_CONVERSION_FAILED'))
    worker.onmessage = event => {
      const result = event.data?.jpeg
      if (!(result instanceof Blob) || result.type !== 'image/jpeg' || !result.size || result.size > MAX_BYTES) finish(new Error('HEIC_OUTPUT_INVALID'))
      else finish(undefined, result)
    }
    try { worker.postMessage({ buffer }, [buffer]) }
    catch { finish(new Error('HEIC_CONVERSION_FAILED')) }
  })
  if (signal?.aborted) throw aborted()
  const magic = new Uint8Array(await jpeg.slice(0, 3).arrayBuffer())
  if (magic[0] !== 255 || magic[1] !== 216 || magic[2] !== 255) throw new Error('HEIC_OUTPUT_INVALID')
  if (signal?.aborted) throw aborted()
  return new File([jpeg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified })
}
