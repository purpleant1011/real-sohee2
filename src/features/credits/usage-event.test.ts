import { describe, expect, it } from 'vitest'
import { mapImageUsage, mapTextResponseUsage } from './usage-event'

describe('provider usage mapping', () => {
  it('maps Responses usage without retaining the raw response', () => {
    expect(mapTextResponseUsage('resp_123', 'gpt-5.6-luna', {
      input_tokens: 1200,
      input_tokens_details: { cached_tokens: 200 },
      output_tokens: 400,
      output_tokens_details: { reasoning_tokens: 120 },
      total_tokens: 1600,
    })).toEqual({
      provider: 'openai',
      providerRequestId: 'resp_123',
      model: 'gpt-5.6-luna',
      operation: 'text_response',
      usage: {
        textInputTokens: 1200,
        cachedTextInputTokens: 200,
        textOutputTokens: 400,
        imageInputTokens: 0,
        imageOutputTokens: 0,
        providerTotalTokens: 1600,
      },
      usageSource: 'actual',
    })
  })

  it('separates image text, image input, and image output tokens', () => {
    expect(mapImageUsage('img_req_123', 'gpt-image-2', {
      input_tokens: 90,
      input_tokens_details: { text_tokens: 50, image_tokens: 40 },
      output_tokens: 4160,
      total_tokens: 4250,
    })).toEqual({
      provider: 'openai',
      providerRequestId: 'img_req_123',
      model: 'gpt-image-2',
      operation: 'image_generation',
      usage: {
        textInputTokens: 50,
        cachedTextInputTokens: 0,
        textOutputTokens: 0,
        imageInputTokens: 40,
        imageOutputTokens: 4160,
        providerTotalTokens: 4250,
      },
      usageSource: 'actual',
    })
  })

  it.each([
    ['missing text usage', () => mapTextResponseUsage('resp_123', 'gpt-5.6-luna', null)],
    ['missing image usage', () => mapImageUsage(null, 'gpt-image-2', null)],
    ['invalid cached tokens', () => mapTextResponseUsage('resp_123', 'gpt-5.6-luna', { input_tokens: 10, input_tokens_details: { cached_tokens: 11 }, output_tokens: 1, total_tokens: 11 })],
  ])('rejects %s so callers must choose the explicit estimate path', (_name, run) => {
    expect(run).toThrow('PROVIDER_USAGE_INVALID')
  })
})
