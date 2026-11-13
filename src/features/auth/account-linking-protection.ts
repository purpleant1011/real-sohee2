/**
 * [ANI-472][J10] Auth Identity & Account Linking Protection
 * Prevents duplicate workspaces and duplicate trial grants when users link Google/Email identities.
 */

export interface AccountLinkVerificationResult {
  canProceed: boolean
  isExistingUser: boolean
  workspaceId?: string
  grantTrial: boolean
  reason?: string
}

export class AccountLinkingProtectionService {
  /**
   * Evaluates if incoming OAuth or email login should create a new workspace or reuse existing.
   */
  static evaluateAccountAccess(params: {
    email: string
    provider: 'google' | 'email' | 'kakao'
    existingMemberships: { workspaceId: string; role: string }[]
    existingLedgers: { kind: string }[]
  }): AccountLinkVerificationResult {
    const { existingMemberships, existingLedgers } = params

    // 1. User already has workspace membership
    if (existingMemberships && existingMemberships.length > 0) {
      return {
        canProceed: true,
        isExistingUser: true,
        workspaceId: existingMemberships[0].workspaceId,
        grantTrial: false,
        reason: 'Existing workspace found; linking identity to existing workspace.'
      }
    }

    // 2. User already received trial grant
    const hasTrialGrant = existingLedgers.some((l) => l.kind === 'TRIAL_GRANT')

    return {
      canProceed: true,
      isExistingUser: false,
      grantTrial: !hasTrialGrant,
      reason: hasTrialGrant ? 'Trial already granted previously.' : 'New user eligible for 14-day 40,000 SC trial grant.'
    }
  }
}
