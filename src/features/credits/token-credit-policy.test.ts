import { describe, expect, it } from 'vitest'
import { calculateTokenCredits, v08TestTokenCreditPolicy } from './token-credit-policy'

describe('token credit policy', () => {
  it.each([
    ['short chat', { textInputTokens: 1000, cachedTextInputTokens: 0, textOutputTokens: 500, imageInputTokens: 0, imageOutputTokens: 0 }, 1],
    ['long answer', { textInputTokens: 8000, cachedTextInputTokens: 0, textOutputTokens: 3000, imageInputTokens: 0, imageOutputTokens: 0 }, 5],
    ['cached context', { textInputTokens: 16000, cachedTextInputTokens: 16000, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 }, 2],
    ['medium image fixture', { textInputTokens: 400, cachedTextInputTokens: 0, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 4160 }, 27],
  ])('%s maps to versioned integer credits', (_name, usage, expected) => {
    expect(calculateTokenCredits(usage)).toBe(expected)
  })

  it('keeps the approved test policy immutable and explicit', () => {
    expect(v08TestTokenCreditPolicy).toMatchObject({
      version: 'v08-test-2000-1',
      weeklyLimit: 2000,
      timezone: 'Asia/Seoul',
    })
    expect(Object.isFrozen(v08TestTokenCreditPolicy)).toBe(true)
    expect(Object.isFrozen(v08TestTokenCreditPolicy.weights)).toBe(true)
  })

  it.each([
    ['negative', { textInputTokens: -1, cachedTextInputTokens: 0, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 }],
    ['fractional', { textInputTokens: 1.5, cachedTextInputTokens: 0, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 }],
    ['unsafe', { textInputTokens: Number.MAX_SAFE_INTEGER + 1, cachedTextInputTokens: 0, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 }],
    ['cached above total', { textInputTokens: 10, cachedTextInputTokens: 11, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 }],
    ['empty', { textInputTokens: 0, cachedTextInputTokens: 0, textOutputTokens: 0, imageInputTokens: 0, imageOutputTokens: 0 }],
  ])('rejects %s usage instead of inventing credits', (_name, usage) => {
    expect(() => calculateTokenCredits(usage)).toThrow('TOKEN_USAGE_INVALID')
  })
})
