import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeMetaPublish } from '@/lib/external-actions/meta-action-executor'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'

// Mock admin client and helpers
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockRpc = vi.fn()

let mockTableState: Record<string, any> = {}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      select: (...args: any[]) => {
        mockSelect(table, ...args)
        return {
          eq: (...eqArgs: any[]) => {
            mockEq(table, ...eqArgs)
            return {
              eq: (...eqArgs2: any[]) => {
                mockEq(table, ...eqArgs2)
                return {
                  maybeSingle: () => mockMaybeSingle(table),
                  single: () => mockSingle(table),
                }
              },
              maybeSingle: () => mockMaybeSingle(table),
              single: () => mockSingle(table),
            }
          },
          maybeSingle: () => mockMaybeSingle(table),
          single: () => mockSingle(table),
        }
      },
      insert: (data: any) => {
        mockInsert(table, data)
        return {
          select: () => ({
            single: () => mockSingle(table, data),
          }),
        }
      },
      update: (data: any) => {
        mockUpdate(table, data)
        return {
          eq: () => ({
            eq: () => ({ select: () => ({ single: () => mockSingle(table, data) }) }),
            select: () => ({ single: () => mockSingle(table, data) }),
          }),
        }
      },
    }),
    rpc: (...args: any[]) => mockRpc(...args),
  }),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn().mockResolvedValue({
    accessToken: 'valid-meta-access-token-12345',
    externalAccountId: 'act_meta_123',
    grantedScopes: ['instagram_basic', 'instagram_content_publish'],
  }),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady: vi.fn().mockResolvedValue({
    workspaceId: '10000000-0000-4000-8000-000000000001',
    ready: true,
    facts: {},
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }),
}))

