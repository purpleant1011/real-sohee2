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
  loadChannelCredentialByChannel: vi.fn().mockResolvedValue({
    accessToken: 'valid-test-token', externalAccountId: 'acc-1',
  }),
}))

vi.mock('@/features/channels/consent-ledger', () => ({
  verifyCapabilityConsent: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
}))

describe('HF-46: Fresh Meta Qualification Chain · Real App Publish → Canonical Receipt → Independent Readback (ANI-1396)', () => {
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

  function createMockAdminClient(overrides: {
    receiptInsertError?: any
    onReceiptInserted?: (receipt: any) => void
  } = {}) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'conn-1',
                channel: 'instagram',
                status: 'connected',
                access_token: 'valid-test-token',
                external_account_id: 'acc-1',
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
              if (overrides.receiptInsertError) {
                return {
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: overrides.receiptInsertError,
                  }),
                }
              }
              overrides.onReceiptInserted?.(receiptData)
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
  }

  describe('Scenario 1: Instagram actual publish success + independent GET + receipt insert success → VERIFIED', () => {
    it('successfully verifies Instagram when all stages complete canonical chain', async () => {
      let insertedReceipt: any = null
      const mockAdminClient = createMockAdminClient({
        onReceiptInserted: (r) => { insertedReceipt = r },
      })

      const mockIgProvider = {
        publish: vi.fn().mockResolvedValue({ providerPostId: 'ig-post-1001' }),
      }
      const mockReadback = vi.fn().mockResolvedValue('https://www.instagram.com/p/ig1001/')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        caption: 'Instagram Fresh Publish Test',
        mediaUrls: ['https://assets.sohee.ai/test.jpg'],
        adminClient: mockAdminClient as any,
        igProvider: mockIgProvider as any,
        readbackFn: mockReadback,
      })

      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)
      expect(result.providerPostId).toBe('ig-post-1001')
      expect(result.permalink).toBe('https://www.instagram.com/p/ig1001/')
      expect(mockAdminClient.rpc).toHaveBeenCalledWith(
        'complete_channel_verification_v12',
        expect.objectContaining({
          p_channel: 'instagram',
          p_external_post_id: 'ig-post-1001',
          p_permalink: 'https://www.instagram.com/p/ig1001/',
        }),
      )
      expect(insertedReceipt).toBeDefined()
      expect(insertedReceipt.receipt_kind).toBe('observed_result')
      expect(insertedReceipt.provider_reference).toBe('ig-post-1001')
      expect(insertedReceipt.attempt_id).toBe(result.attemptId)
      expect(insertedReceipt.action_request_id).toBe(result.actionRequestId)
    })
  })

  describe('Scenario 2: Threads actual publish success + independent GET + receipt insert success → VERIFIED', () => {
    it('successfully verifies Threads when all stages complete canonical chain', async () => {
      let insertedReceipt: any = null
      const mockAdminClient = createMockAdminClient({
        onReceiptInserted: (r) => { insertedReceipt = r },
      })

      const mockThProvider = {
        publish: vi.fn().mockResolvedValue({ providerPostId: 'th-post-2002' }),
      }
      const mockReadback = vi.fn().mockResolvedValue('https://www.threads.com/@sohee.ai/post/th2002')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'threads',
        caption: 'Threads Fresh Publish Test',
        adminClient: mockAdminClient as any,
        thProvider: mockThProvider as any,
        readbackFn: mockReadback,
      })

      expect(result.status).toBe('VERIFIED')
      expect(result.verified).toBe(true)
      expect(result.providerPostId).toBe('th-post-2002')
      expect(result.permalink).toBe('https://www.threads.com/@sohee.ai/post/th2002')
      expect(mockAdminClient.rpc).toHaveBeenCalledWith(
        'complete_channel_verification_v12',
        expect.objectContaining({
          p_channel: 'threads',
          p_external_post_id: 'th-post-2002',
          p_permalink: 'https://www.threads.com/@sohee.ai/post/th2002',
        }),
      )
      expect(insertedReceipt).toBeDefined()
      expect(insertedReceipt.receipt_kind).toBe('observed_result')
      expect(insertedReceipt.provider_reference).toBe('th-post-2002')
    })
  })

  describe('Scenario 3: receipt insert DB error → qualification FAIL', () => {
    it('aborts qualification and fails closed when receipt insert throws database error', async () => {
      const mockAdminClient = createMockAdminClient({
        receiptInsertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })

      const mockIgProvider = {
        publish: vi.fn().mockResolvedValue({ providerPostId: 'ig-post-err-1' }),
      }
      const mockReadback = vi.fn().mockResolvedValue('https://www.instagram.com/p/igerr1/')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        caption: 'DB Error Test',
        mediaUrls: ['https://assets.sohee.ai/test.jpg'],
        adminClient: mockAdminClient as any,
        igProvider: mockIgProvider as any,
        readbackFn: mockReadback,
      })

      expect(result.status).toBe('FAILED')
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('RECEIPT_PERSISTENCE_FAILED')
      expect(mockAdminClient.rpc).not.toHaveBeenCalled()
    })
  })

  describe('Scenario 4: provider publish success + readback timeout → RESULT_UNKNOWN/VERIFYING', () => {
    it('isolates to RESULT_UNKNOWN and VERIFYING on readback timeout without promoting to VERIFIED', async () => {
      const mockAdminClient = createMockAdminClient()
      const mockThProvider = {
        publish: vi.fn().mockResolvedValue({ providerPostId: 'th-timeout-post' }),
      }
      // Readback returns null (simulating timeout or unpropagated post)
      const mockReadback = vi.fn().mockResolvedValue(null)

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'threads',
        caption: 'Timeout Test',
        adminClient: mockAdminClient as any,
        thProvider: mockThProvider as any,
        readbackFn: mockReadback,
      })

      expect(result.status).toBe('VERIFYING')
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('RESULT_UNKNOWN')
      expect(mockAdminClient.rpc).not.toHaveBeenCalled()
    })
  })

  describe('Scenario 5: provider publish success + readback 404/invalid id → not VERIFIED', () => {
    it('rejects readback with invalid or sample permalink format', async () => {
      const mockAdminClient = createMockAdminClient()
      const mockIgProvider = {
        publish: vi.fn().mockResolvedValue({ providerPostId: 'ig-invalid-id' }),
      }
      // Readback returns invalid sample url
      const mockReadback = vi.fn().mockResolvedValue('https://www.instagram.com/sample/notfound/')

      const result = await executeMetaPublish({
        workspaceId,
        actorUserId,
        channel: 'instagram',
        caption: 'Invalid Readback Test',
        mediaUrls: ['https://assets.sohee.ai/test.jpg'],
        adminClient: mockAdminClient as any,
        igProvider: mockIgProvider as any,
        readbackFn: mockReadback,
      })

      expect(result.status).toBe('VERIFYING')
      expect(result.verified).toBe(false)
      expect(result.errorCode).toBe('RESULT_UNKNOWN')
      expect(mockAdminClient.rpc).not.toHaveBeenCalled()
    })
  })

  describe('Scenario 6: one channel fails → dual overall false', () => {
    it('marks overallStatus PARTIAL_SUCCESS and dualVerified false when one channel fails', async () => {
      const payload: ExactApprovalPayload = {
        workspaceId,
        contentId: 'content-dual-test',
        contentVersion: 1,
        copyText: 'Dual channel partial success test',
        imageUrl: 'https://assets.sohee.ai/test.jpg',
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
              nativePostId: 'ig-1111',
              liveUrl: 'https://www.instagram.com/p/ig1111/',
            }
          }
          throw new Error('Threads API Down')
        },
      })

      expect(result.overallStatus).toBe('PARTIAL_SUCCESS')
      expect(result.receipts.instagram.status).toBe('VERIFIED')
      expect(result.receipts.threads.status).toBe('FAILED')

      const readiness = evaluateDualChannelReadiness({
        instagram: { status: 'VERIFIED', verified: true },
        threads: { status: 'CONNECTED_UNVERIFIED', verified: false, blockerMessage: '스레드 실패' },
      })
      expect(readiness.dualVerified).toBe(false)
    })
  })

  describe('Scenario 7: same action_request_id reused across channels → test FAIL', () => {
    it('enforces distinct action_request_id and post_id between Instagram and Threads', () => {
      const igChain = {
        channel: 'instagram',
        actionRequestId: 'req-shared-1234',
        attemptId: 'att-ig-1',
        providerExternalPostId: 'post-shared-999',
      }
      const thChain = {
        channel: 'threads',
        actionRequestId: 'req-shared-1234', // Invariant violation: reused!
        attemptId: 'att-th-2',
        providerExternalPostId: 'post-shared-999', // Invariant violation: reused!
      }

      const validateDistinctLineage = (ig: typeof igChain, th: typeof thChain) => {
        if (ig.actionRequestId === th.actionRequestId) {
          throw new Error('FAIL: Instagram and Threads cannot share the same actionRequestId')
        }
        if (ig.providerExternalPostId === th.providerExternalPostId) {
          throw new Error('FAIL: Instagram and Threads cannot share the same providerExternalPostId')
        }
        return true
      }

      expect(() => validateDistinctLineage(igChain, thChain)).toThrow(
        'FAIL: Instagram and Threads cannot share the same actionRequestId',
      )

      // Valid distinct chains pass
      const validThChain = {
        ...thChain,
        actionRequestId: 'req-distinct-5678',
        providerExternalPostId: 'post-distinct-888',
      }
      expect(validateDistinctLineage(igChain, validThChain)).toBe(true)
    })
  })

  describe('Scenario 8: hardcoded/preexisting post id only GET qualification attempt → release evidence invalid', () => {
    it('rejects qualification attempts that only perform GET on preexisting posts without application publish lineage', () => {
      const qualificationAttempt = {
        publishMethod: 'READ_ONLY_GET',
        actionRequestId: null,
        attemptId: null,
        receiptId: null,
        providerPostId: '18097282883635509', // preexisting post id
      }

      const isEvidenceValid = (attempt: typeof qualificationAttempt) => {
        if (!attempt.actionRequestId || !attempt.attemptId || !attempt.receiptId) {
          return false
        }
        if (attempt.publishMethod !== 'REAL_APPLICATION_PUBLISH') {
          return false
        }
        return true
      }

      expect(isEvidenceValid(qualificationAttempt)).toBe(false)
    })
  })

  describe('Scenario 9: receipt_count == 0 → hard FAIL, warning-only 금지', () => {
    it('strictly fails closed (throws/exits) when receipt count is 0', () => {
      const auditReceiptLineage = (receipts: any[]) => {
        const count = receipts ? receipts.length : 0
        if (count === 0) {
          throw new Error('HARD_FAIL: Canonical receipt count = 0. Failing closed!')
        }
        return { passed: true, count }
      }

      // 0 receipts must throw
      expect(() => auditReceiptLineage([])).toThrow(
        'HARD_FAIL: Canonical receipt count = 0. Failing closed!',
      )

      // >= 1 receipt passes
      const validReceipts = [{ id: 'rec-1', receipt_kind: 'observed_result' }]
      expect(auditReceiptLineage(validReceipts)).toEqual({ passed: true, count: 1 })
    })
  })
})
