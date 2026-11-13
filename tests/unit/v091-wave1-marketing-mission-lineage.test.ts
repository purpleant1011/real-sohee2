import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketingMissionService } from '@/features/missions/marketing-mission-service'
import { canTransitionMission, assertValidMissionTransition } from '@/lib/mission-os/mission-state-machine'

describe('V0.91 Wave 1 · Marketing Mission Lineage & Runtime Wiring (ANI-1233)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const traceId = 'tr_test_mission_123'
  const messageId = 'msg_user_123'
  const jobId = 'job_agent_456'

  let mockDb: any
  let missionStore: Record<string, any>[] = []
  let eventStore: Record<string, any>[] = []

  beforeEach(() => {
    missionStore = []
    eventStore = []

    mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'marketing_missions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field1: string, val1: any) => ({
                eq: vi.fn((field2: string, val2: any) => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => {
                      const item = missionStore.find(
                        (m) => m[field1] === val1 && m[field2] === val2
                      )
                      return { data: item || null, error: null }
                    }),
                  })),
                  single: vi.fn(async () => {
                    const item = missionStore.find(
                      (m) => m[field1] === val1 && m[field2] === val2
                    )
                    return { data: item || null, error: item ? null : { message: 'Not found' } }
                  }),
                  maybeSingle: vi.fn(async () => {
                    const item = missionStore.find(
                      (m) => m[field1] === val1 && m[field2] === val2
                    )
                    return { data: item || null, error: null }
                  }),
                })),
                single: vi.fn(async () => {
                  const item = missionStore.find((m) => m[field1] === val1)
                  return { data: item || null, error: item ? null : { message: 'Not found' } }
                }),
                maybeSingle: vi.fn(async () => {
                  const item = missionStore.find((m) => m[field1] === val1)
                  return { data: item || null, error: null }
                }),
              })),
            })),
            insert: vi.fn((record: any) => {
              const inserted = {
                id: record.id || `ms_${Date.now()}`,
                ...record,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
              missionStore.push(inserted)
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: inserted, error: null })),
                })),
              }
            }),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((field1: string, val1: any) => ({
                eq: vi.fn((field2: string, val2: any) => ({
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      const idx = missionStore.findIndex(
                        (m) => m[field1] === val1 && m[field2] === val2
                      )
                      if (idx === -1) {
                        return { data: null, error: { message: 'Item not found' } }
                      }
                      missionStore[idx] = { ...missionStore[idx], ...updates }
                      return { data: missionStore[idx], error: null }
                    }),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'mission_events') {
          return {
            insert: vi.fn(async (eventRecord: any) => {
              eventStore.push(eventRecord)
              return { error: null }
            }),
          }
        }
        return {
          select: vi.fn(() => ({})),
        }
      }),
    }
  })

  it('1. Idempotently creates mission and binds source_conversation_job_id', async () => {
    const service = new MarketingMissionService(mockDb)

    // 1st call: Create mission
    const mission = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '바이름 인스타그램 홍보 게시물 생성',
      sourceMessageId: messageId,
      actorType: 'user',
    })

    expect(mission.id).toBeDefined()
    expect(mission.status).toBe('RECEIVED')
    expect(mission.source_message_id).toBe(messageId)
    expect(mission.source_conversation_job_id).toBeFalsy()

    // 2nd call: Same messageId returns existing without duplicate
    const mission2 = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '바이름 인스타그램 홍보 게시물 생성',
      sourceMessageId: messageId,
      actorType: 'user',
    })
    expect(mission2.id).toBe(mission.id)
    expect(missionStore.length).toBe(1)

    // 3rd call: Bind source conversation job id
    const boundMission = await service.bindSourceConversationJob({
      workspaceId,
      missionId: mission.id,
      traceId,
      sourceConversationJobId: jobId,
    })

    expect(boundMission.source_conversation_job_id).toBe(jobId)
  })

  it('2. Enforces state transitions from RECEIVED to PLANNING, AWAITING_APPROVAL, EXECUTING, and PUBLISHED_VERIFIED', async () => {
    const service = new MarketingMissionService(mockDb)

    const mission = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '포트폴리오 발행',
      sourceMessageId: messageId,
    })

    // Transition: RECEIVED -> PLANNING
    const p1 = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PLANNING',
      actorType: 'agent',
    })
    expect(p1.status).toBe('PLANNING')

    // Transition: PLANNING -> PRODUCING
    const p2 = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PRODUCING',
      actorType: 'agent',
    })
    expect(p2.status).toBe('PRODUCING')

    // Transition: PRODUCING -> AWAITING_APPROVAL with approval binding
    const p3 = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'AWAITING_APPROVAL',
      actorType: 'agent',
      downstreamUpdates: {
        approval_id: 'appr_789',
        content_id: 'cnt_001',
        content_version_id: 'v_001',
      },
    })
    expect(p3.status).toBe('AWAITING_APPROVAL')
    expect(p3.approval_id).toBe('appr_789')
    expect(p3.content_id).toBe('cnt_001')

    // Transition: AWAITING_APPROVAL -> APPROVED
    const p4 = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'APPROVED',
      actorType: 'user',
    })
    expect(p4.status).toBe('APPROVED')

    // Transition: APPROVED -> EXECUTING
    const p5 = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'EXECUTING',
      actorType: 'agent',
    })
    expect(p5.status).toBe('EXECUTING')

    // Transition: EXECUTING -> PUBLISHED_VERIFIED
    const p6 = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PUBLISHED_VERIFIED',
      actorType: 'system',
      downstreamUpdates: {
        external_action_receipt_id: 'rcpt_999',
      },
    })
    expect(p6.status).toBe('PUBLISHED_VERIFIED')
    expect(p6.external_action_receipt_id).toBe('rcpt_999')
  })

  it('3. Rejects invalid state transitions fail-closed', () => {
    // Direct leap from RECEIVED to PUBLISHED_VERIFIED is forbidden
    expect(canTransitionMission('RECEIVED', 'PUBLISHED_VERIFIED')).toBe(false)
    expect(() => assertValidMissionTransition('RECEIVED', 'PUBLISHED_VERIFIED')).toThrow(
      /INVALID_MISSION_TRANSITION/
    )

    // Direct leap from AWAITING_APPROVAL to PUBLISHED_VERIFIED without APPROVED/EXECUTING is forbidden
    expect(canTransitionMission('AWAITING_APPROVAL', 'PUBLISHED_VERIFIED')).toBe(false)
    expect(() => assertValidMissionTransition('AWAITING_APPROVAL', 'PUBLISHED_VERIFIED')).toThrow(
      /INVALID_MISSION_TRANSITION/
    )
  })
})