describe('Meta Publish Ledger Pipeline (ANI-996)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const actorUserId = '20000000-0000-4000-8000-000000000001'
  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    mockMaybeSingle.mockImplementation((table: string) => {
      if (table === 'channel_connections') {
        return Promise.resolve({
          data: {
            id: '30000000-0000-4000-8000-000000000001',
            workspace_id: workspaceId,
            channel: 'instagram',
            status: 'connected',
            account_label: 'sohee.official',
            external_account_id: 'act_meta_123',
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    mockSingle.mockImplementation((table: string, data?: any) => {
      return Promise.resolve({ data: { id: data?.id || 'mock-id' }, error: null })
    })

    mockRpc.mockResolvedValue({ data: true, error: null })
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it.each(['succeeded', 'unknown_result', 'RESULT_UNKNOWN', 'executing'])('reuses %s without a second provider call and rejects changed approval or payload', async (status) => {
    const publish = vi.fn().mockResolvedValue({ providerPostId: 'post' })
    const input = { workspaceId, actorUserId, channel: 'instagram' as const,
      idempotencyKey: 'stable-key', caption: 'approved', mediaUrls: ['https://storage.sohee.ai/test-media.png'],
      igProvider: { publish } as any, readbackFn: vi.fn().mockResolvedValue(null) }
    await executeMetaPublish(input)
    const row = mockInsert.mock.calls.find(([table]) => table === 'external_action_requests')![1]
    const previous = mockMaybeSingle.getMockImplementation()!
    mockMaybeSingle.mockImplementation((table) => table === 'external_action_requests'
      ? Promise.resolve({ data: { ...row, status }, error: null }) : previous(table))
    await expect(executeMetaPublish(input)).resolves.toMatchObject({ actionRequestId: row.id, verified: false,
      status: status === 'executing' ? 'EXECUTING' : 'RESULT_UNKNOWN' })
    expect(publish).toHaveBeenCalledOnce()
    for (const change of [{ caption: 'changed' }, { approvalId: 'new-approval' }, { contentVersionId: 'new-version' }]) {
      await expect(executeMetaPublish({ ...input, ...change })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' })
    }
    expect(publish).toHaveBeenCalledOnce()
  })

  it('reuses a succeeded request only with its durable observed receipt', async () => {
    const publish = vi.fn().mockResolvedValue({ providerPostId: 'post' })
    const input = { workspaceId, actorUserId, channel: 'instagram' as const, idempotencyKey: 'verified-key',
      caption: 'approved', mediaUrls: ['https://storage.sohee.ai/test-media.png'], igProvider: { publish } as any,
      readbackFn: vi.fn().mockResolvedValue('https://instagram.com/p/verified') }
    await executeMetaPublish(input)
    const row = mockInsert.mock.calls.find(([table]) => table === 'external_action_requests')![1]
    const receipt = mockInsert.mock.calls.find(([table]) => table === 'external_action_receipts')![1]
    const previous = mockMaybeSingle.getMockImplementation()!
    mockMaybeSingle.mockImplementation((table) => table === 'external_action_requests'
      ? Promise.resolve({ data: { ...row, status: 'succeeded' }, error: null })
      : table === 'external_action_receipts' ? Promise.resolve({ data: receipt, error: null }) : previous(table))
    await expect(executeMetaPublish(input)).resolves.toMatchObject({ status: 'SUCCEEDED', verified: true,
      providerPostId: 'post', permalink: 'https://instagram.com/p/verified' })
    expect(publish).toHaveBeenCalledOnce()
  })

  it('converges a concurrent unique conflict without calling the provider', async () => {
    const previous = mockMaybeSingle.getMockImplementation()!
    let queried = false
    mockMaybeSingle.mockImplementation((table) => {
      if (table !== 'external_action_requests') return previous(table)
      if (!queried) { queried = true; return Promise.resolve({ data: null, error: null }) }
      const row = mockInsert.mock.calls.find(([name]) => name === 'external_action_requests')![1]
      return Promise.resolve({ data: { ...row, status: 'executing' }, error: null })
    })
    mockSingle.mockImplementation((table) => Promise.resolve(table === 'external_action_requests'
      ? { data: null, error: { code: '23505' } } : { data: { id: 'ok' }, error: null }))
    const publish = vi.fn()
    await expect(executeMetaPublish({ workspaceId, actorUserId, channel: 'instagram', idempotencyKey: 'race',
      mediaUrls: ['https://storage.sohee.ai/test-media.png'], igProvider: { publish } as any }))
      .resolves.toMatchObject({ status: 'EXECUTING' })
    expect(publish).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'expired', 'scope missing', 'account changed'])('blocks %s after request persistence before provider dispatch', async (reason) => {
    const credential = vi.mocked(loadChannelCredentialByChannel)
    credential.mockResolvedValueOnce({ accessToken: 'token', externalAccountId: 'act_meta_123' } as any)
    if (reason === 'account changed') credential.mockResolvedValueOnce({ accessToken: 'token', externalAccountId: 'other-account' } as any)
    else credential.mockRejectedValueOnce(new Error(reason))
    const publish = vi.fn()
    await expect(executeMetaPublish({ workspaceId, actorUserId, channel: 'instagram',
      mediaUrls: ['https://storage.sohee.ai/test-media.png'], igProvider: { publish } as any }))
      .resolves.toMatchObject({ status: 'BLOCKED', errorCode: 'EXECUTION_PREFLIGHT_BLOCKED' })
    expect(mockInsert).toHaveBeenCalledWith('external_action_attempts', expect.anything())
    expect(publish).not.toHaveBeenCalled()
  })

  it('fails closed: request persistence failure results in ZERO provider calls', async () => {
    const mockPublish = vi.fn()
    const mockIgProvider = {
      publish: mockPublish,
      sendCommentReply: vi.fn(),
      sendDirectMessage: vi.fn(),
    }

    // Simulate DB failure on external_action_requests insert
    mockSingle.mockImplementation((table: string) => {
      if (table === 'external_action_requests') {
        return Promise.resolve({
          data: null,
          error: { message: 'Database connection timeout', code: '57P01' },
        })
      }
      return Promise.resolve({ data: { id: 'ok' }, error: null })
    })

    await expect(
      executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        mediaUrls: ['https://storage.sohee.ai/test-media.png'],
        igProvider: mockIgProvider as any,
      }),
    ).rejects.toThrow('Database connection timeout')

    // Provider write MUST NEVER be invoked!
    expect(mockPublish).toHaveBeenCalledTimes(0)
  })

  it('fails closed: attempt persistence failure results in ZERO provider calls', async () => {
    const mockPublish = vi.fn()
    const mockIgProvider = {
      publish: mockPublish,
      sendCommentReply: vi.fn(),
      sendDirectMessage: vi.fn(),
    }

    // external_action_requests succeeds, but external_action_attempts fails
    mockSingle.mockImplementation((table: string) => {
      if (table === 'external_action_attempts') {
        return Promise.resolve({
          data: null,
          error: { message: 'FK constraint violation', code: '23503' },
        })
      }
      return Promise.resolve({ data: { id: 'ok' }, error: null })
    })

    await expect(
      executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        mediaUrls: ['https://storage.sohee.ai/test-media.png'],
        igProvider: mockIgProvider as any,
      }),
    ).rejects.toThrow('FK constraint violation')

    // Provider write MUST NEVER be invoked!
    expect(mockPublish).toHaveBeenCalledTimes(0)
  })

  it('handles provider acceptance with readback failure: isolates to RESULT_UNKNOWN/VERIFYING without duplicate publish', async () => {
    const mockPublish = vi.fn().mockResolvedValue({
      providerPostId: 'post_meta_98765',
      destinationUrl: 'https://instagram.com/p/98765',
    })
    const mockIgProvider = {
      publish: mockPublish,
      sendCommentReply: vi.fn(),
      sendDirectMessage: vi.fn(),
    }

    // Readback returns null (e.g. 404/timeout from Meta API)
    const mockReadback = vi.fn().mockResolvedValue(null)

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      mediaUrls: ['https://storage.sohee.ai/test-media.png'],
      igProvider: mockIgProvider as any,
      readbackFn: mockReadback,
    })

    expect(result.success).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.status).toBe('VERIFYING')
    expect(result.errorCode).toBe('RESULT_UNKNOWN')

    // Only 1 publish attempt, NEVER duplicate publish
    expect(mockPublish).toHaveBeenCalledTimes(1)
    // Verification RPC must NOT have been called
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('provider accepted but receipt persistence fails: VERIFIED state is strictly forbidden', async () => {
    const mockPublish = vi.fn().mockResolvedValue({
      providerPostId: 'post_meta_98765',
      destinationUrl: 'https://instagram.com/p/98765',
    })
    const mockIgProvider = {
      publish: mockPublish,
      sendCommentReply: vi.fn(),
      sendDirectMessage: vi.fn(),
    }
    const mockReadback = vi.fn().mockResolvedValue('https://instagram.com/p/98765')

    // Receipt persistence fails
    mockSingle.mockImplementation((table: string) => {
      if (table === 'external_action_receipts') {
        return Promise.resolve({
          data: null,
          error: { message: 'Disk full on receipts table', code: '53100' },
        })
      }
      return Promise.resolve({ data: { id: 'ok' }, error: null })
    })

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      mediaUrls: ['https://storage.sohee.ai/test-media.png'],
      igProvider: mockIgProvider as any,
      readbackFn: mockReadback,
    })

    expect(result.success).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.errorCode).toBe('RECEIPT_PERSISTENCE_FAILED')

    // Verification RPC MUST NOT have been called
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('completes the entire 14-step pipeline on happy path: records request, attempt, receipt, and invokes complete_channel_verification_v12', async () => {
    const mockPublish = vi.fn().mockResolvedValue({
      providerPostId: 'post_meta_98765',
      destinationUrl: 'https://instagram.com/p/98765',
    })
    const mockIgProvider = {
      publish: mockPublish,
      sendCommentReply: vi.fn(),
      sendDirectMessage: vi.fn(),
    }
    const mockReadback = vi.fn().mockResolvedValue('https://instagram.com/p/98765')

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      mediaUrls: ['https://storage.sohee.ai/test-media.png'],
      verificationCode: 'TEST1234',
      igProvider: mockIgProvider as any,
      readbackFn: mockReadback,
    })

    expect(result.success).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.status).toBe('VERIFIED')
    expect(result.providerPostId).toBe('post_meta_98765')
    expect(result.permalink).toBe('https://instagram.com/p/98765')

    // Check that RPC complete_channel_verification_v12 was invoked
    expect(mockRpc).toHaveBeenCalledWith('complete_channel_verification_v12', expect.objectContaining({
      p_workspace_id: workspaceId,
      p_channel: 'instagram',
      p_action_request_id: result.actionRequestId,
      p_verification_code: 'TEST1234',
      p_external_post_id: 'post_meta_98765',
      p_permalink: 'https://instagram.com/p/98765',
      p_actor_user_id: actorUserId,
    }))

    // Verify insertions were made into external_action_requests, external_action_attempts, external_action_receipts
    expect(mockInsert).toHaveBeenCalledWith('external_action_requests', expect.objectContaining({
      workspace_id: workspaceId,
      channel: 'instagram',
      action_kind: 'feed_publish',
      status: 'executing',
    }))

    expect(mockInsert).toHaveBeenCalledWith('external_action_attempts', expect.objectContaining({
      workspace_id: workspaceId,
      status: 'claimed',
    }))

    expect(mockInsert).toHaveBeenCalledWith('external_action_receipts', expect.objectContaining({
      workspace_id: workspaceId,
      receipt_kind: 'observed_result',
      provider_reference: 'post_meta_98765',
      result_url: 'https://instagram.com/p/98765',
    }))
  })
})
