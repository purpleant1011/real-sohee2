import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import * as serverEnv from './server-env'
import { parseGeminiTextConfig, parseOpenAIImageConfig } from './server-env'

describe('parseGeminiTextConfig', () => {
  it('rejects a missing server-side Gemini key without echoing a value', () => {
    expect(() => parseGeminiTextConfig({})).toThrow('GEMINI_API_KEY')
  })

  it('returns the key and default models for server-only Gemini construction', () => {
    expect(
      parseGeminiTextConfig({
        GEMINI_API_KEY: 'AIzaSyTestSafeKeyPlaceholderLongEnough',
      }),
    ).toEqual({
      apiKey: 'AIzaSyTestSafeKeyPlaceholderLongEnough',
      conversationModel: 'gemini-3.5-flash-lite',
      actionModel: 'gemini-3.8-flash',
    })
  })
})

describe('OpenAI text config removal', () => {
  it('does not export parseOpenAITextConfig or readOpenAITextConfig', () => {
    expect((serverEnv as Record<string, unknown>).parseOpenAITextConfig).toBeUndefined()
    expect((serverEnv as Record<string, unknown>).readOpenAITextConfig).toBeUndefined()
  })
})

describe('parseOpenAIImageConfig', () => {
  it('rejects a missing server-side image key without echoing a value', () => {
    expect(() => parseOpenAIImageConfig({})).toThrow('OPENAI_IMAGE_API_KEY')
  })

  it('uses the configured image key and supported default model', () => {
    expect(
      parseOpenAIImageConfig({
        OPENAI_IMAGE_API_KEY: 'sk-test-safe-image-placeholder',
      }),
    ).toEqual({ apiKey: 'sk-test-safe-image-placeholder', model: 'gpt-image-2.5-sunburst' })
  })
})
