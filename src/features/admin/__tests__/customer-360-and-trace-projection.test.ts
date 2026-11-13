import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Customer360CanonicalService,
  CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID,
} from '../customer-360-canonical-service'
import {
  AdminMissionTraceProjection,
  projectMissionTraceTimeline,
} from '../mission-trace-projection'

describe('Admin Customer 360 & Mission Trace Explorer (ANI-1196, ANI-1222, ANI-1201, ANI-1223)', () => {
  const prodWorkspaceId = CANONICAL_BYREUM_PRODUCTION_WORKSPACE_ID
  const demoWorkspaceId = 'b1000000-0000-4000-8000-000000000001'
  const missionId = 'msn-byreum-golden-001'
  const traceId = 'trc-golden-001'

  let mockWorkspacesDb: Record<string, any> = {}
  let mockMissionsDb: Record<string, any> = {}
  let mockContentDb: any[] = []
  let mockApprovalsDb: any[] = []
  let mockReceiptsDb: any[] = []
  let mockReservationsDb: any[] = []

  const mockSupabaseClient = {
    from: (table: string) => {
      if (table === 'workspaces') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              single: async () => {
                const match = Object.values(mockWorkspacesDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: match ? null : new Error('Not found') }
              },
            }
            return chain
          }),
        }
      }

      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              single: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: match ? null : new Error('Not found') }
              },
              order: () => chain,
              limit: () => ({
                then: (cb: any) => {
                  const filtered = Object.values(mockMissionsDb).filter(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  return cb({ data: filtered, error: null })
                },
              }),
            }
            return chain
          }),
        }
      }

      if (table === 'content_items') {
        return {
          select: vi.fn().mockImplementation(() => ({
            eq: () => ({
              then: (cb: any) => cb({ data: mockContentDb, error: null }),
            }),
          })),
        }
      }

      if (table === 'approvals') {
        return {
          select: vi.fn().mockImplementation(() => ({
            eq: () => ({
              then: (cb: any) => cb({ data: mockApprovalsDb, error: null }),
            }),
          })),
        }
      }

      if (table === 'external_action_receipts') {
        return {
          select: vi.fn().mockImplementation(() => ({
            eq: () => ({
              then: (cb: any) => cb({ data: mockReceiptsDb, error: null }),
            }),
          })),
        }
      }

      if (table === 'reservations') {
        return {
          select: vi.fn().mockImplementation(() => {
            const chain = {
              eq: () => chain,
              then: (cb: any) => cb({ data: mockReservationsDb, error: null }),
            }
            return chain
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  } as any

  beforeEach(() => {
    mockWorkspacesDb = {
      [prodWorkspaceId]: {
        id: prodWorkspaceId,
        display_name: '바이름',
        owner_email: 'admin@example.com',
      },
      [demoWorkspaceId]: {
        id: demoWorkspaceId,
        display_name: '바이름 (테스트)',
        owner_email: 'admin@example.com',
      },
    }

    mockMissionsDb = {
      [missionId]: {
        id: missionId,
        workspace_id: prodWorkspaceId,
        trace_id: traceId,
        status: 'NEXT_ACTION_READY',
        goal: '바이름 가을 자연눈썹 10명 모객',
        content_id: 'cnt-post-001',
        content_version_id: 'ver-post-001',
        approval_id: 'appr-001',
        external_action_receipt_id: 'rcp-pub-001',
        customer_id: 'conv-cust-001',
        booking_id: 'bk-confirmed-001',
        metadata: {
          provider_post_reference: '18029384729102938',
          next_best_action: {
            actionId: 'nba_001',
            title: '주말 2차 잔여 슬롯 숏폼 릴스 발행',
            confidence: 94,
          },
        },
        created_at: '2026-09-10T10:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      },
    }

    mockContentDb = [{ id: 'cnt-post-001' }]
    mockApprovalsDb = [{ id: 'appr-001' }]
    mockReceiptsDb = [{ id: 'rcp-pub-001' }]
    mockReservationsDb = [{ id: 'bk-confirmed-001', total_amount_krw: 180000, status: 'CONFIRMED' }]
  })

  describe('1. Customer 360 Canonical Service & Identity Bar', () => {
    it('MUST accurately identify Production tenant vs Demo tenant and prevent cross-contamination', async () => {
      const service = new Customer360CanonicalService(mockSupabaseClient)

      const prodIdentity = await service.buildTenantIdentityBar(prodWorkspaceId)
      expect(prodIdentity.workspaceId).toBe(prodWorkspaceId)
      expect(prodIdentity.isProduction).toBe(true)
      expect(prodIdentity.ownerEmail).toBe('admin@example.com')
      expect(prodIdentity.badgeLabel).toBe('PRODUCTION_PRIMARY')

      const demoIdentity = await service.buildTenantIdentityBar(demoWorkspaceId)
      expect(demoIdentity.workspaceId).toBe(demoWorkspaceId)
      expect(demoIdentity.isProduction).toBe(false)
      expect(demoIdentity.badgeLabel).toBe('DEMO_SANDBOX')
    })

    it('MUST aggregate full Customer 360 profile strictly from database ground truth', async () => {
      const service = new Customer360CanonicalService(mockSupabaseClient)

      const profile = await service.fetchCustomer360Profile(prodWorkspaceId)

      expect(profile.identity.isProduction).toBe(true)
      expect(profile.metrics.missionsCount).toBe(1)
      expect(profile.metrics.contentsCount).toBe(1)
      expect(profile.metrics.approvalsCount).toBe(1)
      expect(profile.metrics.publishReceiptsCount).toBe(1)
      expect(profile.metrics.reservationsCount).toBe(1)
      expect(profile.metrics.totalVerifiedRevenueKrw).toBe(180000)
    })
  })

  describe('2. Admin Mission Trace Event Projection', () => {
    it('MUST reconstruct end-to-end 8-stage mission timeline with exact actor badges and drilldown refs', async () => {
      const projection = new AdminMissionTraceProjection(mockSupabaseClient)

      const traceView = await projection.projectMissionTrace(prodWorkspaceId, missionId)

      expect(traceView.missionId).toBe(missionId)
      expect(traceView.traceId).toBe(traceId)
      expect(traceView.stages.length).toBe(8)

      // Stage 1: USER_REQUEST
      expect(traceView.stages[0].stageName).toBe('USER_REQUEST')
      expect(traceView.stages[0].actorBadge).toBe('USER')
      expect(traceView.stages[0].status).toBe('OBSERVED')

      // Stage 4: EXACT_APPROVAL
      expect(traceView.stages[3].stageName).toBe('EXACT_APPROVAL')
      expect(traceView.stages[3].actorBadge).toBe('USER')
      expect(traceView.stages[3].status).toBe('OBSERVED')
      expect(traceView.stages[3].evidenceRef).toBe('appr-001')

      // Stage 5: PROVIDER_PUBLISH
      expect(traceView.stages[4].stageName).toBe('PROVIDER_PUBLISH')
      expect(traceView.stages[4].actorBadge).toBe('PROVIDER')
      expect(traceView.stages[4].status).toBe('OBSERVED')
      expect(traceView.stages[4].evidenceRef).toBe('rcp-pub-001')

      // Stage 7: BOOKING_CONFIRMED
      expect(traceView.stages[6].stageName).toBe('BOOKING_CONFIRMED')
      expect(traceView.stages[6].actorBadge).toBe('CUSTOMER')
      expect(traceView.stages[6].status).toBe('OBSERVED')
      expect(traceView.stages[6].evidenceRef).toBe('bk-confirmed-001')

      // Stage 8: NEXT_ACTION_READY
      expect(traceView.stages[7].stageName).toBe('NEXT_ACTION_READY')
      expect(traceView.stages[7].actorBadge).toBe('AGENT')
      expect(traceView.stages[7].status).toBe('OBSERVED')
      expect(traceView.stages[7].title).toContain('주말 2차 잔여 슬롯')
    })

    it('MUST honestly mark unexecuted stages as NOT_OBSERVED without guessing', async () => {
      const idleMissionId = 'msn-idle-002'
      mockMissionsDb[idleMissionId] = {
        id: idleMissionId,
        workspace_id: prodWorkspaceId,
        trace_id: 'trc-idle-002',
        status: 'PLANNING',
        goal: '신규 기획 단계 미션',
        content_id: null,
        approval_id: null,
        external_action_receipt_id: null,
        customer_id: null,
        booking_id: null,
        metadata: {},
        created_at: '2026-09-10T11:00:00.000Z',
        updated_at: '2026-09-10T11:00:00.000Z',
      }

      const projection = new AdminMissionTraceProjection(mockSupabaseClient)
      const traceView = await projection.projectMissionTrace(prodWorkspaceId, idleMissionId)

      // Stage 1 (User Request): OBSERVED
      expect(traceView.stages[0].status).toBe('OBSERVED')
      // Stage 5 (Provider Publish): NOT_OBSERVED
      expect(traceView.stages[4].status).toBe('NOT_OBSERVED')
      // Stage 7 (Booking): NOT_OBSERVED
      expect(traceView.stages[6].status).toBe('NOT_OBSERVED')
    })

    it('MUST NOT fabricate static IDs/times in projectMissionTraceTimeline and honestly set NOT_OBSERVED', () => {
      const minimalMission = {
        id: 'msn-empty-003',
        workspace_id: prodWorkspaceId,
        trace_id: 'trc-empty-003',
        status: 'RECEIVED',
        goal: '새 미션 요청',
        content_id: null,
        approval_id: null,
        external_action_receipt_id: null,
        customer_id: null,
        booking_id: null,
        metadata: {},
        created_at: '2026-09-10T11:00:00.000Z',
        updated_at: '2026-09-10T11:00:00.000Z',
      }

      const timeline = projectMissionTraceTimeline(minimalMission)

      // Must not fabricate static placeholders
      expect(timeline.stages[2].status).toBe('NOT_OBSERVED')
      expect(timeline.stages[2].evidenceRef).toBeNull()
      expect(timeline.stages[2].title).not.toContain('v1')

      expect(timeline.stages[3].status).toBe('NOT_OBSERVED')
      expect(timeline.stages[3].evidenceRef).toBeNull()
      expect(timeline.stages[3].title).not.toContain('appr-1')

      expect(timeline.stages[4].status).toBe('NOT_OBSERVED')
      expect(timeline.stages[4].evidenceRef).toBeNull()
      expect(timeline.stages[4].title).not.toContain('ig_post_101')

      expect(timeline.stages[5].status).toBe('NOT_OBSERVED')
      expect(timeline.stages[5].evidenceRef).toBeNull()
      expect(timeline.stages[5].title).not.toContain('cust-1')

      expect(timeline.stages[6].status).toBe('NOT_OBSERVED')
      expect(timeline.stages[6].evidenceRef).toBeNull()
      expect(timeline.stages[6].title).not.toContain('res-1')

      expect(timeline.stages[7].status).toBe('NOT_OBSERVED')
      expect(timeline.stages[7].evidenceRef).toBeNull()
      expect(timeline.stages[7].title).not.toContain('신규 슬롯 증설')
    })

    it('MUST project executionState and outcomeState separately and never promote legacy COMPLETED to ACHIEVED_VERIFIED without proof', () => {
      const completedLegacyMission = {
        id: 'msn-legacy-comp',
        workspace_id: prodWorkspaceId,
        trace_id: 'trc-legacy-comp',
        status: 'COMPLETED',
        goal: '레거시 완료 미션',
        created_at: '2026-09-10T10:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
        metadata: {},
      }

      const timeline = projectMissionTraceTimeline(completedLegacyMission)

      expect(timeline.overallStatus).toBe('COMPLETED')
      expect(timeline.executionState).toBe('CLOSED')
      // Legacy COMPLETED must stay PENDING outcome without verified contract + evidence
      expect(timeline.outcomeState).toBe('PENDING')
    })

    it('MUST use conservative unverified wording when receipts or booking IDs exist without independent verification', () => {
      const unverifiedRefMission = {
        id: 'msn-unverified-ref',
        workspace_id: prodWorkspaceId,
        trace_id: 'trc-unverified-ref',
        status: 'EXECUTING',
        goal: '발행 및 예약 레퍼런스 존재',
        external_action_receipt_id: 'rcp-temp-001',
        booking_id: 'bk-unverified-001',
        metadata: {
          provider_post_reference: 'ig_pending_ref_999',
        },
        created_at: '2026-09-10T10:00:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      }

      const timeline = projectMissionTraceTimeline(unverifiedRefMission)

      // Stage 5: provider post ref exists but not verified -> must NOT claim actual publish verified
      expect(timeline.stages[4].status).toBe('OBSERVED')
      expect(timeline.stages[4].title).toContain('검증 미확인')

      // Stage 7: booking id exists but not payment verified -> must NOT claim payment settled
      expect(timeline.stages[6].status).toBe('OBSERVED')
      expect(timeline.stages[6].title).toContain('검증 미확인')
    })
  })
})
