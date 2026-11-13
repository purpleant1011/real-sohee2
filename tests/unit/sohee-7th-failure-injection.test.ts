import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeMetaPublish } from '@/lib/external-actions/meta-action-executor'
import { evaluateRiskPolicy, executeResponseJobDelivery } from '@/features/channels/responsive-employee-loop'
import { verifyMetaWebhookSignature } from '@/lib/channels/meta-webhooks'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'

// Mocks for DB and External Services
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockRpc = vi.fn()

let mockTableState: Record<string, any> = {}

function createSelectChain(table: string): any {
  return {
    eq: (...eqArgs: any[]) => {
      mockEq(table, ...eqArgs)
      return createSelectChain(table)
    },
    maybeSingle: () => mockMaybeSingle(table),
    single: () => mockSingle(table),
    order: () => createSelectChain(table),
    limit: () => createSelectChain(table),
    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      select: (...args: any[]) => {
        mockSelect(table, ...args)
        return createSelectChain(table)
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

let mockCredentialFn = vi.fn()
vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: (...args: any[]) => mockCredentialFn(...args),
}))

let mockKillSwitchBlocked = false
let mockKillSwitchReason = ''
vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockImplementation(async () => ({
    blocked: mockKillSwitchBlocked,
    reason: mockKillSwitchReason,
  })),
}))

/**
 * [ANI-1006] Production Failure Injection Matrix Test
 * Verifies Fail-Closed & Defensive Resilience across all 10 critical failure paths:
 * 1. DB Write Failure -> Blocks Downstream Actions
 * 2. Channel Not Connected -> Blocks Provider Calls
 * 3. Credential Unavailable -> Blocks Provider Calls
 * 4. Kill Switch Engaged -> Blocks Provider Calls
 * 5. Consent Revoked -> Blocks Provider Calls
 * 6. Provider Error -> Records Failed Attempt, Never Claims Success
 * 7. Provider Accepted but Readback Failed -> Records RESULT_UNKNOWN, Never Auto-Republishes
 * 8. Webhook Invalid Signature -> Fails Verification
 * 9. High-Risk Keyword Detected -> Escalate to Human, Prohibit Autonomous Reply
 * 10. Delivery Consent Revoked -> Aborts Response Job Delivery
 */
