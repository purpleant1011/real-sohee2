import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  createOpenAIImageProvider,
  OpenAIImageProviderError,
} from './openai-image-provider'

const pngSignatureBase64 = 'iVBORw0KGgo='

function clientWith(base64: string | undefined) {
  const generate = vi.fn().mockResolvedValue({
    data: base64 === undefined ? [] : [{ b64_json: base64 }],
    _request_id: 'req_image_test',
    usage: {
      input_tokens: 50,
      input_tokens_details: { text_tokens: 50, image_tokens: 0 },
      output_tokens: 4160,
      total_tokens: 4210,
    },
  })
  return {
    client: { images: { generate } } as unknown as Pick<OpenAI, 'images'>,
    generate,
  }
}

describe('createOpenAIImageProvider', () => {
  it('requests a square PNG and returns verified bytes', async () => {
    const { client, generate } = clientWith(pngSignatureBase64)
    const provider = createOpenAIImageProvider(client, 'gpt-image-2')

    await expect(
      provider.generate({ prompt: '따뜻한 가을 캠페인 정사각 이미지' }),
    ).resolves.toEqual({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: 'image/png',
      requestId: 'req_image_test',
      usage: expect.objectContaining({
        providerRequestId: 'req_image_test',
        operation: 'image_generation',
        usage: expect.objectContaining({ imageOutputTokens: 4160 }),
      }),
    })
    expect(generate).toHaveBeenCalledWith({
      model: 'gpt-image-2',
      prompt: '따뜻한 가을 캠페인 정사각 이미지',
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
    })
  })

  it('requests the portrait source size used by the 4:5 Byreum harness', async () => {
    const { client, generate } = clientWith(pngSignatureBase64)
    const provider = createOpenAIImageProvider(client, 'gpt-image-2')

    await provider.generate({ prompt: '바이름 하네스 프롬프트', size: '1024x1536' })

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      size: '1024x1536',
    }))
  })

  it.each([
    ['empty image', undefined],
    ['invalid base64', 'not-base64!'],
    ['non-PNG bytes', 'aGVsbG8='],
  ])('normalizes %s without exposing provider details', async (_label, base64) => {
    const { client } = clientWith(base64)
    const provider = createOpenAIImageProvider(client, 'gpt-image-2')

    await expect(provider.generate({ prompt: '안전한 이미지' })).rejects.toEqual(
      new OpenAIImageProviderError('AI 이미지를 안전하게 처리하지 못했습니다.'),
    )
  })

  it('rejects a decoded image larger than 10 MB', async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const oversizedBase64 = Buffer.from(bytes).toString('base64')
    const decodeBase64 = vi.fn(() => bytes)
    const { client } = clientWith(oversizedBase64)
    const provider = createOpenAIImageProvider(client, 'gpt-image-2', { decodeBase64 })

    await expect(provider.generate({ prompt: '너무 큰 이미지' })).rejects.toBeInstanceOf(
      OpenAIImageProviderError,
    )
    expect(decodeBase64).not.toHaveBeenCalled()
  })

  it('decodes a bounded image through the guarded decoder boundary', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const decodeBase64 = vi.fn(() => bytes)
    const { client } = clientWith(pngSignatureBase64)
    const provider = createOpenAIImageProvider(client, 'gpt-image-2', { decodeBase64 })

    await expect(provider.generate({ prompt: '안전한 이미지' })).resolves.toMatchObject({ bytes })
    expect(decodeBase64).toHaveBeenCalledOnce()
    expect(decodeBase64).toHaveBeenCalledWith(pngSignatureBase64)
  })

  it.each([
    [{ status: 401, code: 'invalid_api_key', type: 'invalid_request_error' }, 'IMAGE_AUTH_REQUIRED'],
    [{ status: 429, code: 'insufficient_quota', type: 'insufficient_quota' }, 'IMAGE_QUOTA_EXHAUSTED'],
    [{ status: 429, code: 'rate_limit_exceeded', type: 'rate_limit_error' }, 'IMAGE_RATE_LIMITED'],
    [{ status: 403, code: 'model_not_found', type: 'invalid_request_error' }, 'IMAGE_MODEL_UNAVAILABLE'],
    [{ status: 400, code: 'content_policy_violation', type: 'invalid_request_error' }, 'IMAGE_POLICY_REJECTED'],
    [{ status: 400, code: 'invalid_value', type: 'invalid_request_error', param: 'prompt' }, 'IMAGE_PROMPT_INVALID'],
  ])('preserves a safe actionable code for provider failure %j', async (providerError, safeCode) => {
    const client = {
      images: { generate: vi.fn().mockRejectedValue(providerError) },
    } as unknown as Pick<OpenAI, 'images'>
    const provider = createOpenAIImageProvider(client, 'gpt-image-2')

    await expect(provider.generate({ prompt: '안전한 이미지' })).rejects.toMatchObject({
      name: 'OpenAIImageProviderError',
      code: safeCode,
    })
  })

  describe('with reference photos', () => {
    const refs = [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }, { bytes: new Uint8Array([4, 5]), mimeType: 'image/jpeg' }]

    it('uses the edit endpoint with every reference attached', async () => {
      const { client, generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn().mockResolvedValue({ data: [{ b64_json: pngSignatureBase64 }], _request_id: 'req_edit' })
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')

      const result = await provider.generate({ prompt: '카페 라떼', size: '1024x1536', references: refs })

      expect(result.requestId).toBe('req_edit')
      expect(generate).not.toHaveBeenCalled()
      const call = edit.mock.calls[0]?.[0] as { image: File[]; prompt: string; model: string; size: string }
      expect(call.image).toHaveLength(2)
      expect(call.image[1]?.type).toBe('image/jpeg')
      expect(call).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', prompt: '카페 라떼' })
      void client
    })

    it('rejects with IMAGE_REFERENCE_UNAVAILABLE and does not fall back to plain generate when edit fails', async () => {
      const { generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn().mockRejectedValue(new Error('edit unsupported'))
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')

      await expect(provider.generate({ prompt: 'x', references: refs })).rejects.toMatchObject({
        name: 'OpenAIImageProviderError',
        code: 'IMAGE_REFERENCE_UNAVAILABLE',
        message: 'AI 이미지를 안전하게 처리하지 못했습니다.',
      })
      expect(generate).not.toHaveBeenCalled()
    })

    it('preserves actionable provider error code when edit fails with known provider error', async () => {
      const { generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn().mockRejectedValue({ status: 401, code: 'invalid_api_key' })
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')

      await expect(provider.generate({ prompt: 'x', references: refs })).rejects.toMatchObject({
        name: 'OpenAIImageProviderError',
        code: 'IMAGE_AUTH_REQUIRED',
      })
      expect(generate).not.toHaveBeenCalled()
    })

    it('rejects immediately with IMAGE_REFERENCE_UNAVAILABLE when any reference photo has empty or zero-byte data', async () => {
      const { generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn()
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')
      const invalidRefs = [
        { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
        { bytes: new Uint8Array(0), mimeType: 'image/jpeg' },
      ]

      await expect(provider.generate({ prompt: 'x', references: invalidRefs })).rejects.toMatchObject({
        name: 'OpenAIImageProviderError',
        code: 'IMAGE_REFERENCE_UNAVAILABLE',
        message: 'AI 이미지를 안전하게 처리하지 못했습니다.',
      })
      expect(edit).not.toHaveBeenCalled()
      expect(generate).not.toHaveBeenCalled()
    })

    it('rejects with IMAGE_REFERENCE_UNAVAILABLE when OpenAI API rejects images with param "image"', async () => {
      const { generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn().mockRejectedValue({
        status: 400,
        code: 'invalid_image',
        type: 'invalid_request_error',
        param: 'image',
      })
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')

      await expect(provider.generate({ prompt: 'x', references: refs })).rejects.toMatchObject({
        name: 'OpenAIImageProviderError',
        code: 'IMAGE_REFERENCE_UNAVAILABLE',
      })
      expect(generate).not.toHaveBeenCalled()
    })

    it('never falls back to plain generate when edit throws unexpected 500 server error', async () => {
      const { generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn().mockRejectedValue({ status: 500, message: 'Internal Server Error' })
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')

      await expect(provider.generate({ prompt: 'x', references: refs })).rejects.toMatchObject({
        name: 'OpenAIImageProviderError',
        code: 'IMAGE_REFERENCE_UNAVAILABLE',
      })
      expect(generate).not.toHaveBeenCalled()
    })

    it('preserves exact count and order of reference files passed to client.images.edit', async () => {
      const { generate } = clientWith(pngSignatureBase64)
      const edit = vi.fn().mockResolvedValue({ data: [{ b64_json: pngSignatureBase64 }], _request_id: 'req_edit' })
      const provider = createOpenAIImageProvider({ images: { generate, edit } } as unknown as Pick<OpenAI, 'images'>, 'gpt-image-2')
      const threeRefs = [
        { bytes: new Uint8Array([1]), mimeType: 'image/png' },
        { bytes: new Uint8Array([2]), mimeType: 'image/jpeg' },
        { bytes: new Uint8Array([3]), mimeType: 'image/webp' },
      ]

      await provider.generate({ prompt: 'x', references: threeRefs })

      const call = edit.mock.calls[0]?.[0] as { image: File[] }
      expect(call.image).toHaveLength(3)
      expect(call.image[0]?.name).toBe('style-reference-1.png')
      expect(call.image[1]?.name).toBe('style-reference-2.jpg')
      expect(call.image[2]?.name).toBe('style-reference-3.webp')
    })
  })
})
