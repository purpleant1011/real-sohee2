import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeMetaPublish } from '@/lib/external-actions/meta-action-executor'
import { evaluateDualChannelReadiness } from '@/features/channels/dual-channel-verification'
import { executeDualChannelPublish, type ExactApprovalPayload } from '@/features/publishing/dual-publish-coordinator'

vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady: vi.fn().mockResolvedValue({
    workspaceId: '10000000-0000-4000-8000-000000000001',
    ready: true,
    facts: {},
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async (_workspaceId: string, channel: string) => ({
    accessToken: 'server-credential-token', externalAccountId: channel === 'threads' ? 'th-account-1' : 'ig-account-1',
  })),
}))

vi.mock('@/features/channels/consent-ledger', () => ({
  verifyCapabilityConsent: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
}))

describe('HF-39: Real App Publish → Receipt → Provider Readback Chain (ANI-1388)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const actorUserId = '20000000-0000-4000-8000-000000000001'
  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  describe('1. Receipt Schema Contract & Persistence Integrity', () => {
    it('persists external_action_receipts matching canonical production schema columns', async () => {
      let savedReceipt: any = null

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'conn-ig-1',
                  channel: 'instagram',
                  status: 'connected',
                  access_token: 'valid-test-token',
                  external_account_id: 'ig-account-1',
                  account_label: 'sohee_official',
                },
                error: null,
              }),
            }
          }
          if (table === 'external_action_requests') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          if (table === 'external_action_attempts') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'att-1' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          if (table === 'external_action_receipts') {
            return {
              insert: vi.fn((receiptData: any) => {
                savedReceipt = receiptData
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({ data: { id: receiptData.id }, error: null }),
                }
              }),
            }
          }
          if (table === 'channel_verification_runs') {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
        rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      }

      const mockIgProvider = {
        publish: vi.fn().mockResolvedValue({
          providerPostId: 'ig-post-fresh-999',
        }),
      }

      const mockReadback = vi.fn().mockResolvedValue('https://www.instagram.com/p/fresh999/')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        caption: 'Fresh publication test',
        mediaUrls: ['https://assets.sohee.ai/test-media.jpg'],
        adminClient: mockAdminClient as any,
        igProvider: mockIgProvider as any,
        readbackFn: mockReadback,
      })

      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)

      // Validate exact canonical receipt fields
      expect(savedReceipt).toBeDefined()
      expect(savedReceipt.workspace_id).toBe(workspaceId)
      expect(savedReceipt.action_request_id).toBe(result.actionRequestId)
      expect(savedReceipt.attempt_id).toBe(result.attemptId)
      expect(savedReceipt.receipt_kind).toBe('observed_result')
      expect(savedReceipt.provider_reference).toBe('ig-post-fresh-999')
      expect(savedReceipt.result_url).toBe('https://www.instagram.com/p/fresh999/')
      expect(savedReceipt.recorded_by).toBe(actorUserId)
      expect(savedReceipt.recorded_at).toBeDefined()
      expect(savedReceipt.observed_payload).toBeDefined()
      expect(savedReceipt.observed_payload.channel).toBe('instagram')
      expect(savedReceipt.observed_payload.published_post_id).toBe('ig-post-fresh-999')
      expect(savedReceipt.observed_payload.permalink).toBe('https://www.instagram.com/p/fresh999/')
      expect(savedReceipt.observed_payload.read_after_write).toBe(true)

      // Ensure forbidden/bogus columns are NOT present
      expect(savedReceipt.provider_code).toBeUndefined()
      expect(savedReceipt.provider_message).toBeUndefined()
      expect(savedReceipt.external_reference).toBeUndefined()
    })

    it('fails closed when external_action_receipts persistence encounters database error', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'conn-ig-1',
                  channel: 'instagram',
                  status: 'connected',
                  access_token: 'valid-test-token',
                  external_account_id: 'ig-account-1',
                  account_label: 'sohee_official',
                },
                error: null,
              }),
            }
          }
          if (table === 'external_action_requests') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'req-1' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          if (table === 'external_action_attempts') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'att-1' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          if (table === 'external_action_receipts') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '23503', message: 'foreign key violation' },
                }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
        rpc: vi.fn(),
      }

      const mockIgProvider = {
        publish: vi.fn().mockResolvedValue({
          providerPostId: 'ig-post-fail-receipt',
        }),
      }

      const mockReadback = vi.fn().mockResolvedValue('https://www.instagram.com/p/failreceipt/')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        caption: 'Receipt failure test',
        mediaUrls: ['https://assets.sohee.ai/test-media.jpg'],
        adminClient: mockAdminClient as any,
        igProvider: mockIgProvider as any,
        readbackFn: mockReadback,
      })

      // Verification RPC MUST NOT be called when receipt fails
      expect(mockAdminClient.rpc).not.toHaveBeenCalled()
      expect(result.status).toBe('FAILED')
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('RECEIPT_PERSISTENCE_FAILED')
    })
  })

  describe('2. Independent Readback Timeout Isolation (RESULT_UNKNOWN / VERIFYING)', () => {
    it('isolates to RESULT_UNKNOWN and VERIFYING status when independent readback fails or times out', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'conn-th-1',
                  channel: 'threads',
                  status: 'connected',
                  access_token: 'valid-test-token',
                  external_account_id: 'th-account-1',
                  account_label: 'sohee_threads',
                },
                error: null,
              }),
            }
          }
          if (table === 'external_action_requests') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'req-th-1' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          if (table === 'external_action_attempts') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'att-th-1' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
        rpc: vi.fn(),
      }

      const mockThProvider = {
        publish: vi.fn().mockResolvedValue({
          providerPostId: 'th-post-timeout-1',
        }),
      }

      // Readback returns null (simulating timeout or unpropagated post)
      const mockReadback = vi.fn().mockResolvedValue(null)

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'threads',
        caption: 'Timeout isolation test',
        mediaUrls: ['https://assets.sohee.ai/test-media.jpg'],
        adminClient: mockAdminClient as any,
        thProvider: mockThProvider as any,
        readbackFn: mockReadback,
      })

      // Verification MUST NOT succeed
      expect(result.status).toBe('VERIFYING')
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('RESULT_UNKNOWN')
      expect(mockAdminClient.rpc).not.toHaveBeenCalled()
    })
  })

  describe('3. Partial Success Isolation (No False Promotion to Dual Success)', () => {
    it('returns PARTIAL_SUCCESS and dualVerified=false when Instagram succeeds but Threads fails', async () => {
      const payload: ExactApprovalPayload = {
        workspaceId,
        contentId: 'content-test-1',
        contentVersion: 1,
        copyText: 'Dual channel test post',
        imageUrl: 'https://assets.sohee.ai/test-1.jpg',
        channelTargets: ['instagram', 'threads'],
        harnessVersions: {
          knowledgeVersionId: 'kv-1',
          textHarnessVersionId: 'tv-1',
          imageHarnessVersionId: 'iv-1',
          operatingPolicyVersionId: 'pv-1',
        },
        rightsAndConsent: {
          rightsStatus: 'GRANTED',
          consentStatus: 'GRANTED',
        },
      }

      const { computeExactApprovalFingerprint } = await import('@/features/publishing/dual-publish-coordinator')
      const fp = computeExactApprovalFingerprint(payload)

      const result = await executeDualChannelPublish({
        payload,
        approvalFingerprint: fp,
        executor: async (ch) => {
          if (ch === 'instagram') {
            return {
              success: true,
              nativePostId: 'ig-post-12345',
              liveUrl: 'https://www.instagram.com/p/ig12345/',
            }
          }
          throw new Error('Threads provider rate limited')
        },
      })

      expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
      expect(result.receipts.instagram.status).toBe('VERIFIED')
      expect(result.receipts.threads.status).toBe('FAILED')

      // Readiness evaluator MUST NOT mark dualVerified
      const readiness = evaluateDualChannelReadiness({
        instagram: { status: 'VERIFIED', verified: true },
        threads: { status: 'CONNECTED_UNVERIFIED', verified: false, blockerMessage: '스레드 실패' },
      })
      expect(readiness.dualVerified).toBe(false)
      expect(readiness.blockers.length).toBe(1)
    })
  })

  describe('4. Hardcoded Post ID / Fake Evidence Rejection Guard', () => {
    it('rejects synthetic and sample permalinks from passing readback verification', async () => {
      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'conn-ig-1',
                  channel: 'instagram',
                  status: 'connected',
                  access_token: 'valid-test-token',
                  external_account_id: 'ig-account-1',
                },
                error: null,
              }),
            }
          }
          if (table === 'external_action_requests' || table === 'external_action_attempts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const mockIgProvider = {
        publish: vi.fn().mockResolvedValue({ providerPostId: 'sample-post-id' }),
      }

      // Synthetic sample URL returned by mock/fake readback
      const mockReadback = vi.fn().mockResolvedValue('https://www.instagram.com/sample/test/')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        caption: 'Sample rejection test',
        mediaUrls: ['https://assets.sohee.ai/test-media.jpg'],
        adminClient: mockAdminClient as any,
        igProvider: mockIgProvider as any,
        readbackFn: mockReadback,
      })

      // Must be rejected and quarantined
      expect(result.status).toBe('VERIFYING')
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('RESULT_UNKNOWN')
    })
  })
})
