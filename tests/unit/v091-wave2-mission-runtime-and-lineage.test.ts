import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canTransitionMission,
  assertValidMissionTransition,
  assertEvidenceBackedTransition,
  projectMissionStateFromEvents,
} from '@/lib/mission-os/mission-state-machine'
import {
  validateEndToEndLineageIntegrity,
  assertStrictLineage,
  validateApprovalForExecution,
  assertIdempotentExecutionRetry,
} from '@/lib/mission-os/mission-lineage-guard'
import {
  MissionReadModel,
  buildCanonicalMissionSnapshot,
} from '@/lib/mission-os/mission-read-model'
import {
  MissionRecoveryService,
} from '@/lib/mission-os/mission-recovery-service'
import type { MarketingMissionAggregate } from '@/lib/mission-os/mission-types'

describe('V0.91 Wave 2 · Mission Runtime & Durable Lineage (ANI-1241, ANI-1242, ANI-1243, ANI-1244)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const missionId = 'msn-byreum-autonomy-001'
  const traceId = 'trc-wave2-test-999'

  let mockMissionsDb: Record<string, any> = {}
  let mockEventsDb: any[] = []

  beforeEach(() => {
    mockMissionsDb = {}
    mockEventsDb = []
  })

  // --------------------------------------------------------------------------
  // 1. ANI-1241: Canonical Lifecycle & Evidence-Backed Transition Guard
  // --------------------------------------------------------------------------
  describe('1. ANI-1241: Canonical Lifecycle & Evidence-Backed Transition Guard', () => {
    it('MUST enforce evidence requirements and block transitions lacking required canonical artifacts', () => {
      // 1. AWAITING_APPROVAL without content_id must fail
      expect(() => {
        assertEvidenceBackedTransition({
          fromStatus: 'PRODUCING',
          toStatus: 'AWAITING_APPROVAL',
          mission: { id: missionId },
        })
      }).toThrowError(/AWAITING_APPROVAL requires valid content_id/)

      // 2. APPROVED without approval_id must fail
      expect(() => {
        assertEvidenceBackedTransition({
          fromStatus: 'AWAITING_APPROVAL',
          toStatus: 'APPROVED',
          mission: { id: missionId, content_id: 'cnt-1' },
        })
      }).toThrowError(/APPROVED requires verified approval_id/)

      // 3. PUBLISHED_VERIFIED without receipt must fail
      expect(() => {
        assertEvidenceBackedTransition({
          fromStatus: 'EXECUTING',
          toStatus: 'PUBLISHED_VERIFIED',
          mission: { id: missionId, content_id: 'cnt-1', approval_id: 'appr-1' },
        })
      }).toThrowError(/PUBLISHED_VERIFIED requires provider receipt/)

      // 4. BOOKED without booking_id must fail
      expect(() => {
        assertEvidenceBackedTransition({
          fromStatus: 'BOOKING_INTENT',
          toStatus: 'BOOKED',
          mission: { id: missionId },
        })
      }).toThrowError(/BOOKED requires verified booking_id/)

      // 5. Valid evidence must succeed
      expect(() => {
        assertEvidenceBackedTransition({
          fromStatus: 'AWAITING_APPROVAL',
          toStatus: 'APPROVED',
          mission: { id: missionId, approval_id: 'appr-valid-1' },
        })
      }).not.toThrow()
    })

    it('MUST reject illegal state skips (e.g., RECEIVED directly to PUBLISHED_VERIFIED)', () => {
      expect(canTransitionMission('RECEIVED', 'PUBLISHED_VERIFIED')).toBe(false)
      expect(() => {
        assertValidMissionTransition('RECEIVED', 'PUBLISHED_VERIFIED')
      }).toThrowError(/Cannot transition marketing mission from 'RECEIVED' to 'PUBLISHED_VERIFIED'/)
    })

    it('MUST reduce chronological mission events stream into final state projection', () => {
      const events: any[] = [
        { occurred_at: '2026-09-10T10:00:00Z', to_status: 'RECEIVED' },
        { occurred_at: '2026-09-10T10:05:00Z', to_status: 'PLANNING' },
        { occurred_at: '2026-09-10T10:10:00Z', to_status: 'PRODUCING' },
        { occurred_at: '2026-09-10T10:15:00Z', to_status: 'AWAITING_APPROVAL' },
      ]
      expect(projectMissionStateFromEvents(events)).toBe('AWAITING_APPROVAL')
    })
  })

  // --------------------------------------------------------------------------
  // 2. ANI-1242: End-to-End Correlation Integrity & Retry Guards
  // --------------------------------------------------------------------------
  describe('2. ANI-1242: End-to-End Correlation Integrity & Idempotency Guards', () => {
    it('MUST trace end-to-end lineage across all 8 domain stages and reject cross-tenant workspace mismatch', () => {
      const validGraph = {
        workspaceId,
        missionId,
        traceId,
        sourceMessageId: 'msg-001',
        conversationJobId: 'job-001',
        contentId: 'cnt-001',
        approvalId: 'appr-001',
        actionReceiptId: 'rcpt-001',
        customerId: 'cust-001',
        bookingId: 'book-001',
        outcomeId: 'out-001',
      }

      const report = validateEndToEndLineageIntegrity(validGraph)
      expect(report.isValid).toBe(true)
      expect(report.correlatedEdgeCount).toBe(8)
      expect(report.lineagePath).toContain('MISSION:msn-byreum-autonomy-001')
      expect(report.lineagePath).toContain('OUT:out-001')

      // Cross-Tenant Rejection
      expect(() => {
        assertStrictLineage(
          { workspaceId, missionId, traceId },
          { workspaceId: 'different-workspace-uuid', missionId, traceId }
        )
      }).toThrowError(/LINEAGE_WORKSPACE_MISMATCH/)
    })

    it('MUST block duplicate external execution on retried jobs when receipt already exists', () => {
      expect(() => {
        assertIdempotentExecutionRetry('rcpt-existing-123', 'sha256-post-payload')
      }).toThrowError(/IDEMPOTENT_EXECUTION_BLOCKED/)

      expect(() => {
        assertIdempotentExecutionRetry(null, 'sha256-post-payload')
      }).not.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // 3. ANI-1243: Canonical Mission Read Model (Same Truth)
  // --------------------------------------------------------------------------
  describe('3. ANI-1243: Canonical Mission Read Model (Same Truth)', () => {
    it('MUST project identical canonicalStatus, snapshotVersion, and semantic truth to Owner, Admin, and Agent views', () => {
      const sampleAggregate: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: traceId,
        status: 'AWAITING_APPROVAL',
        goal: '가을 신규 고객 예약 20건 유치',
        strategy_summary: '자연눈썹 시술 전후 비교 스토리텔링',
        target_channel: 'instagram',
        content_id: 'cnt-draft-1',
        metadata: {},
        created_at: '2026-09-10T10:00:00Z',
        updated_at: '2026-09-10T10:15:00Z',
      }

      const snapshot = buildCanonicalMissionSnapshot(sampleAggregate, 'snap-ver-100')

      expect(snapshot.snapshotVersion).toBe('snap-ver-100')
      expect(snapshot.canonicalStatus).toBe('AWAITING_APPROVAL')

      // Owner View Parity
      expect(snapshot.ownerView.canonicalStatus).toBe('AWAITING_APPROVAL')
      expect(snapshot.ownerView.displayBadgeText).toBe('사장님 승인 대기 중')
      expect(snapshot.ownerView.requiresOwnerAction).toBe(true)

      // Admin View Parity
      expect(snapshot.adminView.canonicalStatus).toBe('AWAITING_APPROVAL')
      expect(snapshot.adminView.traceId).toBe(traceId)
      expect(snapshot.adminView.contentId).toBe('cnt-draft-1')

      // Agent View Parity
      expect(snapshot.agentView.canonicalStatus).toBe('AWAITING_APPROVAL')
      expect(snapshot.agentView.nextAllowedActions).toContain('WAIT_FOR_OWNER')
    })
  })

  // --------------------------------------------------------------------------
  // 4. ANI-1244: Mission Orphan / Interrupted Job Recovery & Blind Retry Guard
  // --------------------------------------------------------------------------
  describe('4. ANI-1244: Mission Orphan / Interrupted Job Recovery', () => {
    it('MUST isolate interrupted EXECUTING mission into RESULT_UNKNOWN and block blind external duplicate publish', async () => {
      const executingMission: MarketingMissionAggregate = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: traceId,
        status: 'EXECUTING',
        goal: '인스타그램 신규 피드 게시',
        external_action_request_id: 'act-req-999',
        external_action_receipt_id: null, // Request was sent, but receipt was unconfirmed when worker timed out!
        metadata: { in_flight_action: true },
        created_at: '2026-09-10T10:00:00Z',
        updated_at: '2026-09-10T10:05:00Z',
      }

      mockMissionsDb[missionId] = { ...executingMission }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              update: vi.fn().mockImplementation((updates) => {
                Object.assign(mockMissionsDb[missionId], updates)
                const chain: any = {
                  eq: vi.fn().mockImplementation(() => chain),
                  select: vi.fn().mockResolvedValue({ data: [{ id: missionId }], error: null }),
                  then: (resolve: any) => Promise.resolve({ data: [{ id: missionId }], error: null }).then(resolve),
                }
                return chain
              }),
            }
          }
          if (table === 'mission_events') {
            return {
              insert: vi.fn().mockImplementation((event) => {
                mockEventsDb.push(event)
                return { error: null }
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      } as any

      const recoveryService = new MissionRecoveryService(mockSupabase)
      const result = await recoveryService.reconcileInterruptedMission(executingMission, {
        errorCode: 'WORKER_TIMEOUT_BEFORE_RECEIPT',
        workerInterrupted: true,
      })

      // Must be isolated to RESULT_UNKNOWN to prevent double publish
      expect(result.recoveredStatus).toBe('RESULT_UNKNOWN')
      expect(result.isBlindRetryBlocked).toBe(true)
      expect(result.resumePoint).toBe('PROVIDER_READBACK_REQUIRED')

      // DB and Events check
      expect(mockMissionsDb[missionId].status).toBe('RESULT_UNKNOWN')
      expect(mockEventsDb.length).toBe(1)
      expect(mockEventsDb[0].to_status).toBe('RESULT_UNKNOWN')
      expect(mockEventsDb[0].payload.isBlindRetryBlocked).toBe(true)
    })

    it('MUST record owner pause and cancel actions into mission_events stream with reasons', async () => {
      const activeMission = {
        id: missionId,
        workspace_id: workspaceId,
        trace_id: traceId,
        status: 'PLANNING',
        goal: '가을 이벤트 기획',
      }
      mockMissionsDb[missionId] = { ...activeMission }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({ data: mockMissionsDb[missionId], error: null }),
                  }),
                }),
              }),
              update: vi.fn().mockImplementation((updates) => ({
                eq: () => {
                  Object.assign(mockMissionsDb[missionId], updates)
                  return { error: null }
                },
              })),
            }
          }
          if (table === 'mission_events') {
            return {
              insert: vi.fn().mockImplementation((event) => {
                mockEventsDb.push(event)
                return { error: null }
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      } as any

      const recoveryService = new MissionRecoveryService(mockSupabase)

      // Pause Mission
      await recoveryService.pauseMission(workspaceId, missionId, '사장님 휴가로 인한 일시중지')
      expect(mockMissionsDb[missionId].status).toBe('PAUSED')
      expect(mockEventsDb[mockEventsDb.length - 1].to_status).toBe('PAUSED')
      expect(mockEventsDb[mockEventsDb.length - 1].payload.reason).toBe('사장님 휴가로 인한 일시중지')

      // Cancel Mission
      await recoveryService.cancelMission(workspaceId, missionId, '신규 프로모션 기획 취소')
      expect(mockMissionsDb[missionId].status).toBe('CANCELLED')
      expect(mockEventsDb[mockEventsDb.length - 1].to_status).toBe('CANCELLED')
    })
  })
})
