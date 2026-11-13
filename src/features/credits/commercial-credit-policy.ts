import type { BillingPlanCode } from '@/features/billing/types'
import {
  calculateTokenCredits,
  type TokenCreditPolicy,
  type TokenUsage,
  v08TestTokenCreditPolicy,
} from './token-credit-policy'

const weeklyCredits = Object.freeze({
  starter: 300,
  growth: 2_000,
  operations: 5_000,
  focus: 10_000,
} satisfies Readonly<Record<BillingPlanCode, number>>)

export const commercialCreditPolicy = Object.freeze({
  version: 'v08-commercial-token-1',
  label: 'V0.8 상용 토큰 정책',
  policyStatus: 'active',
  timezone: 'Asia/Seoul',
  weeklyLimit: weeklyCredits.growth,
  commercialIncludedCredits: weeklyCredits.growth,
  microcreditsPerCredit: 1_000_000,
  weights: v08TestTokenCreditPolicy.weights,
  weeklyCredits,
} satisfies TokenCreditPolicy & Readonly<{
  weeklyCredits: Readonly<Record<BillingPlanCode, number>>
}>)

export function weeklyCreditsForPlan(code: BillingPlanCode): number {
  return commercialCreditPolicy.weeklyCredits[code]
}

export function calculateCommercialTokenCredits(usage: TokenUsage): number {
  return calculateTokenCredits(usage, commercialCreditPolicy)
}
