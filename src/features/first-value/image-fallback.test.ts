import { describe, expect, it } from 'vitest'
import { continueWithTextIfImageFails, FIRST_VALUE_IMAGE_NOTICE } from './image-fallback'

describe('first-value image degradation', () => {
  it('continues with text after a rejected image promise without returning an image id', async () => {
    const result = await continueWithTextIfImageFails(Promise.resolve({ threads: { content: '우리 카페 첫 인사' } }), Promise.reject(new Error('provider unavailable')))
    expect(result).toEqual({ copies: { threads: { content: '우리 카페 첫 인사' } }, image: null, imageNotice: FIRST_VALUE_IMAGE_NOTICE })
    expect(result.imageNotice).toContain('글만 먼저')
  })
  it('never masks a rejected text promise', async () => {
    await expect(continueWithTextIfImageFails(Promise.reject(new Error('text failed')), Promise.resolve({ assetId: 'ok' }))).rejects.toThrow('text failed')
  })
})
