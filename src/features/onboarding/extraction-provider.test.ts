import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  createOpenAIOnboardingExtractionProvider,
  OnboardingExtractionProviderError,
  parseOnboardingExtractionOutput,
} from './extraction-provider'

const answer = '청라에서 자연눈썹 시술을 운영해요.'
const draft = {
  key: 'business_identity',
  value: '청라 지역 자연눈썹 시술 서비스',
  confidence: 0.92,
  evidenceQuote: answer,
  source: 'onboarding_answer',
}

describe('onboarding extraction provider', () => {
  it('returns one strict candidate grounded in the current answer', () => {
    expect(parseOnboardingExtractionOutput(JSON.stringify(draft), {
      step: 'business_identity',
      answer,
    })).toEqual(draft)
  })

  it.each([
    ['wrong key', { ...draft, key: 'primary_offering' }],
    ['invented evidence', { ...draft, evidenceQuote: '사용자가 하지 않은 말' }],
    ['unknown field', { ...draft, internalId: 'private' }],
  ])('rejects %s without exposing raw output', (_name, value) => {
    expect(() => parseOnboardingExtractionOutput(JSON.stringify(value), {
      step: 'business_identity',
      answer,
    })).toThrow(new OnboardingExtractionProviderError())
  })

  it('uses strict structured output without internal identifiers', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: JSON.stringify(draft) })
    const provider = createOpenAIOnboardingExtractionProvider(
      { responses: { create } } as unknown as Pick<OpenAI, 'responses'>,
      'gpt-5.6-luna',
    )

    await expect(provider.extract({
      step: 'business_identity',
      answer,
      approvedFacts: [{ key: 'marketing_goal', value: '상담 문의 늘리기' }],
    })).resolves.toEqual(draft)

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-luna',
      store: false,
      text: {
        format: expect.objectContaining({
          type: 'json_schema',
          name: 'onboarding_profile_candidate',
          strict: true,
        }),
      },
    }))
    const request = JSON.stringify(create.mock.calls[0]?.[0])
    expect(request).toContain('상담 문의 늘리기')
    expect(request).not.toContain('workspaceId')
    expect(request).not.toContain('userId')
  })

  it('normalizes provider failures without exposing their body', async () => {
    const create = vi.fn().mockRejectedValue(new Error('secret provider body'))
    const provider = createOpenAIOnboardingExtractionProvider(
      { responses: { create } } as unknown as Pick<OpenAI, 'responses'>,
      'gpt-5.6-luna',
    )

    await expect(provider.extract({
      step: 'business_identity',
      answer,
      approvedFacts: [],
    })).rejects.toEqual(new OnboardingExtractionProviderError())
  })
})
