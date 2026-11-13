import { describe, expect, it, vi } from 'vitest'
import {
  recordChannelConsent,
  revokeChannelConsent,
  verifyCapabilityConsent,
  type RecordConsentInput,
} from '@/features/channels/consent-ledger'

describe('Channel Consent Envelope & Delegation Gate (ANI-998)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const actorUserId = '20000000-0000-4000-8000-000000000001'
  const channel = 'instagram'

  it('records capability-level consent envelope with signature and active status', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ data: [{ id: 'consent-1' }], error: null })
    const mockClient = {
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
      }),
    }

    const input: RecordConsentInput = {
      workspaceId,
      actorUserId,
      channel,
      tier: 'AUTONOMOUS_DELEGATION',
      capabilities: {
        publish: true,
        reply_comments: true,
        reply_dm: false,
        insights: true,
      },
      policyVersion: 'v2.0',
    }

    const res = await recordChannelConsent(input, mockClient as any)
    expect(res.success).toBe(true)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: workspaceId,
        channel: 'instagram',
        consent_tier: 'AUTONOMOUS_DELEGATION',
        status: 'ACTIVE',
        capabilities: expect.objectContaining({
          publish: true,
          reply_comments: true,
        }),
      }),
    )
  })

  it('verifies granted capability consent as true when active', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    status: 'ACTIVE',
                    capabilities: {
                      publish: true,
                      reply_comments: true,
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const check = await verifyCapabilityConsent(workspaceId, channel, 'reply_comments', mockClient as any)
    expect(check.consented).toBe(true)
    expect(check.status).toBe('ACTIVE')
  })

  it('blocks execution when capability is missing from active consent', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    status: 'ACTIVE',
                    capabilities: {
                      publish: true,
                      reply_comments: false, // not allowed
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const check = await verifyCapabilityConsent(workspaceId, channel, 'reply_comments', mockClient as any)
    expect(check.consented).toBe(false)
    expect(check.failureCode).toBe('CAPABILITY_NOT_CONSENTED')
  })

  it('blocks execution immediately when consent is REVOKED', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    status: 'REVOKED',
                    capabilities: {
                      publish: true,
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const check = await verifyCapabilityConsent(workspaceId, channel, 'publish', mockClient as any)
    expect(check.consented).toBe(false)
    expect(check.failureCode).toBe('CONSENT_REVOKED')
  })

  it('revokes consent with reason and timestamp', async () => {
    const mockEq3 = vi.fn().mockResolvedValue({ error: null })
    const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3 })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })
    const mockClient = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
      }),
    }

    const res = await revokeChannelConsent(
      workspaceId,
      actorUserId,
      channel,
      'AUTONOMOUS_DELEGATION',
      'Security policy update',
      mockClient as any,
    )

    expect(res.success).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'REVOKED',
        revocation_reason: 'Security policy update',
        revoked_by: actorUserId,
      }),
    )
  })
})
