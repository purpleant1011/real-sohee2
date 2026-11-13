import { describe, expect, it } from 'vitest'
import { mapGeminiTextUsage } from './usage-event'

describe('Gemini usage provenance', () => {
  it('records real provider, cached inputs and thinking output without raw response data', () => {
    expect(mapGeminiTextUsage('gemini-response-1', 'gemini-3.8-flash', {
      promptTokenCount: 1200, cachedContentTokenCount: 200,
      candidatesTokenCount: 300, thoughtsTokenCount: 100, totalTokenCount: 1600,
    })).toEqual({
      provider: 'gemini', providerRequestId: 'gemini-response-1', model: 'gemini-3.8-flash',
      operation: 'text_response', usageSource: 'actual',
      usage: { textInputTokens: 1200, cachedTextInputTokens: 200, textOutputTokens: 400,
        imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 1600 },
    })
  })

  it('preserves explicit zero usage rather than inventing a 400-token call', () => {
    expect(mapGeminiTextUsage(null, 'gemini-3.8-flash', {
      promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0,
    }).usage.providerTotalTokens).toBe(0)
  })

  it.each([
    undefined,
    { totalTokenCount: 150 },
    { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 11, totalTokenCount: 12 },
    { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 5, totalTokenCount: 12 },
  ])('rejects absent or inconsistent counters instead of claiming actual usage', raw => {
    expect(() => mapGeminiTextUsage(null, 'gemini-3.8-flash', raw)).toThrow('PROVIDER_USAGE_INVALID')
  })
})
