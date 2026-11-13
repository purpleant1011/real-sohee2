import { v08TestTokenCreditPolicy } from './token-credit-policy'

export const v08PreviewCreditPolicy = Object.freeze({
  version: v08TestTokenCreditPolicy.version,
  label: v08TestTokenCreditPolicy.label,
  policyStatus: v08TestTokenCreditPolicy.policyStatus,
  timezone: v08TestTokenCreditPolicy.timezone,
  weeklyPreviewAllowanceCredits: v08TestTokenCreditPolicy.weeklyLimit,
  commercialIncludedCredits: v08TestTokenCreditPolicy.commercialIncludedCredits,
})
