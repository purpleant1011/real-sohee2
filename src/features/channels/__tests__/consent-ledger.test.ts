import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  recordChannelConsent,
  getChannelConsents,
  revokeChannelConsent,
  isActionConsented,
} from '../consent-ledger'

describe('3-Tier Autonomous Channel Consent Ledger (ANI-617)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const actorUserId = '20000000-0000-4000-8000-000000000001'

  it('records 3-tier consents independently without auto-enabling autonomous mode on platform auth', async () => {
    const mockDb = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    }

    await recordChannelConsent({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      tier: 'PLATFORM_AUTH',
      capabilities: { account_access: true },
    }, mockDb as any)

    const mockQueryDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              consent_tier: 'PLATFORM_AUTH',
              status: 'ACTIVE',
              capabilities: { account_access: true },
            },
            error: null,
          }),
        }),
      }),
    }

    const isPublishConsented = await isActionConsented(workspaceId, 'instagram', 'PUBLISH_FEED', mockQueryDb as any)
    expect(isPublishConsented).toBe(false)
  })

  it('consents verification post only when explicit VERIFICATION_CONSENT exists', async () => {
    const mockQueryDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              consent_tier: 'VERIFICATION_CONSENT',
              status: 'ACTIVE',
              capabilities: { verification_post_allowed: true },
            },
            error: null,
          }),
        }),
      }),
    }

    const isVerificationConsented = await isActionConsented(
      workspaceId,
      'instagram',
      'VERIFICATION_POST',
      mockQueryDb as any
    )
    expect(isVerificationConsented).toBe(true)
  })

  it('immediately blocks actions after revocation', async () => {
    const mockRevokedDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              consent_tier: 'AUTONOMOUS_DELEGATION',
              status: 'REVOKED',
              capabilities: { publish: true },
            },
            error: null,
          }),
        }),
      }),
    }

    const isPublishConsented = await isActionConsented(workspaceId, 'instagram', 'PUBLISH_FEED', mockRevokedDb as any)
    expect(isPublishConsented).toBe(false)
  })
})
