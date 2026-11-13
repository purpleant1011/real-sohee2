import {
  AccountLinkingProtectionService,
  type AccountLinkVerificationResult,
} from '@/features/auth/account-linking-protection'

export interface ExistingUserInfo {
  readonly id: string
  readonly email: string
  readonly primaryProvider: 'google' | 'email' | 'kakao' | string
  readonly memberships: readonly { workspaceId: string; role: string }[]
  readonly ledgers?: readonly { kind: string }[]
}

export interface VerifyKakaoAccountLinkingOptions {
  readonly email?: string
  readonly existingUser?: ExistingUserInfo | null
}

/**
 * Enforces account linking protection for Kakao logins.
 * Explicitly forbids automatic merging of accounts if an existing user was created with a different provider (e.g. Google or Email).
 * Reuses existing workspace only if the provider matches or if permitted.
 */
export function verifyKakaoAccountLinking(
  options: VerifyKakaoAccountLinkingOptions,
): AccountLinkVerificationResult {
  const { email, existingUser } = options

  if (existingUser) {
    // Prohibit auto-linking if existing user registered with another provider
    if (existingUser.primaryProvider && existingUser.primaryProvider !== 'kakao') {
      return {
        canProceed: false,
        isExistingUser: true,
        grantTrial: false,
        reason: 'account_linking_prohibited',
      }
    }

    return AccountLinkingProtectionService.evaluateAccountAccess({
      email: email ?? existingUser.email,
      provider: 'kakao',
      existingMemberships: [...existingUser.memberships],
      existingLedgers: [...(existingUser.ledgers ?? [])],
    })
  }

  return AccountLinkingProtectionService.evaluateAccountAccess({
    email: email ?? '',
    provider: 'kakao',
    existingMemberships: [],
    existingLedgers: [],
  })
}
