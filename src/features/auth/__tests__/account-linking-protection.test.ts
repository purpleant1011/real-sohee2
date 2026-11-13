import { describe, it, expect } from 'vitest'
import { AccountLinkingProtectionService } from '../account-linking-protection'

describe('AccountLinkingProtectionService [ANI-472/J10]', () => {
  it('reuses existing workspace for returning user and prevents duplicate trial grant', () => {
    const result = AccountLinkingProtectionService.evaluateAccountAccess({
      email: 'owner@beauty.com',
      provider: 'google',
      existingMemberships: [{ workspaceId: 'ws-existing-123', role: 'owner' }],
      existingLedgers: [{ kind: 'TRIAL_GRANT' }]
    })

    expect(result.canProceed).toBe(true)
    expect(result.isExistingUser).toBe(true)
    expect(result.workspaceId).toBe('ws-existing-123')
    expect(result.grantTrial).toBe(false)
  })

  it('grants 14-day trial only to genuine new users without existing trial grant', () => {
    const result = AccountLinkingProtectionService.evaluateAccountAccess({
      email: 'new_owner@gmail.com',
      provider: 'google',
      existingMemberships: [],
      existingLedgers: []
    })

    expect(result.canProceed).toBe(true)
    expect(result.isExistingUser).toBe(false)
    expect(result.grantTrial).toBe(true)
  })
})
