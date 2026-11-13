import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CanonicalPublishFacade } from '../canonical-publish-facade'
import {
  isSafeToRepublish,
  restoreExternalActionReceipt,
  createExternalActionReceipt,
  transitionReceiptState,
  type ExternalActionReceipt,
} from '../external-action-receipt-engine'
import { executeLivePublishSchedule } from '../actions/live-publish'
import { AutonomousPlannerService } from '@/features/autonomous-planner/planner-service'
import { MissionRecoveryService } from '@/lib/mission-os/mission-recovery-service'
import {
  validateApprovalForExecution,
  assertControlGateActionAllowed,
} from '@/lib/mission-os/mission-lineage-guard'
import type { MarketingMissionAggregate } from '@/lib/mission-os/mission-types'

vi.mock('server-only', () => ({}))

const liveMocks = vi.hoisted(() => ({
  material: vi.fn(),
  provider: vi.fn(),
  destination: vi.fn(),
  admission: vi.fn(),
  adminClient: vi.fn(),
  bundlePublish: vi.fn(),
}))

vi.mock('../creative-bundle-publishing-executor', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    executeCreativeBundlePublish: (...args: any[]) => liveMocks.bundlePublish(...args),
  }
})

vi.mock('../approved-publish-repository', () => ({
  loadApprovedPublishMaterial: liveMocks.material,
}))
vi.mock('../meta-publish-provider', () => ({
  publishApprovedMetaContent: liveMocks.provider,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => liveMocks.adminClient(),
}))
vi.mock('@/features/marketing-agent/engine/autonomy-execution-admission', () => ({
  checkAutonomyExecutionAdmission: liveMocks.admission,
  autonomyAdmissionMessage: (code: string) => `Admission blocked: ${code}`,
}))

function createChainableQuery(resolvedValue: any = { data: null, error: null }) {
  const obj: any = {
    select: vi.fn().mockImplementation(() => obj),
    eq: vi.fn().mockImplementation(() => obj),
    in: vi.fn().mockImplementation(() => obj),
    lt: vi.fn().mockImplementation(() => obj),
    gt: vi.fn().mockImplementation(() => obj),
    order: vi.fn().mockImplementation(() => obj),
    limit: vi.fn().mockImplementation(() => obj),
    single: vi.fn().mockImplementation(async () => resolvedValue),
    maybeSingle: vi.fn().mockImplementation(async () => resolvedValue),
    then: (resolve: any) => Promise.resolve(resolvedValue).then(resolve),
  }
  return obj
}