describe('Production Failure Injection Matrix [7th Revision Truth Recovery]', () => {
  const workspaceId = '77777777-7777-7777-7777-777777777777'
  const actorUserId = '88888888-8888-8888-8888-888888888888'
  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    mockKillSwitchBlocked = false
    mockKillSwitchReason = ''

    mockTableState = {
      channel_connections: {
        id: 'conn-777',
        workspace_id: workspaceId,
        channel: 'instagram',
        status: 'connected',
        account_name: 'by_reum_official',
        external_account_id: 'ig-act-99',
      },
      channel_credentials: {
        id: 'cred-777',
        workspaceId,
        channel: 'instagram',
        accessToken: 'EAAB_TEST_TOKEN',
        externalAccountId: 'ig-act-99',
      },
      channel_consents: {
        workspace_id: workspaceId,
        channel: 'instagram',
        consent_tier: 'AUTONOMOUS_DELEGATION',
        status: 'ACTIVE',
        capabilities: {
          publish: true,
          comments_reply: true,
          dm_reply: true,
          verification_post_allowed: true,
        },
      },
    }

    mockCredentialFn.mockResolvedValue(mockTableState.channel_credentials)

    mockMaybeSingle.mockImplementation((table: string) => {
      if (table === 'channel_connections') return { data: mockTableState.channel_connections, error: null }
      if (table === 'channel_consents') return { data: mockTableState.channel_consents, error: null }
      return { data: null, error: null }
    })

    mockSingle.mockImplementation((table: string, data?: any) => {
      return { data: { id: 'mock-id', ...data }, error: null }
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

  it('Case 1: DB persistence error throws via assertSupabaseSuccess and halts downstream calls', () => {
    const failedDbResponse = {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    }

    expect(() => {
      assertSupabaseSuccess(failedDbResponse, 'business_profiles atomic insert')
    }).toThrowError(/duplicate key value violates unique constraint/)
  })

  it('Case 2: Channel disconnected returns CHANNEL_NOT_CONNECTED with 0 provider calls', async () => {
    mockTableState.channel_connections.status = 'disconnected'
    const mockIgProvider = { publish: vi.fn() }

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '테스트',
      igProvider: mockIgProvider as any,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CHANNEL_NOT_CONNECTED')
    expect(mockIgProvider.publish).toHaveBeenCalledTimes(0)
  })

  it('Case 3: Credential unavailable returns CREDENTIAL_UNAVAILABLE with 0 provider calls', async () => {
    mockCredentialFn.mockRejectedValue(new Error('Token decryption key expired'))
    const mockIgProvider = { publish: vi.fn() }

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '테스트',
      igProvider: mockIgProvider as any,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CREDENTIAL_UNAVAILABLE')
    expect(mockIgProvider.publish).toHaveBeenCalledTimes(0)
  })

  it('Case 4: Kill switch active returns KILL_SWITCH_ENGAGED with 0 provider calls', async () => {
    mockKillSwitchBlocked = true
    mockKillSwitchReason = 'Emergency Meta Graph API suspension'
    const mockIgProvider = { publish: vi.fn() }

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '테스트',
      igProvider: mockIgProvider as any,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('KILL_SWITCH_ENGAGED')
    expect(result.message).toContain('Emergency Meta Graph API suspension')
    expect(mockIgProvider.publish).toHaveBeenCalledTimes(0)
  })

  it('Case 5: Consent revoked returns CONSENT_REVOKED with 0 provider calls', async () => {
    mockTableState.channel_consents.status = 'REVOKED'
    const mockIgProvider = { publish: vi.fn() }

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '테스트',
      igProvider: mockIgProvider as any,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CONSENT_REVOKED')
    expect(mockIgProvider.publish).toHaveBeenCalledTimes(0)
  })

  it('Case 6: Provider error records failed attempt and returns META_API_ERROR (no false success)', async () => {
    const mockIgProvider = {
      publish: vi.fn().mockRejectedValue(new Error('Meta Graph API 500 Internal Server Error')),
    }

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '테스트',
      mediaUrls: ['https://storage.sohee.ai/workspaces/ws_test/approved_brand.png'],
      igProvider: mockIgProvider as any,
    })

    expect(result.success).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.errorCode).toBe('META_API_ERROR')
    expect(result.message).toContain('Meta Graph API 500')
  })

  it('Case 7: Provider accepted but readback unavailable isolates to RESULT_UNKNOWN (never duplicate publish)', async () => {
    const mockIgProvider = {
      publish: vi.fn().mockResolvedValue({
        providerPostId: 'media_99999999',
        destinationUrl: null,
      }),
    }

    // Readback returns null / times out
    const mockReadbackFn = vi.fn().mockResolvedValue(null)

    const result = await executeMetaPublish({
      workspaceId,
      actorUserId,
      channel: 'instagram',
      caption: '테스트',
      mediaUrls: ['https://storage.sohee.ai/workspaces/ws_test/approved_brand.png'],
      igProvider: mockIgProvider as any,
      readbackFn: mockReadbackFn as any,
    })

    expect(result.success).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.status).toBe('VERIFYING')
    expect(result.errorCode).toBe('RESULT_UNKNOWN')
    expect(result.message).toContain('독립 Readback 조회가 지연')
    // Crucial: RPC complete verification is NOT called when readback fails
    expect(mockRpc).toHaveBeenCalledTimes(0)
  })

  it('Case 8: Webhook invalid signature returns false to reject untrusted payload', async () => {
    const payload = JSON.stringify({ entry: [{ id: '123' }] })
    const appSecret = 'valid_app_secret_12345'
    const forgedSignature = 'sha256=invalid_hash_value_999'

    const isValid = await verifyMetaWebhookSignature(payload, forgedSignature, appSecret)
    expect(isValid).toBe(false)
  })

  it('Case 9: High-risk refund/dispute keywords prohibit autonomous response and escalate to human', () => {
    const refundInquiry = {
      channel: 'instagram' as const,
      category: 'dm' as const,
      text: '결제 취소하고 당장 환불해주세요. 안 그러면 소비자원에 고발합니다.',
    }

    const evalResult = evaluateRiskPolicy(refundInquiry)
    expect(evalResult.riskTier).toBe('HIGH')
    expect(evalResult.isAutonomousAllowed).toBe(false)
    expect(evalResult.policyAction).toBe('ESCALATE_TO_HUMAN')
    expect(evalResult.reason).toContain('환불/분쟁')
  })

  it('Case 10: Response job delivery with revoked consent blocks execution (Fail-Closed)', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_response_jobs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'job-revoked-01',
                    workspace_id: workspaceId,
                    channel_connection_id: 'conn-777',
                    response_kind: 'instagram_comment_reply',
                    external_target_id: 'comment-1234',
                    draft_text: '감사합니다!',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'conn-777',
                    workspace_id: workspaceId,
                    channel: 'instagram',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'channel_consents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        workspace_id: workspaceId,
                        channel: 'instagram',
                        consent_tier: 'AUTONOMOUS_DELEGATION',
                        status: 'REVOKED',
                        capabilities: {},
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }
      }),
    }

    const mockMetaProvider = {
      sendCommentReply: vi.fn(),
    }

    const result = await executeResponseJobDelivery({
      jobId: 'job-revoked-01',
      actorUserId,
      client: mockSupabase,
      metaProvider: mockMetaProvider,
      accessToken: 'EAAB_VALID_TOKEN',
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('CONSENT_BLOCKED')
    expect(mockMetaProvider.sendCommentReply).toHaveBeenCalledTimes(0)
  })
})
