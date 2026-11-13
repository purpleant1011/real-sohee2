import { heicTo } from 'heic-to/csp'

const HEIC_MAX_PIXELS = 24_000_000

self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  let bitmap: ImageBitmap | undefined
  let canvas: OffscreenCanvas | undefined
  try {
    bitmap = await heicTo({ blob: new Blob([event.data.buffer]), type: 'bitmap' })
    if (!bitmap.width || !bitmap.height || bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > HEIC_MAX_PIXELS) throw new Error('HEIC_DIMENSIONS_UNSUPPORTED')
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('HEIC_CONVERSION_FAILED')
    context.drawImage(bitmap, 0, 0)
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    self.postMessage({ jpeg })
  } catch {
    self.postMessage({ error: 'HEIC_CONVERSION_FAILED' })
  } finally {
    bitmap?.close()
    if (canvas) { canvas.width = 1; canvas.height = 1 }
  }
}
