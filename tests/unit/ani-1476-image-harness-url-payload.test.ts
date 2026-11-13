import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultOpenAIImageClient } from '@/features/creative/openai-image-client'

// Minimal 1x1 valid PNG binary
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64')

describe('ANI-1476 / R4-11: Image Harness OpenAI Payload Resolution (url vs b64_json)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('successfully resolves image from url when OpenAI returns url instead of b64_json', async () => {
    const mockImagesGenerate = vi.fn().mockResolvedValue({
      data: [{ url: 'https://oaidalleapiprodscus.blob.core.windows.net/test-image.png' }],
      _request_id: 'req_test_url_01',
    })

    const client = new DefaultOpenAIImageClient(
      {
        images: {
          generate: mockImagesGenerate,
        },
      } as any,
      'gpt-image-2.5-flare'
    )

    // Mock global fetch to return PNG buffer when downloading from OpenAI url
    const originalFetch = global.fetch
    const isolatedPngArrayBuffer = TINY_PNG_BUFFER.buffer.slice(
      TINY_PNG_BUFFER.byteOffset,
      TINY_PNG_BUFFER.byteOffset + TINY_PNG_BUFFER.byteLength
    )
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('test-image.png')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(isolatedPngArrayBuffer),
        })
      }
      return originalFetch(url)
    })

    try {
      const output = await client.generateImage({
        prompt: '아늑한 미용실 내부 인테리어',
        model: 'gpt-image-2.5-flare',
        stylePreset: 'flare',
      })

      expect(output).not.toBeNull()
      expect(output.bytes.length).toBeGreaterThan(0)
      expect(output.mimeType).toBe('image/png')
      expect(output.sha256Digest).toBeTruthy()
      expect(output.providerRequestId).toBe('req_test_url_01')
    } finally {
      global.fetch = originalFetch
    }
  })
})
