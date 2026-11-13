import { describe, expect, it } from 'vitest'
import {
  calculateCommercialTokenCredits,
  commercialCreditPolicy,
  weeklyCreditsForPlan,
} from './commercial-credit-policy'

describe('commercial credit policy', () => {
  it.each([
    ['starter', 300],
    ['growth', 2_000],
    ['operations', 5_000],
    ['focus', 10_000],
  ] as const)('assigns %s its approved weekly entitlement', (plan, credits) => {
    expect(weeklyCreditsForPlan(plan)).toBe(credits)
  })

  it('keeps the first commercial policy immutable and versioned', () => {
    expect(commercialCreditPolicy).toMatchObject({
      version: 'v08-commercial-token-1',
      timezone: 'Asia/Seoul',
    })
    expect(Object.isFrozen(commercialCreditPolicy)).toBe(true)
    expect(Object.isFrozen(commercialCreditPolicy.weeklyCredits)).toBe(true)
    expect(Object.isFrozen(commercialCreditPolicy.weights)).toBe(true)
  })

  it('uses the same actual-token weights as the validated test policy', () => {
    expect(calculateCommercialTokenCredits({
      textInputTokens: 4_000,
      cachedTextInputTokens: 0,
      textOutputTokens: 0,
      imageInputTokens: 0,
      imageOutputTokens: 0,
    })).toBe(1)
  })
})