describe('Execution & Recovery Matrix (ANI-1845 / ANI-1881 / Task 7)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const actorUserId = '22222222-2222-4222-8222-222222222222'
  const missionId = '33333333-3333-4333-8333-333333333333'
  const scheduleId = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    liveMocks.material.mockResolvedValue({
      payload: { workspaceId },
      mediaUrls: ['https://example.com/image.jpg'],
    })
    liveMocks.admission.mockResolvedValue({ admitted: true })
    liveMocks.adminClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'schedules') {
          return createChainableQuery({ data: { content_id: 'content-1' }, error: null })
        }
        if (table === 'marketing_missions') {
          return createChainableQuery({ data: null, error: null })
        }
        return createChainableQuery({ data: null, error: null })
      },
    })
  })

  describe('1. verification_pending / partial success propagation to mission', () => {
    it('does NOT promote mission to PUBLISHED_VERIFIED when child channel is only VERIFICATION_PENDING', async () => {
      const updateMock = vi.fn()
      const insertMock = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({ data: null, error: null })
          }
          if (table === 'marketing_missions') {
            return {
              select: () =>
                createChainableQuery({
                  data: {
                    id: missionId,
                    workspace_id: workspaceId,
                    status: 'EXECUTING',
                    external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                    metadata: {},
                    updated_at: '2026-10-27T10:00:00.000Z',
                  },
                  error: null,
                }),
              update: (payload: any) => {
                updateMock(payload)
                return createChainableQuery({ data: [{ id: missionId }], error: null })
              },
            }
          }
          if (table === 'mission_events') {
            return { insert: insertMock }
          }
          return createChainableQuery({ data: null, error: null })
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase)
      liveMocks.bundlePublish.mockResolvedValue({
        ok: true,
        receiptId: 'rcpt-1',
        providerPostId: 'post-1',
        destinationUrl: 'https://instagram.com/p/1',
        verificationOutcome: 'VERIFICATION_PENDING',
        receiptState: 'VERIFICATION_PENDING',
      })

      const result = await facade.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        bundleId: 'bundle-1',
        expectedFingerprint: 'f'.repeat(64),
        actorUserId,
        actorRole: 'internal_operator',
        missionId,
      })

      // Facade overall status is PENDING, child is not fully verified yet
      expect(result.overallStatus).toBe('PENDING')
      expect(result.results.instagram.verified).toBe(false)
      expect(result.results.instagram.stage).toBe('VERIFICATION_PENDING')

      // Must NOT update mission to PUBLISHED_VERIFIED
      expect(updateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED_VERIFIED' })
      )
      // Instead, must remain in EXECUTING with WAITING_EXTERNAL execution_state
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'EXECUTING',
          metadata: expect.objectContaining({ execution_state: 'WAITING_EXTERNAL' }),
        })
      )
    })

    it('promotes mission to PUBLISHED_VERIFIED only when ALL requested channels are verified and sets OBSERVING execution_state', async () => {
      const updateMock = vi.fn()
      const insertMock = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({ data: null, error: null })
          }
          if (table === 'marketing_missions') {
            return {
              select: () =>
                createChainableQuery({
                  data: {
                    id: missionId,
                    workspace_id: workspaceId,
                    status: 'EXECUTING',
                    external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                    metadata: {},
                    updated_at: '2026-10-27T10:00:00.000Z',
                  },
                  error: null,
                }),
              update: (payload: any) => {
                updateMock(payload)
                return createChainableQuery({ data: [{ id: missionId }], error: null })
              },
            }
          }
          if (table === 'mission_events') {
            return { insert: insertMock }
          }
          return createChainableQuery({ data: null, error: null })
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase)
      liveMocks.bundlePublish.mockResolvedValue({
        ok: true,
        receiptId: 'rcpt-verified',
        providerPostId: 'post-verified',
        destinationUrl: 'https://instagram.com/p/verified',
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      })

      const result = await facade.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        bundleId: 'bundle-1',
        expectedFingerprint: 'f'.repeat(64),
        actorUserId,
        actorRole: 'internal_operator',
        missionId,
      })

      expect(result.overallStatus).toBe('ALL_VERIFIED')
      expect(result.results.instagram.verified).toBe(true)
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PUBLISHED_VERIFIED',
          provider_post_reference: 'post-verified',
          metadata: expect.objectContaining({ execution_state: 'OBSERVING' }),
        })
      )
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event_name: 'MISSION_PUBLISHED_VERIFIED',
          to_status: 'PUBLISHED_VERIFIED',
        })
      )
    })

    it('blocks promotion to PUBLISHED_VERIFIED when BOTH channels requested but one channel is missing or unverified', async () => {
      const updateMock = vi.fn()
      const insertMock = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase: any = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () =>
                createChainableQuery({
                  data: {
                    id: missionId,
                    workspace_id: workspaceId,
                    status: 'EXECUTING',
                    external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                    metadata: {},
                    updated_at: '2026-10-27T10:00:00.000Z',
                  },
                  error: null,
                }),
              update: (payload: any) => {
                updateMock(payload)
                return createChainableQuery({ data: [{ id: missionId }], error: null })
              },
            }
          }
          if (table === 'mission_events') {
            return { insert: insertMock }
          }
          return createChainableQuery({ data: null, error: null })
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase)
      // Only instagram succeeds, threads fails
      liveMocks.bundlePublish.mockImplementation(async (input: any) => {
        if (input.channel === 'instagram') {
          return {
            ok: true,
            receiptId: 'rcpt-ig',
            providerPostId: 'post-ig',
            destinationUrl: 'https://instagram.com/p/ig',
            verificationOutcome: 'VERIFIED',
            receiptState: 'VERIFIED',
          }
        }
        return {
          ok: false,
          receiptId: 'rcpt-th',
          errorCode: 'THREADS_TOKEN_EXPIRED',
          verificationOutcome: 'FAILED',
          receiptState: 'FAILED',
        }
      })

      const result = await facade.executePublish({
        workspaceId,
        channel: 'BOTH',
        bundleId: 'bundle-dual',
        expectedFingerprint: 'f'.repeat(64),
        actorUserId,
        actorRole: 'internal_operator',
        missionId,
      })

      // Overall status is PARTIAL_SUCCESS or similar, NOT ALL_VERIFIED
      expect(result.overallStatus).not.toBe('ALL_VERIFIED')
      // Must NOT update mission to PUBLISHED_VERIFIED
      expect(updateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED_VERIFIED' })
      )
    })

    it('blocks promotion to PUBLISHED_VERIFIED when verified child lacks concrete providerPostId or receiptId', async () => {
      const updateMock = vi.fn()
      const mockSupabase: any = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () =>
                createChainableQuery({
                  data: {
                    id: missionId,
                    workspace_id: workspaceId,
                    status: 'EXECUTING',
                    external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                    metadata: {},
                    updated_at: '2026-10-27T10:00:00.000Z',
                  },
                  error: null,
                }),
              update: (payload: any) => {
                updateMock(payload)
                return createChainableQuery({ data: [{ id: missionId }], error: null })
              },
            }
          }
          if (table === 'mission_events') {
            return { insert: vi.fn().mockResolvedValue({ error: null }) }
          }
          return createChainableQuery({ data: null, error: null })
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase)
      // Pretend outcome is VERIFIED but providerPostId is missing/null
      liveMocks.bundlePublish.mockResolvedValue({
        ok: true,
        receiptId: 'rcpt-missing-post',
        providerPostId: null, // concrete post ID missing!
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      })

      await facade.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        bundleId: 'bundle-missing-post',
        expectedFingerprint: 'f'.repeat(64),
        actorUserId,
        actorRole: 'internal_operator',
        missionId,
      })

      expect(updateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED_VERIFIED' })
      )
    })

    it('preserves PAUSED metadata.execution_state without promoting status even if all channels verified', async () => {
      const updateMock = vi.fn()
      const insertMock = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({ data: null, error: null })
          }
          if (table === 'marketing_missions') {
            return {
              select: () =>
                createChainableQuery({
                  data: {
                    id: missionId,
                    workspace_id: workspaceId,
                    status: 'APPROVED',
                    external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                    metadata: { execution_state: 'PAUSED' }, // Concurrent owner pause in dual-state model
                    updated_at: '2026-10-27T10:00:00.000Z',
                  },
                  error: null,
                }),
              update: (payload: any) => {
                updateMock(payload)
                return createChainableQuery({ data: [{ id: missionId }], error: null })
              },
            }
          }
          if (table === 'mission_events') {
            return { insert: insertMock }
          }
          return createChainableQuery({ data: null, error: null })
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase)
      liveMocks.bundlePublish.mockResolvedValue({
        ok: true,
        receiptId: 'rcpt-verified-during-pause',
        providerPostId: 'post-during-pause',
        destinationUrl: 'https://instagram.com/p/pause',
        verificationOutcome: 'VERIFIED',
        receiptState: 'VERIFIED',
      })

      const result = await facade.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        bundleId: 'bundle-1',
        expectedFingerprint: 'f'.repeat(64),
        actorUserId,
        actorRole: 'internal_operator',
        missionId,
      })

      expect(result.overallStatus).toBe('ALL_VERIFIED')
      // Status must NOT be overwritten to PUBLISHED_VERIFIED or EXECUTING
      expect(updateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED_VERIFIED' })
      )
      expect(updateMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'EXECUTING' })
      )
      // Evidence must be recorded safely without advancing execution state
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          external_action_receipt_id: 'rcpt-verified-during-pause',
          provider_post_reference: 'post-during-pause',
          metadata: expect.objectContaining({
            execution_state: 'PAUSED',
            last_observed_publish: expect.objectContaining({
              receiptId: 'rcpt-verified-during-pause',
              postId: 'post-during-pause',
            }),
          }),
        })
      )
      // No promotion event fired
      expect(insertMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ event_name: 'MISSION_PUBLISHED_VERIFIED' })
      )
    })
  })

  describe('2. response loss & record failure isolation to RESULT_UNKNOWN', () => {
    it('isolates containerSubmitted receipts to unsafe for blind republish even if FAILED', () => {
      const failedWithContainerReceipt: ExternalActionReceipt = {
        receiptId: 'rcpt-failed-cont',
        workspaceId,
        scheduleId,
        creativeBundleId: 'bundle-1',
        creativeFingerprint: 'f'.repeat(64),
        channel: 'instagram',
        orderedMediaSha256: ['hash1'],
        providerPayloadDigest: 'digest1',
        idempotencyKey: 'idem-1',
        state: 'FAILED',
        evidence: {
          containerSubmitted: true,
          providerContainerId: 'cont-12345',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const boundary = isSafeToRepublish(failedWithContainerReceipt)
      expect(boundary.safe).toBe(false)
      expect(boundary.stage).toBe('CONTAINER_SUBMITTED')
      expect(boundary.reason).toContain('컨테이너가 생성되었거나 전송이 시작되었을 가능성')
    })

    it('isolates dispatch network timeout to RESULT_UNKNOWN and unknown status', async () => {
      const rpcMock = vi.fn().mockImplementation(async (name: string) => {
        if (name === 'claim_publish_schedule') {
          return {
            data: {
              attemptId: '55555555-5555-4555-8555-555555555555',
              status: 'pending',
              providerReference: null,
              errorCode: null,
              isNew: true,
              workspaceId,
              scheduleId,
              versionId: '66666666-6666-4666-8666-666666666666',
              channelConnectionId: '77777777-7777-4777-8777-777777777777',
              channel: 'instagram',
              idempotencyKey: 'a'.repeat(64),
              contentFingerprint: 'b'.repeat(64),
            },
            error: null,
          }
        }
        if (name === 'record_claimed_publish_request') {
          return { data: '55555555-5555-4555-8555-555555555555', error: null }
        }
        if (name === 'complete_claimed_publish') {
          return { data: '55555555-5555-4555-8555-555555555555', error: null }
        }
        return { data: null, error: null }
      })

      // Simulate provider dispatch timeout after request ID was emitted
      liveMocks.provider.mockImplementationOnce(async ({ onProviderRequestId }) => {
        await onProviderRequestId('meta-req-999')
        throw new Error('ETIMEDOUT: network response timed out')
      })

      const outcome = await executeLivePublishSchedule(
        { workspaceId, scheduleId, actorUserId, trigger: 'user' },
        { rpc: rpcMock }
      )

      expect(outcome.data?.status).toBe('unknown')
      expect(outcome.data?.errorCode).toBe('RESULT_UNKNOWN')

      // complete_claimed_publish must receive 'unknown' status to lock attempt for reconciliation
      expect(rpcMock).toHaveBeenCalledWith('complete_claimed_publish', expect.objectContaining({
        p_status: 'unknown',
        p_error_code: 'RESULT_UNKNOWN',
        p_provider_request_id: 'meta-req-999',
      }))
    })
  })

  describe('3. pause epoch race & pre-send fence', () => {
    it('blocks NEW_WRITE immediately before send when mission is PAUSED or epoch is stale and releases claim lease', async () => {
      const mockSupabaseAdmin = {
        from: (table: string) => {
          if (table === 'schedules') {
            return createChainableQuery({ data: { content_id: 'content-1' }, error: null })
          }
          if (table === 'marketing_missions') {
            return createChainableQuery({
              data: {
                id: missionId,
                workspace_id: workspaceId,
                content_id: 'content-1',
                status: 'PAUSED',
                metadata: {
                  execution_state: 'PAUSED',
                  control_epoch: 2,
                },
              },
              error: null,
            })
          }
          return createChainableQuery({ data: null, error: null })
        },
      }
      liveMocks.adminClient.mockReturnValue(mockSupabaseAdmin)

      const rpcMock = vi.fn().mockImplementation(async (name: string) => {
        if (name === 'claim_publish_schedule') {
          return {
            data: {
              attemptId: '55555555-5555-4555-8555-555555555555',
              status: 'pending',
              providerReference: null,
              errorCode: null,
              isNew: true,
              workspaceId,
              scheduleId,
              versionId: '66666666-6666-4666-8666-666666666666',
              channelConnectionId: '77777777-7777-4777-8777-777777777777',
              channel: 'instagram',
              idempotencyKey: 'a'.repeat(64),
              contentFingerprint: 'b'.repeat(64),
            },
            error: null,
          }
        }
        if (name === 'complete_claimed_publish') {
          return { data: '55555555-5555-4555-8555-555555555555', error: null }
        }
        return { data: null, error: null }
      })

      const outcome = await executeLivePublishSchedule(
        {
          workspaceId,
          scheduleId,
          actorUserId,
          trigger: 'user',
          missionId,
          workerObservedEpoch: 1, // Stale epoch (1 vs 2)
        },
        { rpc: rpcMock }
      )

      expect(outcome.error?.message).toContain('새 발행이 안전하게 차단되었습니다')
      expect(liveMocks.material).toHaveBeenCalled() // Material was prepared before fence
      expect(liveMocks.provider).not.toHaveBeenCalled() // Dispatch was never started

      // Claim reservation must be cleanly released with MISSION_GATE_BLOCKED
      expect(rpcMock).toHaveBeenCalledWith('complete_claimed_publish', expect.objectContaining({
        p_status: 'failed',
        p_error_code: 'MISSION_GATE_BLOCKED',
      }))
    })

    it('fails closed and releases claim lease when schedule lineage DB query errors', async () => {
      const mockSupabaseAdmin = {
        from: (table: string) => {
          if (table === 'schedules') {
            return createChainableQuery({ data: null, error: { message: 'DB_CONNECTION_RESET' } })
          }
          return createChainableQuery({ data: null, error: null })
        },
      }
      liveMocks.adminClient.mockReturnValue(mockSupabaseAdmin)

      const rpcMock = vi.fn().mockImplementation(async (name: string) => {
        if (name === 'claim_publish_schedule') {
          return {
            data: {
              attemptId: '55555555-5555-4555-8555-555555555555',
              status: 'pending',
              providerReference: null,
              errorCode: null,
              isNew: true,
              workspaceId,
              scheduleId,
              versionId: '66666666-6666-4666-8666-666666666666',
              channelConnectionId: '77777777-7777-4777-8777-777777777777',
              channel: 'instagram',
              idempotencyKey: 'a'.repeat(64),
              contentFingerprint: 'b'.repeat(64),
            },
            error: null,
          }
        }
        if (name === 'complete_claimed_publish') {
          return { data: '55555555-5555-4555-8555-555555555555', error: null }
        }
        return { data: null, error: null }
      })

      const outcome = await executeLivePublishSchedule(
        { workspaceId, scheduleId, actorUserId, trigger: 'user' },
        { rpc: rpcMock }
      )

      expect(outcome.error?.message).toContain('발행 일정 계통을 조회하지 못했습니다')
      expect(liveMocks.provider).not.toHaveBeenCalled()
      expect(rpcMock).toHaveBeenCalledWith('complete_claimed_publish', expect.objectContaining({
        p_status: 'failed',
        p_error_code: 'SCHEDULE_LINEAGE_QUERY_FAILED',
      }))
    })

    it('preserves READBACK and RECONCILIATION even if mission executionState is PAUSED', () => {
      expect(() => {
        assertControlGateActionAllowed({
          executionState: 'PAUSED',
          actionType: 'READBACK',
          controlEpoch: 2,
          workerObservedEpoch: 1,
        })
      }).not.toThrow()

      expect(() => {
        assertControlGateActionAllowed({
          executionState: 'PAUSED',
          actionType: 'RECONCILIATION',
        })
      }).not.toThrow()
    })
  })

  describe('4. cron replay & atomic duplicate prevention in planner', () => {
    it('persists unapproved planned item via atomic RPC and fails closed with zero direct inserts on RPC failure', async () => {
      let directInsertAttempted = false
      const mockClientWithFailingRpc: any = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'RPC_UNAVAILABLE_OR_LOCKED' },
        }),
        from: (table: string) => ({
          insert: () => {
            directInsertAttempted = true
            return Promise.resolve({ error: null })
          },
        }),
      }

      const planner = new AutonomousPlannerService(mockClientWithFailingRpc)
      const slot = '2026-11-01T19:00:00.000Z'
      const item = {
        themeKey: 'story' as const,
        themeTitle: '가을 신메뉴 이야기',
        instagramCaption: '정성스런 가을 신메뉴를 선보입니다.',
        threadsText: '가을 신메뉴 출시!',
        scheduledSlot: slot,
        hashtags: ['신메뉴', '가을'],
      }

      const failRes = await planner.persistPlannedItem({
        workspaceId,
        item,
        actorUserId,
        approved: false,
      })

      // Fail-closed: Must return error and NEVER attempt direct table insertion fallback
      expect(failRes.success).toBe(false)
      expect(failRes.error).toBe('RPC_UNAVAILABLE_OR_LOCKED')
      expect(directInsertAttempted).toBe(false)
    })

    it('persists via atomic RPC and recognizes duplicate slot on cron replay', async () => {
      const persistedSlots = new Set<string>()
      const rpcMock = vi.fn().mockImplementation(async (name: string, args: any) => {
        if (name === 'persist_planned_content_draft') {
          const key = args.p_slot_idempotency_key
          if (persistedSlots.has(key)) {
            return {
              data: {
                success: true,
                is_duplicate: true,
                content_id: 'existing-content-id',
              },
              error: null,
            }
          }
          persistedSlots.add(key)
          return {
            data: {
              success: true,
              is_duplicate: false,
              content_id: 'new-content-id',
              version_id: 'new-version-id',
            },
            error: null,
          }
        }
        return { data: null, error: { message: 'unknown rpc' } }
      })

      const mockClient: any = { rpc: rpcMock }
      const planner = new AutonomousPlannerService(mockClient)
      const slot = '2026-11-01T19:00:00.000Z'
      const item = {
        themeKey: 'story' as const,
        themeTitle: '가을 신메뉴 이야기',
        instagramCaption: '정성스런 가을 신메뉴를 선보입니다.',
        threadsText: '가을 신메뉴 출시!',
        scheduledSlot: slot,
        hashtags: ['신메뉴', '가을'],
      }

      // First run: brand new item
      const firstRes = await planner.persistPlannedItem({
        workspaceId,
        item,
        actorUserId,
        approved: false,
      })
      expect(firstRes.success).toBe(true)
      expect(firstRes.isDuplicate).toBe(false)
      expect(firstRes.id).toBe('new-content-id')

      // Replay run: duplicate slot recognized
      const replayRes = await planner.persistPlannedItem({
        workspaceId,
        item,
        actorUserId,
        approved: false,
      })
      expect(replayRes.success).toBe(true)
      expect(replayRes.isDuplicate).toBe(true)
      expect(replayRes.id).toBe('existing-content-id')
    })
  })

  describe('5. contradictory receipt republish guard', () => {
    it('blocks republishing when containerSubmitted is true even if preContainerFailed flag contradicts it', () => {
      const contradictoryReceipt: ExternalActionReceipt = {
        receiptId: 'rcpt-contradictory',
        workspaceId,
        scheduleId,
        creativeBundleId: 'bundle-1',
        creativeFingerprint: 'f'.repeat(64),
        channel: 'instagram',
        orderedMediaSha256: ['hash1'],
        providerPayloadDigest: 'digest1',
        idempotencyKey: 'idem-1',
        state: 'FAILED',
        evidence: {
          containerSubmitted: true,
          preContainerFailed: true, // Contradictory flag
          providerContainerId: 'cont-999',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const boundary = isSafeToRepublish(contradictoryReceipt)
      expect(boundary.safe).toBe(false)
      expect(boundary.stage).toBe('CONTAINER_SUBMITTED')
      expect(boundary.reason).toContain('컨테이너가 생성되었거나 전송이 시작되었을 가능성')
    })

    it('blocks republishing when transport/dispatch evidence exists even if containerId is absent (response loss)', () => {
      const transportLossReceipt: ExternalActionReceipt = {
        receiptId: 'rcpt-transport-loss',
        workspaceId,
        scheduleId,
        creativeBundleId: 'bundle-1',
        creativeFingerprint: 'f'.repeat(64),
        channel: 'instagram',
        orderedMediaSha256: ['hash1'],
        providerPayloadDigest: 'digest1',
        idempotencyKey: 'idem-1',
        state: 'FAILED',
        evidence: {
          dispatchStarted: true,
          action_request_id: 'meta-req-loss',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const boundary = isSafeToRepublish(transportLossReceipt)
      expect(boundary.safe).toBe(false)
      expect(boundary.stage).toBe('CONTAINER_SUBMITTED')
      expect(boundary.reason).toContain('전송이 시작되었을 가능성이 있어')
    })

    it('blocks republishing for ambiguous legacy FAILED without confirmed pre-submit proof', () => {
      const ambiguousFailedReceipt: ExternalActionReceipt = {
        receiptId: 'rcpt-ambiguous-fail',
        workspaceId,
        scheduleId,
        creativeBundleId: 'bundle-1',
        creativeFingerprint: 'f'.repeat(64),
        channel: 'instagram',
        orderedMediaSha256: ['hash1'],
        providerPayloadDigest: 'digest1',
        idempotencyKey: 'idem-1',
        state: 'FAILED',
        evidence: {}, // No pre-submit proof, no container ID
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const boundary = isSafeToRepublish(ambiguousFailedReceipt)
      expect(boundary.safe).toBe(false)
      expect(boundary.stage).toBe('CONTAINER_SUBMITTED')
      expect(boundary.reason).toContain('응답 유실 여부가 불명확한 실패 상태')
    })

    it('allows republishing ONLY when confirmed pre-submit rejection (e.g. CONTROL_GATE_BLOCKED)', () => {
      const preSubmitFailedReceipt: ExternalActionReceipt = {
        receiptId: 'rcpt-pre-submit-fail',
        workspaceId,
        scheduleId,
        creativeBundleId: 'bundle-1',
        creativeFingerprint: 'f'.repeat(64),
        channel: 'instagram',
        orderedMediaSha256: ['hash1'],
        providerPayloadDigest: 'digest1',
        idempotencyKey: 'idem-1',
        state: 'FAILED',
        reasonCode: 'CONTROL_GATE_BLOCKED',
        evidence: {
          preContainerFailed: true,
          error: 'Mission paused by owner before send',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const boundary = isSafeToRepublish(preSubmitFailedReceipt)
      expect(boundary.safe).toBe(true)
      expect(boundary.stage).toBe('PRE_CONTAINER')
      expect(boundary.reason).toContain('공급자 제출 전 사전 거절')
    })

    it('fails closed on unrecognized or corrupted receipt states', () => {
      const corruptedReceipt: any = {
        receiptId: 'rcpt-corrupted',
        workspaceId,
        scheduleId,
        state: 'SOME_INVENTED_STATE',
        evidence: {},
      }

      const boundary = isSafeToRepublish(corruptedReceipt)
      expect(boundary.safe).toBe(false)
      expect(boundary.stage).toBe('CONTAINER_SUBMITTED')
      expect(boundary.reason).toContain('인식할 수 없거나 모호한 영수증 상태')
    })
  })

  describe('6. stale approval rejection', () => {
    it('rejects execution when content was modified after approval', () => {
      expect(() => {
        validateApprovalForExecution(
          {
            versionId: 'ver-1',
            versionNumber: 1,
            fingerprint: 'a'.repeat(64),
            isApproved: true,
            approvalId: 'appr-1',
          },
          {
            versionId: 'ver-2', // Content updated
            fingerprint: 'b'.repeat(64),
          }
        )
      }).toThrow(/APPROVAL_VERSION_STALE/)
    })
  })

  describe('7. recovery service unverified & cross-mission receipt elevation guard', () => {
    it('does NOT elevate interrupted mission to PUBLISHED_VERIFIED if receipt is not confirmed VERIFIED in DB', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-unconfirmed',
                workspace_id: workspaceId,
                state: 'RESULT_UNKNOWN',
                provider_post_id: null,
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const interruptedMission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-1',
        status: 'EXECUTING',
        goal: '새 게시물 홍보',
        external_action_request_id: 'req-1',
        external_action_receipt_id: 'rcpt-unconfirmed',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(interruptedMission)

      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
      expect(reconcile.isBlindRetryBlocked).toBe(true)
    })

    it('rejects contradictory receipt with state=FAILED and verified=true, returning RESULT_UNKNOWN', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-contradictory-fail',
                workspace_id: workspaceId,
                state: 'FAILED',
                verified: true, // Contradictory raw boolean
                provider_post_id: 'post-1234',
                channel: 'instagram',
                action_request_id: 'req-contra',
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-contra',
        status: 'EXECUTING',
        goal: '모순 영수증 검증 차단',
        external_action_request_id: 'req-contra',
        external_action_receipt_id: 'rcpt-contradictory-fail',
        metadata: { channel: 'instagram' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Must NOT be elevated to PUBLISHED_VERIFIED due to contradictory FAILED state
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
      expect(reconcile.isBlindRetryBlocked).toBe(true)
    })

    it('rejects receipt when required request_id correlation is missing', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-missing-req',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-5678',
                channel: 'instagram',
                // action_request_id intentionally missing!
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-req-corr',
        status: 'EXECUTING',
        goal: '상관관계 누락 차단',
        external_action_request_id: 'req-required-123',
        external_action_receipt_id: 'rcpt-missing-req',
        metadata: { channel: 'instagram' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Missing request_id correlation must fail closed to RESULT_UNKNOWN
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
    })

    it('rejects verified receipt lacking explicit channel evidence and prevents synthetic instagram default match', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-no-explicit-channel',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-no-channel-777',
                // channel, action_kind, additional_evidence.channel are ALL missing/empty!
                // restoreExternalActionReceipt would synthesize 'instagram' default,
                // but lineage guard must reject it due to absence of raw channel evidence!
                action_request_id: 'req-explicit-channel-test',
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-no-synth-channel',
        status: 'EXECUTING',
        goal: '합성 기본값 채널 매칭 차단',
        target_channel: 'instagram',
        external_action_request_id: 'req-explicit-channel-test',
        external_action_receipt_id: 'rcpt-no-explicit-channel',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Must fail closed because receipt lacks explicit channel evidence
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
      expect(reconcile.isBlindRetryBlocked).toBe(true)
    })

    it('rejects verified receipt with conflicting channel (e.g. threads vs instagram)', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-threads-channel',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-threads-888',
                channel: 'threads',
                action_request_id: 'req-conflict-channel',
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-channel-conflict',
        status: 'EXECUTING',
        goal: '채널 상충 차단',
        target_channel: 'instagram',
        external_action_request_id: 'req-conflict-channel',
        external_action_receipt_id: 'rcpt-threads-channel',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Conflicting channel must fail closed
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
    })

    it('rejects verified receipt when internal raw channel fields conflict (e.g. channel instagram vs action_kind threads_publish)', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-internal-conflict',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-conflict-999',
                channel: 'instagram',
                action_kind: 'threads_publish', // Conflicting internal evidence!
                action_request_id: 'req-internal-conflict',
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-internal-conflict',
        status: 'EXECUTING',
        goal: '영수증 내부 채널 상충 차단',
        target_channel: 'instagram',
        external_action_request_id: 'req-internal-conflict',
        external_action_receipt_id: 'rcpt-internal-conflict',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Internal conflicting channel fields must fail closed
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
    })

    it('blocks elevation when both mission and receipt lack explicit target channel', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-both-no-channel',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-both-no-ch',
                action_request_id: 'req-both-no-ch',
                // channel, action_kind intentionally missing
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-both-no-ch',
        status: 'EXECUTING',
        goal: '양측 채널 누락 차단',
        // target_channel & metadata.channel intentionally missing
        external_action_request_id: 'req-both-no-ch',
        external_action_receipt_id: 'rcpt-both-no-channel',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Both lacking channel must fail closed
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
    })

    it('blocks elevation when verified receipt belongs to a different mission in the same workspace', async () => {
      const otherMissionId = '99999999-9999-4999-8999-999999999999'
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-other-mission',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-1234',
                channel: 'instagram',
                action_request_id: 'other-request-id',
                additional_evidence: {
                  mission_id: otherMissionId, // Belongs to different mission!
                },
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
            }
          }
          if (table === 'mission_events') {
            return { insert: () => Promise.resolve({ error: null }) }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const currentMission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-curr',
        status: 'EXECUTING',
        goal: '다른 임무 게시물',
        external_action_request_id: 'curr-request-id',
        external_action_receipt_id: 'rcpt-other-mission',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const reconcile = await recovery.reconcileInterruptedMission(currentMission)

      // Cross-mission elevation must be blocked -> stays RESULT_UNKNOWN
      expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
      expect(reconcile.isBlindRetryBlocked).toBe(true)
    })

    it('fails closed when marketing_missions CAS update affects 0 rows (concurrent mutation)', async () => {
      const mockClient: any = {
        from: (table: string) => {
          if (table === 'external_action_receipts') {
            return createChainableQuery({
              data: {
                id: 'rcpt-verified-cas-race',
                workspace_id: workspaceId,
                state: 'VERIFIED',
                provider_post_id: 'post-race-999',
                channel: 'instagram',
                action_request_id: 'req-cas-race',
              },
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              // CAS update returns 0 rows due to concurrent updated_at / status mutation
              update: () => createChainableQuery({ data: [], error: null }),
            }
          }
          return createChainableQuery()
        },
      }

      const recovery = new MissionRecoveryService(mockClient)
      const mission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: 'trc-cas-fail',
        status: 'EXECUTING',
        goal: 'CAS 실패 감지',
        external_action_request_id: 'req-cas-race',
        external_action_receipt_id: 'rcpt-verified-cas-race',
        metadata: { channel: 'instagram' },
        created_at: new Date().toISOString(),
        updated_at: '2026-10-27T10:00:00.000Z',
      }

      const reconcile = await recovery.reconcileInterruptedMission(mission)

      // Fail-closed: Must return previousStatus and resumePoint NO_OP so caller doesn't assume success
      expect(reconcile.recoveredStatus).toBe('EXECUTING')
      expect(reconcile.resumePoint).toBe('NO_OP')
      expect(reconcile.actionTaken).toBe('CAS_UPDATE_REJECTED_CONCURRENT_MUTATION')
    })
  })

  describe('8. PR2412 review regression suite (4383885688, 4383885691, 4383885698, 4383885705)', () => {
    describe('Item 4383885688: persist_planned_content_draft RPC role guard', () => {
      it('rejects viewer role callers with PLANNED_CONTENT_FORBIDDEN and zero content persistence', async () => {
        let insertAttempted = false
        const mockClientWithViewerRole: any = {
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'PLANNED_CONTENT_FORBIDDEN' },
          }),
          from: () => ({
            insert: () => {
              insertAttempted = true
              return Promise.resolve({ error: null })
            },
          }),
        }

        const planner = new AutonomousPlannerService(mockClientWithViewerRole)
        const res = await planner.persistPlannedItem({
          workspaceId,
          item: {
            themeKey: 'story',
            themeTitle: '테스트',
            instagramCaption: '설명',
            threadsText: '텍스트',
            scheduledSlot: '2026-11-01T10:00:00.000Z',
            hashtags: ['tag'],
          },
          actorUserId,
          approved: false,
        })

        expect(res.success).toBe(false)
        expect(res.error).toBe('PLANNED_CONTENT_FORBIDDEN')
        expect(insertAttempted).toBe(false)
      })

      it('permits authorized content-writing roles (owner/manager/reviewer) via RPC', async () => {
        const mockClientWithWriterRole: any = {
          rpc: vi.fn().mockResolvedValue({
            data: {
              success: true,
              is_duplicate: false,
              content_id: 'draft-content-123',
              version_id: 'draft-version-456',
            },
            error: null,
          }),
        }

        const planner = new AutonomousPlannerService(mockClientWithWriterRole)
        const res = await planner.persistPlannedItem({
          workspaceId,
          item: {
            themeKey: 'story',
            themeTitle: '가을 신메뉴',
            instagramCaption: '가을 신메뉴 소개',
            threadsText: '신메뉴 출시',
            scheduledSlot: '2026-11-01T12:00:00.000Z',
            hashtags: ['신메뉴'],
          },
          actorUserId,
          approved: false,
        })

        expect(res.success).toBe(true)
        expect(res.id).toBe('draft-content-123')
        expect(res.isDuplicate).toBe(false)
      })
    })

    describe('Item 4383885691: live-publish control epoch propagation and stale worker barrier', () => {
      it('propagates claim-time control_epoch for callers without workerObservedEpoch (direct user/retry)', async () => {
        const mockSupabaseAdmin = {
          from: (table: string) => {
            if (table === 'schedules') {
              return createChainableQuery({ data: { content_id: 'content-1' }, error: null })
            }
            if (table === 'marketing_missions') {
              return createChainableQuery({
                data: {
                  id: missionId,
                  workspace_id: workspaceId,
                  content_id: 'content-1',
                  status: 'APPROVED',
                  metadata: {
                    control_epoch: 3,
                  },
                },
                error: null,
              })
            }
            return createChainableQuery({ data: null, error: null })
          },
        }
        liveMocks.adminClient.mockReturnValue(mockSupabaseAdmin)

        const rpcMock = vi.fn().mockImplementation(async (name: string) => {
          if (name === 'claim_publish_schedule') {
            return {
              data: {
                attemptId: '55555555-5555-4555-8555-555555555555',
                status: 'pending',
                providerReference: null,
                errorCode: null,
                isNew: true,
                workspaceId,
                scheduleId,
                versionId: '66666666-6666-4666-8666-666666666666',
                channelConnectionId: '77777777-7777-4777-8777-777777777777',
                channel: 'instagram',
                idempotencyKey: 'a'.repeat(64),
                contentFingerprint: 'b'.repeat(64),
              },
              error: null,
            }
          }
          if (name === 'complete_claimed_publish') {
            return { data: '55555555-5555-4555-8555-555555555555', error: null }
          }
          return { data: null, error: null }
        })

        liveMocks.provider.mockResolvedValue({
          ok: true,
          providerPostId: 'meta-live-post-1',
          destinationUrl: 'https://instagram.com/p/live1',
          errorCode: null,
        })

        // Call WITHOUT workerObservedEpoch (like a standard direct user trigger)
        const outcome = await executeLivePublishSchedule(
          {
            workspaceId,
            scheduleId,
            actorUserId,
            trigger: 'user',
            missionId,
            // workerObservedEpoch omitted!
          },
          { rpc: rpcMock }
        )

        expect(outcome.error).toBeUndefined()
        expect(outcome.data?.status).toBe('published')
        expect(liveMocks.provider).toHaveBeenCalled()
      })

      it('rejects stale worker with explicit stale workerObservedEpoch even if mission epoch is present', async () => {
        const mockSupabaseAdmin = {
          from: (table: string) => {
            if (table === 'schedules') {
              return createChainableQuery({ data: { content_id: 'content-1' }, error: null })
            }
            if (table === 'marketing_missions') {
              return createChainableQuery({
                data: {
                  id: missionId,
                  workspace_id: workspaceId,
                  content_id: 'content-1',
                  status: 'APPROVED',
                  metadata: {
                    control_epoch: 3,
                  },
                },
                error: null,
              })
            }
            return createChainableQuery({ data: null, error: null })
          },
        }
        liveMocks.adminClient.mockReturnValue(mockSupabaseAdmin)

        const rpcMock = vi.fn().mockImplementation(async (name: string) => {
          if (name === 'claim_publish_schedule') {
            return {
              data: {
                attemptId: '55555555-5555-4555-8555-555555555555',
                status: 'pending',
                providerReference: null,
                errorCode: null,
                isNew: true,
                workspaceId,
                scheduleId,
                versionId: '66666666-6666-4666-8666-666666666666',
                channelConnectionId: '77777777-7777-4777-8777-777777777777',
                channel: 'instagram',
                idempotencyKey: 'a'.repeat(64),
                contentFingerprint: 'b'.repeat(64),
              },
              error: null,
            }
          }
          if (name === 'complete_claimed_publish') {
            return { data: '55555555-5555-4555-8555-555555555555', error: null }
          }
          return { data: null, error: null }
        })

        // Stale worker passes epoch 2 when mission is epoch 3
        const outcome = await executeLivePublishSchedule(
          {
            workspaceId,
            scheduleId,
            actorUserId,
            trigger: 'background',
            missionId,
            workerObservedEpoch: 2,
          },
          { rpc: rpcMock }
        )

        expect(outcome.error?.message).toContain('새 발행이 안전하게 차단되었습니다')
        expect(liveMocks.provider).not.toHaveBeenCalled()
        expect(rpcMock).toHaveBeenCalledWith('complete_claimed_publish', expect.objectContaining({
          p_status: 'failed',
          p_error_code: 'MISSION_GATE_BLOCKED',
        }))
      })
    })

    describe('Item 4383885698: fail-closed to RESULT_UNKNOWN on mission lookup failure after provider success', () => {
      it('returns RESULT_UNKNOWN, preserves provider proof/post ID, and prohibits blind retry when mission lookup fails', async () => {
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({ data: null, error: null })
            }
            if (table === 'marketing_missions') {
              // Mission lookup fails after provider publish succeeded
              return {
                select: () =>
                  createChainableQuery({
                    data: null,
                    error: { message: 'DATABASE_TIMEOUT_DURING_MISSION_LOOKUP' },
                  }),
              }
            }
            return createChainableQuery({ data: null, error: null })
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        liveMocks.bundlePublish.mockResolvedValue({
          ok: true,
          receiptId: 'rcpt-prov-success',
          providerPostId: 'meta-post-98765',
          destinationUrl: 'https://instagram.com/p/98765',
          verificationOutcome: 'VERIFIED',
          receiptState: 'VERIFIED',
        })

        const result = await facade.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId: 'bundle-item3',
          expectedFingerprint: 'f'.repeat(64),
          actorUserId,
          actorRole: 'internal_operator',
          missionId,
          actionRequestId: 'a0000000-0000-4000-8000-000000000001',
        })

        // Must fail closed to RESULT_UNKNOWN
        expect(result.success).toBe(false)
        expect(result.overallStatus).toBe('RESULT_UNKNOWN')
        // Preserves provider post ID & receipt proof!
        expect(result.results.instagram.postId).toBe('meta-post-98765')
        expect(result.results.instagram.receiptId).toBe('rcpt-prov-success')
        expect(result.message).toContain('결과 확인이 필요합니다')
        expect(result.message).toContain('자동 재시도는 차단되었으며')
      })
    })

    describe('Item 4383885705: durable receipt correlation and strict recovery elevation', () => {
      it('promotes interrupted mission to PUBLISHED_VERIFIED when receipt contains durable mission_id anchor and is verified', async () => {
        const mockClient: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({
                data: {
                  id: 'rcpt-canonical-verified',
                  workspace_id: workspaceId,
                  state: 'VERIFIED',
                  channel: 'instagram',
                  provider_post_id: 'meta-verified-post-4321',
                  action_request_id: 'req-corr-canonical',
                  additional_evidence: {
                    mission_id: missionId,
                    action_request_id: 'req-corr-canonical',
                  },
                },
                error: null,
              })
            }
            if (table === 'marketing_missions') {
              return {
                update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
              }
            }
            if (table === 'mission_events') {
              return { insert: () => Promise.resolve({ error: null }) }
            }
            return createChainableQuery()
          },
        }

        const recovery = new MissionRecoveryService(mockClient)
        const mission: MarketingMissionAggregate = {
          id: missionId,
          workspace_id: workspaceId,
          trace_id: 'trc-recov-pass',
          status: 'EXECUTING',
          goal: '안전 복구 완료',
          target_channel: 'instagram',
          external_action_request_id: 'req-corr-canonical',
          external_action_receipt_id: 'rcpt-canonical-verified',
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const reconcile = await recovery.reconcileInterruptedMission(mission)

        expect(reconcile.recoveredStatus).toBe('PUBLISHED_VERIFIED')
        expect(reconcile.resumePoint).toBe('ADVANCE_TO_LISTENING')
        expect(reconcile.actionTaken).toBe('RESTORED_VERIFIED_PUBLISH_FROM_RECEIPT')
        expect(mission.metadata.provider_post_reference).toBe('meta-verified-post-4321')
      })

      it('rejects promotion when receipt belongs to a different workspace (tenant mismatch)', async () => {
        const foreignWorkspaceId = '88888888-8888-4888-8888-888888888888'
        const mockClient: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({
                data: {
                  id: 'rcpt-foreign-tenant',
                  workspace_id: foreignWorkspaceId, // Different workspace!
                  state: 'VERIFIED',
                  channel: 'instagram',
                  provider_post_id: 'post-foreign',
                  additional_evidence: { mission_id: missionId },
                },
                error: null,
              })
            }
            if (table === 'marketing_missions') {
              return {
                update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
              }
            }
            if (table === 'mission_events') {
              return { insert: () => Promise.resolve({ error: null }) }
            }
            return createChainableQuery()
          },
        }

        const recovery = new MissionRecoveryService(mockClient)
        const mission: MarketingMissionAggregate = {
          id: missionId,
          workspace_id: workspaceId,
          trace_id: 'trc-foreign',
          status: 'EXECUTING',
          goal: '타 테넌트 영수증 거절',
          target_channel: 'instagram',
          external_action_receipt_id: 'rcpt-foreign-tenant',
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const reconcile = await recovery.reconcileInterruptedMission(mission)

        expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
        expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
        expect(reconcile.isBlindRetryBlocked).toBe(true)
      })

      it('does NOT promote unverified PROVIDER_ACCEPTED receipt to PUBLISHED_VERIFIED based on assumption', async () => {
        const mockClient: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({
                data: {
                  id: 'rcpt-accepted-only',
                  workspace_id: workspaceId,
                  state: 'PROVIDER_ACCEPTED', // Not VERIFIED!
                  channel: 'instagram',
                  provider_post_id: 'post-unverified-id',
                  action_request_id: 'req-accepted-only',
                  additional_evidence: {
                    mission_id: missionId,
                    action_request_id: 'req-accepted-only',
                  },
                },
                error: null,
              })
            }
            if (table === 'marketing_missions') {
              return {
                update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
              }
            }
            if (table === 'mission_events') {
              return { insert: () => Promise.resolve({ error: null }) }
            }
            return createChainableQuery()
          },
        }

        const recovery = new MissionRecoveryService(mockClient)
        const mission: MarketingMissionAggregate = {
          id: missionId,
          workspace_id: workspaceId,
          trace_id: 'trc-accepted',
          status: 'EXECUTING',
          goal: '미검증 상태 승격 금지',
          target_channel: 'instagram',
          external_action_request_id: 'req-accepted-only',
          external_action_receipt_id: 'rcpt-accepted-only',
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const reconcile = await recovery.reconcileInterruptedMission(mission)

        expect(reconcile.recoveredStatus).toBe('RESULT_UNKNOWN')
        expect(reconcile.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')
        expect(reconcile.isBlindRetryBlocked).toBe(true)
      })
    })

    describe('Coordinator refinement: SQL contract validation for migration 20261027160100', () => {
      it('verifies migration file exists, is non-overlapping, and enforces exact role guard', () => {
        const migrationPath = resolve(__dirname, '../../../../supabase/migrations/20261027160100_ani1845_persist_planned_content_role_guard.sql')
        expect(existsSync(migrationPath)).toBe(true)

        const sql = readFileSync(migrationPath, 'utf-8')
        expect(sql).toContain('create or replace function public.persist_planned_content_draft')
        expect(sql).toContain('security definer')
        expect(sql).toContain("set search_path = ''")
        expect(sql).toContain('auth.uid() <> p_actor_user_id')
        expect(sql).toContain("raise exception 'PLANNED_CONTENT_IMPERSONATION_FORBIDDEN'")
        expect(sql).toContain("member.role in ('owner', 'manager', 'reviewer')")
        expect(sql).toContain("raise exception 'PLANNED_CONTENT_FORBIDDEN'")

        const roleInMatch = sql.match(/member\.role in \(([^)]+)\)/)?.[1]
        expect(roleInMatch).toBeDefined()
        expect(roleInMatch).not.toContain("'viewer'")
        expect(roleInMatch).toContain("'owner'")
        expect(roleInMatch).toContain("'manager'")
        expect(roleInMatch).toContain("'reviewer'")
      })
    })

    describe('Coordinator refinement: explicit invalid workerObservedEpoch fails closed without fallback', () => {
      it.each([
        ['NaN', NaN],
        ['fractional', 1.5],
        ['negative', -1],
      ])('fails closed immediately when workerObservedEpoch is %s', async (_, invalidEpoch) => {
        const rpcMock = vi.fn().mockImplementation((name: string) => {
          if (name === 'claim_publish_schedule' || name === 'claim_due_publish_schedule') {
            return {
              data: {
                attemptId: '55555555-5555-4555-8555-555555555555',
                status: 'pending',
                providerReference: null,
                errorCode: null,
                isNew: true,
                workspaceId,
                scheduleId,
                versionId: '66666666-6666-4666-8666-666666666666',
                channelConnectionId: '77777777-7777-4777-8777-777777777777',
                channel: 'instagram',
                idempotencyKey: 'a'.repeat(64),
                contentFingerprint: 'b'.repeat(64),
              },
              error: null,
            }
          }
          if (name === 'complete_claimed_publish') {
            return { data: '55555555-5555-4555-8555-555555555555', error: null }
          }
          return { data: null, error: null }
        })

        const outcome = await executeLivePublishSchedule(
          {
            workspaceId,
            scheduleId,
            actorUserId,
            trigger: 'background',
            missionId,
            workerObservedEpoch: invalidEpoch as any,
          },
          { rpc: rpcMock }
        )

        expect(outcome.error?.message).toContain('제어 정보가 올바르지 않아 발행을 중단했습니다.')
        expect(liveMocks.provider).not.toHaveBeenCalled()
        expect(rpcMock).toHaveBeenCalledWith('complete_claimed_publish', expect.objectContaining({
          p_status: 'failed',
          p_error_code: 'INVALID_WORKER_OBSERVED_EPOCH',
        }))
      })
    })

    describe('Coordinator refinement: facade mission lineage update failures fail closed to RESULT_UNKNOWN', () => {
      it('fails closed to RESULT_UNKNOWN when waiting-verification update fails', async () => {
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({ data: null, error: null })
            }
            if (table === 'marketing_missions') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () =>
                        Promise.resolve({
                          data: {
                            id: missionId,
                            status: 'APPROVED',
                            external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                                    external_action_receipt_id: null,
                            provider_post_reference: null,
                            metadata: {},
                            updated_at: '2026-10-27T10:00:00.000Z',
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
                update: () => ({
                  eq: () => ({
                    eq: () => ({
                      in: () => ({
                        eq: () => ({
                          select: () =>
                            Promise.resolve({
                              data: null,
                              error: { message: 'DB_CONNECTION_LOST' },
                            }),
                        }),
                      }),
                    }),
                  }),
                }),
              }
            }
            if (table === 'mission_events') {
              return { insert: () => Promise.resolve({ error: null }) }
            }
            return createChainableQuery({ data: null, error: null })
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        liveMocks.bundlePublish.mockResolvedValue({
          ok: true,
          receiptId: 'rcpt-lineage-fail',
          providerPostId: 'meta-post-lineage',
          destinationUrl: 'https://instagram.com/p/lineage',
          verificationOutcome: 'VERIFICATION_PENDING',
          receiptState: 'PROVIDER_ACCEPTED',
        })

        const result = await facade.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId: 'bundle-lineage-1',
          expectedFingerprint: 'e'.repeat(64),
          actorUserId,
          actorRole: 'internal_operator',
          missionId,
        })

        expect(result.success).toBe(false)
        expect(result.overallStatus).toBe('RESULT_UNKNOWN')
        expect(result.message).toContain('결과 확인이 필요합니다')
        expect(result.message).toContain('자동 재시도는 차단되었으며')
      })

      it('fails closed to RESULT_UNKNOWN when mission event insert fails', async () => {
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({ data: null, error: null })
            }
            if (table === 'marketing_missions') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () =>
                        Promise.resolve({
                          data: {
                            id: missionId,
                            status: 'APPROVED',
                            external_action_request_id: 'a0000000-0000-4000-8000-000000000001',
                                    external_action_receipt_id: null,
                            provider_post_reference: null,
                            metadata: {},
                            updated_at: '2026-10-27T10:00:00.000Z',
                          },
                          error: null,
                        }),
                    }),
                  }),
                }),
                update: () => ({
                  eq: () => ({
                    eq: () => ({
                      in: () => ({
                        eq: () => ({
                          select: () =>
                            Promise.resolve({
                              data: [{ id: missionId }],
                              error: null,
                            }),
                        }),
                      }),
                    }),
                  }),
                }),
              }
            }
            if (table === 'mission_events') {
              return {
                insert: () =>
                  Promise.resolve({
                    error: { message: 'EVENT_INSERT_CONSTRAINT_VIOLATION' },
                  }),
              }
            }
            return createChainableQuery({ data: null, error: null })
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        liveMocks.bundlePublish.mockResolvedValue({
          ok: true,
          receiptId: 'rcpt-event-fail',
          providerPostId: 'meta-post-event',
          destinationUrl: 'https://instagram.com/p/event',
          verificationOutcome: 'VERIFIED',
          receiptState: 'VERIFIED',
        })

        const result = await facade.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId: 'bundle-event-1',
          expectedFingerprint: 'f'.repeat(64),
          actorUserId,
          actorRole: 'internal_operator',
          missionId,
        })

        expect(result.success).toBe(false)
        expect(result.overallStatus).toBe('RESULT_UNKNOWN')
        expect(result.message).toContain('결과 확인이 필요합니다')
      })
    })

    describe('Coordinator refinement: receipt recording schema alignment and restore-to-recovery chain', () => {
      it('executes real executor through facade production recordReceipt to DB row, restore, and recovery', async () => {
        const { executeCreativeBundlePublish: realExecute } = await vi.importActual<any>('../creative-bundle-publishing-executor')

        const receiptStore = new Map<string, any>()
        const recordedRows: any[] = []
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return {
                insert: vi.fn().mockImplementation((payload: any) => {
                  if (receiptStore.has(payload.id)) {
                    return Promise.resolve({
                      data: null,
                      error: { message: `duplicate key value violates unique constraint "external_action_receipts_pkey"` },
                    })
                  }
                  if (!payload.workspace_id || !payload.action_request_id || !payload.recorded_by || !payload.receipt_kind) {
                    return Promise.resolve({
                      data: null,
                      error: { message: `null value in column violates not-null constraint` },
                    })
                  }
                  receiptStore.set(payload.id, { ...payload })
                  recordedRows.push({ ...payload })
                  return Promise.resolve({ data: [payload], error: null })
                }),
                update: vi.fn().mockImplementation(() => {
                  // Simulates PostgreSQL trigger external_action_receipts_immutable
                  return Promise.resolve({
                    data: null,
                    error: { message: 'EXTERNAL_RECEIPT_IMMUTABLE: receipt rows are append-only' },
                  })
                }),
                upsert: vi.fn().mockImplementation((payload: any) => {
                  // In Postgres, upsert on conflict 'id' performs an UPDATE when the key exists!
                  if (receiptStore.has(payload.id)) {
                    return Promise.resolve({
                      data: null,
                      error: { message: 'EXTERNAL_RECEIPT_IMMUTABLE: cannot update immutable table' },
                    })
                  }
                  receiptStore.set(payload.id, { ...payload })
                  recordedRows.push({ ...payload })
                  return Promise.resolve({ data: [payload], error: null })
                }),
                select: () => createChainableQuery({ data: null, error: null }),
              }
            }
            return createChainableQuery({ data: null, error: null })
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        const deps = facade.buildProductionDependencies()

        const actionRequestId = '33333333-3333-4333-8333-333333333333'
        const scheduleIdVal = '44444444-4444-4444-8444-444444444444'
        const bundleIdVal = '66666666-6666-4666-8666-666666666666'

        const executorDeps = {
          loadApprovedBundle: vi.fn().mockResolvedValue({
            bundleId: bundleIdVal,
            workspaceId,
            approvalStatus: 'APPROVED',
            bundleFingerprint: 'f'.repeat(64),
            channel: 'instagram',
            orderedMedia: [{ mediaAssetId: 'asset-chain-1', sha256Digest: 'd'.repeat(64) }],
            caption: 'caption text',
            creativeBriefVersion: '1.0',
            hashtags: [],
          }),
          loadMediaAsset: vi.fn().mockResolvedValue({
            publish_eligibility: true,
            lifecycle_status: 'READY',
            sha256_digest: 'd'.repeat(64),
          }),
          loadOrCreatePublishRendition: vi.fn().mockResolvedValue({
            id: 'rend-chain-1',
            workspace_id: workspaceId,
            storage_bucket: 'assets',
            object_path: 'images/chain.jpg',
          }),
          leaseGateway: {
            createSignedUrl: vi.fn().mockResolvedValue({
              signedUrl: 'https://cdn.example.com/chain.jpg',
              error: null,
            }),
            probeUrl: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'image/jpeg',
            }),
          },
          loadCredential: vi.fn().mockResolvedValue({
            accessToken: 'token-chain-123',
            externalAccountId: 'act-chain-123',
          }),
          providerPublish: vi.fn().mockResolvedValue({
            providerPostId: 'meta-real-post-777',
            destinationUrl: 'https://instagram.com/p/real777',
          }),
          readbackDependencies: {
            fetchPublishedPost: vi.fn().mockResolvedValue({
              providerPostId: 'meta-real-post-777',
              channel: 'instagram',
              permalink: 'https://instagram.com/p/real777',
              caption: 'caption text',
              mediaItems: [{ id: 'item-1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.example.com/image.jpg', position: 0 }],
              timestamp: new Date().toISOString(),
            }),
            computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.99 }),
          },
          assertMissionGateAllowed: vi.fn().mockResolvedValue(undefined),
          recordReceipt: deps.recordReceipt,
        }

        const publishOutcome = await realExecute(
          {
            workspaceId,
            scheduleId: scheduleIdVal,
            creativeBundleId: bundleIdVal,
            expectedFingerprint: 'f'.repeat(64),
            channelConnectionId: 'conn-chain-1',
            actorUserId,
            targetChannel: 'instagram',
            missionId,
            actionRequestId,
          },
          executorDeps
        )

        expect(publishOutcome.ok).toBe(true)
        expect(publishOutcome.verificationOutcome).toBe('VERIFIED')
        expect(publishOutcome.receiptState).toBe('VERIFIED')
        expect(publishOutcome.providerPostId).toBe('meta-real-post-777')

        // Assert that all pipeline stages were inserted append-only with distinct UUIDs
        expect(recordedRows.length).toBeGreaterThanOrEqual(4)
        const allIds = new Set(recordedRows.map((r) => r.id))
        expect(allIds.size).toBe(recordedRows.length)

        // Last inserted row must represent the VERIFIED receipt
        const finalRow = recordedRows[recordedRows.length - 1]
        expect(finalRow).toBeDefined()
        expect(finalRow.id).toBe(publishOutcome.receiptId)
        expect(finalRow.workspace_id).toBe(workspaceId)
        expect(finalRow.schedule_id).toBe(scheduleIdVal)
        expect(finalRow.bundle_id).toBe(bundleIdVal)
        expect(finalRow.action_kind).toBe('instagram_publish')
        expect(finalRow.state).toBe('VERIFIED')
        expect(finalRow.receipt_kind).toBe('observed_result')
        // Crucial schema check: recorded_by and action_request_id are populated from actorUserId and actionRequestId!
        expect(finalRow.recorded_by).toBe(actorUserId)
        expect(finalRow.action_request_id).toBe(actionRequestId)
        expect(finalRow.provider_reference).toBe('meta-real-post-777')
        expect(finalRow.result_url).toBe('https://instagram.com/p/real777')
        expect(finalRow.additional_evidence.mission_id).toBe(missionId)
        expect(finalRow.additional_evidence.action_request_id).toBe(actionRequestId)
        expect(finalRow.additional_evidence.actor_user_id).toBe(actorUserId)
        expect(finalRow.additional_evidence.providerPostId).toBe('meta-real-post-777')
        // Non-existent DB columns are not in the payload
        expect(finalRow).not.toHaveProperty('provider_post_id')
        expect(finalRow).not.toHaveProperty('destination_url')

        // Test restoreExternalActionReceipt parses the DB row properly
        const restored = restoreExternalActionReceipt(finalRow)
        expect(restored.receiptId).toBe(publishOutcome.receiptId)
        expect(restored.providerPostId).toBe('meta-real-post-777')
        expect(restored.permalink).toBe('https://instagram.com/p/real777')
        expect(restored.evidence?.mission_id).toBe(missionId)
        expect(restored.evidence?.action_request_id).toBe(actionRequestId)
        expect(restored.evidence?.actor_user_id).toBe(actorUserId)

        // Test MissionRecoveryService reconciliation with the restored row
        const mockClient: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({
                data: finalRow,
                error: null,
              })
            }
            if (table === 'marketing_missions') {
              return {
                update: () => createChainableQuery({ data: [{ id: missionId }], error: null }),
              }
            }
            if (table === 'mission_events') {
              return { insert: () => Promise.resolve({ error: null }) }
            }
            return createChainableQuery()
          },
        }

        const recovery = new MissionRecoveryService(mockClient)
        const mission: MarketingMissionAggregate = {
          id: missionId,
          workspace_id: workspaceId,
          trace_id: 'trc-chain-test',
          status: 'EXECUTING',
          goal: '체인 복구 테스트',
          target_channel: 'instagram',
          external_action_request_id: actionRequestId,
          external_action_receipt_id: publishOutcome.receiptId,
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const reconcile = await recovery.reconcileInterruptedMission(mission)
        expect(reconcile.recoveredStatus).toBe('PUBLISHED_VERIFIED')
        expect(reconcile.resumePoint).toBe('ADVANCE_TO_LISTENING')
        expect(reconcile.actionTaken).toBe('RESTORED_VERIFIED_PUBLISH_FROM_RECEIPT')
      })

      it('asserts saga execute forwards scheduleId, actionRequestId, missionId, and actorUserId', async () => {
        const { MultiChannelPublishSaga } = await vi.importActual<any>('../multi-channel-parent-saga')

        let capturedPublishInput: any = null
        const mockSagaDeps = {
          loadExistingReceipt: vi.fn().mockResolvedValue(null),
          publishChannel: vi.fn().mockImplementation(async (input: any) => {
            capturedPublishInput = input
            return {
              ok: true,
              receiptId: 'rcpt-saga-fwd',
              providerPostId: 'meta-post-fwd',
              destinationUrl: 'https://instagram.com/p/fwd',
              verificationOutcome: 'VERIFIED',
              receiptState: 'VERIFIED',
            }
          }),
        }

        const saga = new MultiChannelPublishSaga(mockSagaDeps)
        const actionReqId = '11111111-1111-4111-8111-111111111111'
        const schedId = '22222222-2222-4222-8222-222222222222'

        await saga.execute({
          workspaceId,
          bundleId: 'bundle-saga-1',
          expectedFingerprint: 'f'.repeat(64),
          channel: 'INSTAGRAM',
          actorUserId,
          missionId,
          scheduleId: schedId,
          actionRequestId: actionReqId,
          workerObservedEpoch: 4,
        })

        expect(capturedPublishInput).not.toBeNull()
        expect(capturedPublishInput.workspaceId).toBe(workspaceId)
        expect(capturedPublishInput.actorUserId).toBe(actorUserId)
        expect(capturedPublishInput.missionId).toBe(missionId)
        expect(capturedPublishInput.scheduleId).toBe(schedId)
        expect(capturedPublishInput.actionRequestId).toBe(actionReqId)
        expect(capturedPublishInput.workerObservedEpoch).toBe(4)
      })
    })

    describe('Coordinator refinement: executor post-dispatch recordReceipt error isolates to RESULT_UNKNOWN', () => {
      it('preserves providerPostId and returns RESULT_UNKNOWN without downgrading to PROVIDER_REJECTED/FAILED when PROVIDER_ACCEPTED record throws', async () => {
        const { executeCreativeBundlePublish: realExecute } = await vi.importActual<any>('../creative-bundle-publishing-executor')

        let recordCallCount = 0
        const fakeDeps = {
          loadApprovedBundle: vi.fn().mockResolvedValue({
            bundleId: 'bundle-real-1',
            workspaceId,
            approvalStatus: 'APPROVED',
            bundleFingerprint: 'f'.repeat(64),
            channel: 'instagram',
            orderedMedia: [{ mediaAssetId: 'asset-1', sha256Digest: 'd'.repeat(64) }],
            caption: 'caption text',
            creativeBriefVersion: '1.0',
            hashtags: [],
          }),
          loadMediaAsset: vi.fn().mockResolvedValue({
            publish_eligibility: true,
            lifecycle_status: 'READY',
            sha256_digest: 'd'.repeat(64),
          }),
          loadOrCreatePublishRendition: vi.fn().mockResolvedValue({
            id: 'rend-1',
            workspace_id: workspaceId,
            storage_bucket: 'assets',
            object_path: 'images/asset1.jpg',
          }),
          leaseGateway: {
            createSignedUrl: vi.fn().mockResolvedValue({
              signedUrl: 'https://cdn.example.com/image.jpg',
              error: null,
            }),
            probeUrl: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'image/jpeg',
            }),
          },
          loadCredential: vi.fn().mockResolvedValue({
            accessToken: 'token-123',
            externalAccountId: 'act-123',
          }),
          providerPublish: vi.fn().mockResolvedValue({
            providerPostId: 'meta-post-survived',
            destinationUrl: 'https://instagram.com/p/survived',
          }),
          readbackDependencies: {},
          recordReceipt: vi.fn().mockImplementation(async () => {
            recordCallCount++
            // Call 1 (initial receipt): ok
            // Call 2 (containerSubmitted): ok
            // Call 3 (PROVIDER_ACCEPTED): throw error!
            if (recordCallCount === 3) {
              throw new Error('DATABASE_RECORD_RECEIPT_CRASH')
            }
          }),
        }

        const outcome = await realExecute(
          {
            workspaceId,
            scheduleId: 'sched-real-1',
            creativeBundleId: 'bundle-real-1',
            expectedFingerprint: 'f'.repeat(64),
            channelConnectionId: 'conn-1',
            actorUserId,
            targetChannel: 'instagram',
          },
          fakeDeps
        )

        expect(outcome.ok).toBe(false)
        expect(outcome.receiptState).toBe('RESULT_UNKNOWN')
        expect(outcome.verificationOutcome).toBe('RESULT_UNKNOWN')
        expect(outcome.providerPostId).toBe('meta-post-survived')
        expect(outcome.errorCode).toBe('RECEIPT_RECORDING_FAILED')
        expect(outcome.errorMessage).toContain('결과 확인이 필요합니다')
        expect(outcome.errorMessage).toContain('자동 재시도는 차단되었습니다')
      })

      it('preserves providerPostId and returns RESULT_UNKNOWN when readback verification throws error', async () => {
        const { executeCreativeBundlePublish: realExecute } = await vi.importActual<any>('../creative-bundle-publishing-executor')

        const fakeDeps = {
          loadApprovedBundle: vi.fn().mockResolvedValue({
            bundleId: 'bundle-readback-err',
            workspaceId,
            approvalStatus: 'APPROVED',
            bundleFingerprint: 'f'.repeat(64),
            channel: 'instagram',
            orderedMedia: [{ mediaAssetId: 'asset-1', sha256Digest: 'd'.repeat(64) }],
            caption: 'caption text',
            creativeBriefVersion: '1.0',
            hashtags: [],
          }),
          loadMediaAsset: vi.fn().mockResolvedValue({
            publish_eligibility: true,
            lifecycle_status: 'READY',
            sha256_digest: 'd'.repeat(64),
          }),
          loadOrCreatePublishRendition: vi.fn().mockResolvedValue({
            id: 'rend-1',
            workspace_id: workspaceId,
            storage_bucket: 'assets',
            object_path: 'images/asset1.jpg',
          }),
          leaseGateway: {
            createSignedUrl: vi.fn().mockResolvedValue({
              signedUrl: 'https://cdn.example.com/image.jpg',
              error: null,
            }),
            probeUrl: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'image/jpeg',
            }),
          },
          loadCredential: vi.fn().mockResolvedValue({
            accessToken: 'token-123',
            externalAccountId: 'act-123',
          }),
          providerPublish: vi.fn().mockResolvedValue({
            providerPostId: 'meta-readback-survived',
            destinationUrl: 'https://instagram.com/p/readback-survived',
          }),
          readbackDependencies: {
            fetchPublishedPost: vi.fn().mockResolvedValue({
              providerPostId: 'meta-readback-survived',
              channel: 'instagram',
              permalink: 'https://instagram.com/p/readback-survived',
              caption: 'caption text',
              mediaItems: [{ id: 'item-1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.example.com/image.jpg', position: 0 }],
              timestamp: new Date().toISOString(),
            }),
            computePerceptualSimilarity: vi.fn().mockRejectedValue(new Error('READBACK_SERVICE_TIMEOUT')),
          },
          recordReceipt: vi.fn().mockResolvedValue(undefined),
        }

        const outcome = await realExecute(
          {
            workspaceId,
            scheduleId: 'sched-readback-err',
            creativeBundleId: 'bundle-readback-err',
            expectedFingerprint: 'f'.repeat(64),
            channelConnectionId: 'conn-1',
            actorUserId,
            targetChannel: 'instagram',
          },
          fakeDeps
        )

        expect(outcome.ok).toBe(false)
        expect(outcome.receiptState).toBe('RESULT_UNKNOWN')
        expect(outcome.verificationOutcome).toBe('RESULT_UNKNOWN')
        expect(outcome.providerPostId).toBe('meta-readback-survived')
        expect(outcome.errorCode).toBe('POST_DISPATCH_VERIFICATION_FAILED')
        expect(outcome.errorMessage).toContain('결과 확인이 필요합니다')
      })

      it('preserves providerPostId and returns RESULT_UNKNOWN when final recordReceipt throws error', async () => {
        const { executeCreativeBundlePublish: realExecute } = await vi.importActual<any>('../creative-bundle-publishing-executor')

        let recordCallCount = 0
        const fakeDeps = {
          loadApprovedBundle: vi.fn().mockResolvedValue({
            bundleId: 'bundle-final-rec-err',
            workspaceId,
            approvalStatus: 'APPROVED',
            bundleFingerprint: 'f'.repeat(64),
            channel: 'instagram',
            orderedMedia: [{ mediaAssetId: 'asset-1', sha256Digest: 'd'.repeat(64) }],
            caption: 'caption text',
            creativeBriefVersion: '1.0',
            hashtags: [],
          }),
          loadMediaAsset: vi.fn().mockResolvedValue({
            publish_eligibility: true,
            lifecycle_status: 'READY',
            sha256_digest: 'd'.repeat(64),
          }),
          loadOrCreatePublishRendition: vi.fn().mockResolvedValue({
            id: 'rend-1',
            workspace_id: workspaceId,
            storage_bucket: 'assets',
            object_path: 'images/asset1.jpg',
          }),
          leaseGateway: {
            createSignedUrl: vi.fn().mockResolvedValue({
              signedUrl: 'https://cdn.example.com/image.jpg',
              error: null,
            }),
            probeUrl: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'image/jpeg',
            }),
          },
          loadCredential: vi.fn().mockResolvedValue({
            accessToken: 'token-123',
            externalAccountId: 'act-123',
          }),
          providerPublish: vi.fn().mockResolvedValue({
            providerPostId: 'meta-final-rec-survived',
            destinationUrl: 'https://instagram.com/p/final-rec-survived',
          }),
          readbackDependencies: {
            fetchPublishedPost: vi.fn().mockResolvedValue({
              providerPostId: 'meta-final-rec-survived',
              channel: 'instagram',
              permalink: 'https://instagram.com/p/final-rec-survived',
              caption: 'caption text',
              mediaItems: [{ id: 'item-1', mediaType: 'IMAGE', mediaUrl: 'https://cdn.example.com/image.jpg', position: 0 }],
              timestamp: new Date().toISOString(),
            }),
            computePerceptualSimilarity: vi.fn().mockResolvedValue({ similarity: 0.99 }),
          },
          recordReceipt: vi.fn().mockImplementation(async (receipt: any) => {
            recordCallCount++
            // Throw on final record (when state is VERIFIED)
            if (receipt.state === 'VERIFIED') {
              throw new Error('FINAL_RECORD_DB_CRASH')
            }
          }),
        }

        const outcome = await realExecute(
          {
            workspaceId,
            scheduleId: 'sched-final-rec-err',
            creativeBundleId: 'bundle-final-rec-err',
            expectedFingerprint: 'f'.repeat(64),
            channelConnectionId: 'conn-1',
            actorUserId,
            targetChannel: 'instagram',
          },
          fakeDeps
        )

        expect(outcome.ok).toBe(false)
        expect(outcome.receiptState).toBe('RESULT_UNKNOWN')
        expect(outcome.verificationOutcome).toBe('RESULT_UNKNOWN')
        expect(outcome.providerPostId).toBe('meta-final-rec-survived')
        expect(outcome.errorCode).toBe('POST_DISPATCH_VERIFICATION_FAILED')
        expect(outcome.errorMessage).toContain('결과 확인이 필요합니다')
      })

      it('proves that repeated upsert with same ID fails with EXTERNAL_RECEIPT_IMMUTABLE, while append-only insert succeeds', async () => {
        const store = new Map<string, any>()
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return {
                insert: vi.fn().mockImplementation((payload: any) => {
                  if (store.has(payload.id)) {
                    return Promise.resolve({
                      data: null,
                      error: { message: 'EXTERNAL_RECEIPT_IMMUTABLE' },
                    })
                  }
                  store.set(payload.id, { ...payload })
                  return Promise.resolve({ data: [payload], error: null })
                }),
                upsert: vi.fn().mockImplementation((payload: any) => {
                  // Postgres trigger: UPDATE raises EXTERNAL_RECEIPT_IMMUTABLE
                  if (store.has(payload.id)) {
                    return Promise.resolve({
                      data: null,
                      error: { message: 'EXTERNAL_RECEIPT_IMMUTABLE' },
                    })
                  }
                  store.set(payload.id, { ...payload })
                  return Promise.resolve({ data: [payload], error: null })
                }),
              }
            }
            return createChainableQuery()
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        const deps = facade.buildProductionDependencies()

        const actionRequestId = '55555555-5555-4555-8555-555555555555'
        const baseReceipt = createExternalActionReceipt({
          workspaceId,
          scheduleId: 'sched-imm-1',
          creativeBundleId: 'bundle-imm-1',
          creativeFingerprint: 'f'.repeat(64),
          channel: 'instagram',
          orderedMediaSha256: [],
          providerPayloadDigest: 'digest',
          idempotencyKey: 'idem-imm',
          evidence: {
            action_request_id: actionRequestId,
            actor_user_id: actorUserId,
          },
        })

        // Step 1: Record initial REQUESTED receipt
        await deps.recordReceipt(baseReceipt)
        const initialRowId = baseReceipt.receiptId
        expect(store.has(initialRowId)).toBe(true)

        // Step 2: Transition to PROVIDER_ACCEPTED and record again
        const acceptedReceipt = transitionReceiptState(baseReceipt, 'PROVIDER_ACCEPTED', {
          providerPostId: 'post-imm-1',
        })

        // With append-only insert, recordReceipt generates a fresh UUID and succeeds
        await deps.recordReceipt(acceptedReceipt)
        const acceptedRowId = acceptedReceipt.receiptId
        expect(acceptedRowId).not.toBe(initialRowId)
        expect(store.has(acceptedRowId)).toBe(true)

        // Direct demonstration of immutable collision: attempting to upsert with the SAME ID fails!
        const collisionRes = await mockSupabase
          .from('external_action_receipts')
          .upsert({ id: initialRowId, workspace_id: workspaceId })
        expect(collisionRes.error?.message).toBe('EXTERNAL_RECEIPT_IMMUTABLE')
      })

      it('fails closed before provider dispatch if actionRequestId is missing and not found in mission lineage', async () => {
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'marketing_missions') {
              return {
                select: () =>
                  createChainableQuery({
                    data: {
                      id: missionId,
                      workspace_id: workspaceId,
                      status: 'EXECUTING',
                      external_action_request_id: null, // missing request ID!
                      },
                    error: null,
                  }),
              }
            }
            return createChainableQuery()
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        const result = await facade.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId: 'bundle-fail-req',
          expectedFingerprint: 'f'.repeat(64),
          actorUserId,
          actorRole: 'internal_operator',
          missionId,
          // actionRequestId omitted
        })

        expect(result.success).toBe(false)
        expect(result.overallStatus).toBe('ALL_FAILED')
        expect(result.errorCode).toBe('INVALID_ACTION_REQUEST_ID')
        expect(result.message).toContain('작업 요청 정보가 올바르지 않거나 누락되어')
      })

      it('fails closed to RESULT_UNKNOWN and preserves providerPostId when VERIFICATION_PENDING recordReceipt throws', async () => {
        const { executeCreativeBundlePublish: realExecute } = await vi.importActual<any>('../creative-bundle-publishing-executor')

        const fakeDeps = {
          loadApprovedBundle: vi.fn().mockResolvedValue({
            bundleId: 'bundle-pending-err',
            workspaceId,
            approvalStatus: 'APPROVED',
            bundleFingerprint: 'f'.repeat(64),
            channel: 'instagram',
            orderedMedia: [{ mediaAssetId: 'asset-1', sha256Digest: 'd'.repeat(64) }],
            caption: 'caption text',
            creativeBriefVersion: '1.0',
            hashtags: [],
          }),
          loadMediaAsset: vi.fn().mockResolvedValue({
            publish_eligibility: true,
            lifecycle_status: 'READY',
            sha256_digest: 'd'.repeat(64),
          }),
          loadOrCreatePublishRendition: vi.fn().mockResolvedValue({
            id: 'rend-1',
            workspace_id: workspaceId,
            storage_bucket: 'assets',
            object_path: 'images/asset1.jpg',
          }),
          leaseGateway: {
            createSignedUrl: vi.fn().mockResolvedValue({
              signedUrl: 'https://cdn.example.com/image.jpg',
              error: null,
            }),
            probeUrl: vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              contentType: 'image/jpeg',
            }),
          },
          loadCredential: vi.fn().mockResolvedValue({
            accessToken: 'token-123',
            externalAccountId: 'act-123',
          }),
          providerPublish: vi.fn().mockResolvedValue({
            providerPostId: 'meta-pending-survived',
            destinationUrl: 'https://instagram.com/p/pending-survived',
          }),
          readbackDependencies: {},
          recordReceipt: vi.fn().mockImplementation(async (receipt: any) => {
            // Throw when state is VERIFICATION_PENDING
            if (receipt.state === 'VERIFICATION_PENDING') {
              throw new Error('PENDING_RECEIPT_DB_TIMEOUT')
            }
          }),
        }

        const outcome = await realExecute(
          {
            workspaceId,
            scheduleId: 'sched-pending-err',
            creativeBundleId: 'bundle-pending-err',
            expectedFingerprint: 'f'.repeat(64),
            channelConnectionId: 'conn-1',
            actorUserId,
            targetChannel: 'instagram',
          },
          fakeDeps
        )

        expect(outcome.ok).toBe(false)
        expect(outcome.receiptState).toBe('RESULT_UNKNOWN')
        expect(outcome.verificationOutcome).toBe('RESULT_UNKNOWN')
        expect(outcome.providerPostId).toBe('meta-pending-survived')
        expect(outcome.errorCode).toBe('POST_DISPATCH_VERIFICATION_FAILED')
        expect(outcome.errorMessage).toContain('결과 확인이 필요합니다')
      })

      it('selects authoritative VERIFIED receipt over REQUESTED on fixed-clock replay when created_at is identical', async () => {
        const frozenTimestamp = '2026-10-27T12:00:00.000Z'
        const bundleId = 'bundle-fixed-clock-1'
        const reqRow = {
          id: '11111111-0000-0000-0000-000000000001',
          workspace_id: workspaceId,
          bundle_id: bundleId,
          action_kind: 'instagram_publish',
          state: 'REQUESTED',
          receipt_kind: 'submission',
          action_request_id: 'a0000000-0000-4000-8000-000000000001',
          recorded_by: actorUserId,
          provider_reference: null,
          result_url: null,
          created_at: frozenTimestamp,
          finalized_at: frozenTimestamp,
        }
        const verRow = {
          id: '22222222-0000-0000-0000-000000000002',
          workspace_id: workspaceId,
          bundle_id: bundleId,
          action_kind: 'instagram_publish',
          state: 'VERIFIED',
          receipt_kind: 'observed_result',
          action_request_id: 'a0000000-0000-4000-8000-000000000001',
          recorded_by: actorUserId,
          provider_reference: 'meta-verified-proof',
          result_url: 'https://instagram.com/p/proof',
          created_at: frozenTimestamp,
          finalized_at: frozenTimestamp,
        }

        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return createChainableQuery({
                data: [reqRow, verRow], // Returns multiple rows with exact same created_at
                error: null,
              })
            }
            return createChainableQuery()
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        // Simulate publish with existing rows in store
        const result = await facade.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId,
          expectedFingerprint: 'f'.repeat(64),
          actorUserId,
          actionRequestId: 'a0000000-0000-4000-8000-000000000001',
        })

        // Zero republish: must load the VERIFIED row even with identical created_at, not REQUESTED
        expect(result.results.instagram.verified).toBe(true)
        expect(result.results.instagram.postId).toBe('meta-verified-proof')
        expect(result.results.instagram.receiptId).toBe('22222222-0000-0000-0000-000000000002')
      })

      it('preserves the last durable receipt ID anchor when a subsequent recordReceipt insert fails', async () => {
        let callCount = 0
        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'external_action_receipts') {
              return {
                insert: vi.fn().mockImplementation((payload: any) => {
                  callCount++
                  if (callCount === 1) {
                    return Promise.resolve({ data: [payload], error: null })
                  }
                  return Promise.resolve({ data: null, error: { message: 'DB_CONNECTION_RESET' } })
                }),
              }
            }
            return createChainableQuery()
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        const deps = facade.buildProductionDependencies()

        const receipt = createExternalActionReceipt({
          workspaceId,
          scheduleId: 'sched-fail-sec',
          creativeBundleId: 'bundle-fail-sec',
          creativeFingerprint: 'f'.repeat(64),
          channel: 'instagram',
          orderedMediaSha256: [],
          providerPayloadDigest: 'digest',
          idempotencyKey: 'idem-sec',
          evidence: {
            action_request_id: 'a0000000-0000-4000-8000-000000000001',
            actor_user_id: actorUserId,
          },
        })

        // 1st insert: succeeds
        await deps.recordReceipt(receipt)
        const recordedFirstId = receipt.receiptId
        expect(recordedFirstId).toBeDefined()

        // Transition to PROVIDER_ACCEPTED
        const transitioned = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
          providerPostId: 'post-1',
        })

        // 2nd insert: fails with DB error
        await expect(deps.recordReceipt(transitioned)).rejects.toThrow('RECEIPT_RECORDING_FAILED')

        // Must preserve the last durable receipt ID, NOT mutate to an unpersisted ghost ID!
        expect(transitioned.receiptId).toBe(recordedFirstId)
      })

      it('recovers actionRequestId from mission lineage and scheduleId from mission metadata for instant publish route callers', async () => {
        const expectedScheduleId = '55555555-5555-4555-8555-555555555555'
        const expectedActionRequestId = '66666666-6666-4666-8666-666666666666'

        let capturedScheduleId: string | null = null
        let capturedActionRequestId: string | null = null
        let capturedActorUserId: string | null = null

        const mockSupabase: any = {
          from: (table: string) => {
            if (table === 'marketing_missions') {
              return {
                select: () =>
                  createChainableQuery({
                    data: {
                      id: missionId,
                      workspace_id: workspaceId,
                      status: 'APPROVED',
                      updated_at: '2026-10-27T10:00:00.000Z',
                      external_action_request_id: expectedActionRequestId,
                      metadata: { schedule_id: expectedScheduleId },
                    },
                    error: null,
                  }),
                update: () =>
                  createChainableQuery({
                    data: [{ id: missionId }],
                    error: null,
                  }),
              }
            }
            if (table === 'mission_events') {
              return {
                insert: () => Promise.resolve({ error: null }),
              }
            }
            if (table === 'external_action_receipts') {
              return createChainableQuery({ data: null, error: null })
            }
            return createChainableQuery()
          },
        }

        const facade = new CanonicalPublishFacade(mockSupabase)
        liveMocks.bundlePublish.mockImplementation(async (input: any) => {
          capturedScheduleId = input.scheduleId
          capturedActionRequestId = input.actionRequestId
          capturedActorUserId = input.actorUserId
          return {
            ok: true,
            receiptId: 'rcpt-caller-ok',
            providerPostId: 'post-caller-ok',
            destinationUrl: 'https://instagram.com/p/caller-ok',
            verificationOutcome: 'VERIFIED',
            receiptState: 'VERIFIED',
          }
        })

        // Caller like instant route provides authenticated actorUserId and missionId, but omits actionRequestId and scheduleId
        const result = await facade.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId: 'bundle-caller-boundary',
          expectedFingerprint: 'f'.repeat(64),
          actorUserId,
          actorRole: 'internal_operator',
          missionId,
        })

        expect(result.success).toBe(true)
        expect(capturedActionRequestId).toBe(expectedActionRequestId)
        expect(capturedScheduleId).toBe(expectedScheduleId)
        expect(capturedActorUserId).toBe(actorUserId)
      })
    })
  })
})
