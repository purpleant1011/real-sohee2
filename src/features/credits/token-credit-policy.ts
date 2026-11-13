export type TokenUsage = Readonly<{
  textInputTokens: number
  cachedTextInputTokens: number
  textOutputTokens: number
  imageInputTokens: number
  imageOutputTokens: number
}>

export type TokenCreditPolicy = Readonly<{
  version: string
  label: string
  policyStatus: 'test' | 'active' | 'retired'
  timezone: 'Asia/Seoul'
  weeklyLimit: number
  commercialIncludedCredits: number | null
  microcreditsPerCredit: number
  weights: Readonly<{
    uncachedTextInput: number
    cachedTextInput: number
    textOutput: number
    imageInput: number
    imageOutput: number
  }>
}>

export const v08TestTokenCreditPolicy: TokenCreditPolicy = Object.freeze({
  version: 'v08-test-2000-1',
  label: 'V0.8 토큰 기반 테스트 정책',
  policyStatus: 'test',
  timezone: 'Asia/Seoul',
  weeklyLimit: 2000,
  commercialIncludedCredits: null,
  microcreditsPerCredit: 1_000_000,
  weights: Object.freeze({
    uncachedTextInput: 250,
    cachedTextInput: 63,
    textOutput: 1_000,
    imageInput: 1_000,
    imageOutput: 6_250,
  }),
})

function assertTokenCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('TOKEN_USAGE_INVALID')
}

export function calculateTokenCredits(
  usage: TokenUsage,
  policy: TokenCreditPolicy = v08TestTokenCreditPolicy,
): number {
  for (const value of Object.values(usage)) assertTokenCount(value)
  if (usage.cachedTextInputTokens > usage.textInputTokens) throw new Error('TOKEN_USAGE_INVALID')
  if (Object.values(usage).every((value) => value === 0)) throw new Error('TOKEN_USAGE_INVALID')

  const uncachedTextInput = usage.textInputTokens - usage.cachedTextInputTokens
  const terms = [
    uncachedTextInput * policy.weights.uncachedTextInput,
    usage.cachedTextInputTokens * policy.weights.cachedTextInput,
    usage.textOutputTokens * policy.weights.textOutput,
    usage.imageInputTokens * policy.weights.imageInput,
    usage.imageOutputTokens * policy.weights.imageOutput,
  ]
  if (terms.some((value) => !Number.isSafeInteger(value))) throw new Error('TOKEN_USAGE_INVALID')
  const microcredits = terms.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(microcredits)) throw new Error('TOKEN_USAGE_INVALID')
  return Math.max(1, Math.ceil(microcredits / policy.microcreditsPerCredit))
}
