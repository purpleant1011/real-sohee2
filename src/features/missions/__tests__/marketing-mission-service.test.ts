import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketingMissionService } from '../marketing-mission-service'

describe('MarketingMissionService', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2' // Canonical 바이름
  const traceId = 'trc-test-001'
  const messageId = 'msg-test-001'

  let mockMissionsDb: Record<string, any> = {}
  let mockEventsDb: any[] = []

  const createMockClient = () => {
    return {
      from: (table: string) => {
        if (table === 'marketing_missions') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              const id = payload.id || `msn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
              const item = { ...payload, id }
              mockMissionsDb[id] = item
              return {
                select: () => ({
                  single: async () => ({ data: item, error: null }),
                  maybeSingle: async () => ({ data: item, error: null }),
                }),
              }
            }),
            select: vi.fn().mockImplementation((fields?: string) => {
              const queryState: { filters: Array<{ col: string; val: any }> } = { filters: [] }
              const chain = {
                eq: (col: string, val: any) => {
                  queryState.filters.push({ col, val })
                  return chain
                },
                order: () => chain,
                limit: () => chain,
                maybeSingle: async () => {
                  const match = Object.values(mockMissionsDb).find(item =>
                    queryState.filters.every(f => item[f.col] === f.val)
                  )
                  return { data: match || null, error: null }
                },
                single: async () => {
                  const match = Object.values(mockMissionsDb).find(item =>
                    queryState.filters.every(f => item[f.col] === f.val)
                  )
                  if (!match) return { data: null, error: new Error('Not found') }
                  return { data: match, error: null }
                },
              }
              return chain
            }),
            update: vi.fn().mockImplementation((updates: any) => {
              const queryState: { filters: Array<{ col: string; val: any }> } = { filters: [] }
              const chain = {
                eq: (col: string, val: any) => {
                  queryState.filters.push({ col, val })
                  return chain
                },
                select: () => ({
                  single: async () => {
                    const match = Object.values(mockMissionsDb).find(item =>
                      queryState.filters.every(f => item[f.col] === f.val)
                    )
                    if (match) {
                      Object.assign(match, updates)
                      return { data: match, error: null }
                    }
                    return { data: null, error: new Error('Not found') }
                  },
                }),
              }
              return chain
            }),
          }
        }

        if (table === 'mission_events') {
          return {
            insert: vi.fn().mockImplementation((payload: any) => {
              mockEventsDb.push(payload)
              return Promise.resolve({ error: null })
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    } as any
  }

  beforeEach(() => {
    mockMissionsDb = {}
    mockEventsDb = []
  })

  it('ensures a marketing mission idempotently from user message', async () => {
    const client = createMockClient()
    const service = new MarketingMissionService(client)

    const mission1 = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '평일 오후 자연눈썹 예약 공백 채우기',
      sourceMessageId: messageId,
      strategySummary: '인스타그램 피드 룩북 발행 및 DM 슬롯 안내',
      targetChannel: 'instagram',
    })

    expect(mission1.id).toBeDefined()
    expect(mission1.status).toBe('RECEIVED')
    expect(mission1.goal).toBe('평일 오후 자연눈썹 예약 공백 채우기')
    expect(mission1.workspace_id).toBe(workspaceId)
    expect(mockEventsDb.length).toBe(1)
    expect(mockEventsDb[0].to_status).toBe('RECEIVED')

    // Second call with same workspaceId and sourceMessageId should return existing mission
    const mission2 = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '평일 오후 자연눈썹 예약 공백 채우기 (재전송)',
      sourceMessageId: messageId,
    })

    expect(mission2.id).toBe(mission1.id)
    expect(mockEventsDb.length).toBe(1) // No new creation event
  })

  it('transitions mission through strict state lifecycle', async () => {
    const client = createMockClient()
    const service = new MarketingMissionService(client)

    const mission = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '봄맞이 시술 할인 프로모션',
      sourceMessageId: messageId,
    })

    // RECEIVED -> PLANNING
    const planned = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PLANNING',
      actorType: 'agent',
      reason: '소희 마케팅 계획 수립 시작',
    })
    expect(planned.status).toBe('PLANNING')

    // PLANNING -> PRODUCING
    const producing = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PRODUCING',
      actorType: 'agent',
      reason: '콘텐츠 원고 및 이미지 제작 착수',
    })
    expect(producing.status).toBe('PRODUCING')

    // PRODUCING -> AWAITING_APPROVAL
    const awaiting = await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'AWAITING_APPROVAL',
      actorType: 'agent',
      reason: '원장님 확인 및 승인 대기',
    })
    expect(awaiting.status).toBe('AWAITING_APPROVAL')

    // Events recorded in chronological order
    expect(mockEventsDb.length).toBe(4) // 1 CREATE + 3 TRANSITION
  })

  it('binds downstream content and approval to mission lineage', async () => {
    const client = createMockClient()
    const service = new MarketingMissionService(client)

    const mission = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '헤어라인 교정 피드 홍보',
      sourceMessageId: messageId,
    })

    const contentId = 'cnt-001'
    const versionId = 'ver-001'
    const approvalId = 'appr-001'

    const updated = await service.bindContentAndApproval({
      workspaceId,
      missionId: mission.id,
      traceId,
      contentItemId: contentId,
      contentVersionId: versionId,
      approvalId,
    })

    expect(updated.content_id).toBe(contentId)
    expect(updated.content_version_id).toBe(versionId)
    expect(updated.approval_id).toBe(approvalId)
  })

  it('projects consistent same-truth models for Owner and Admin', async () => {
    const client = createMockClient()
    const service = new MarketingMissionService(client)

    const mission = await service.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '예약 문의 전환 미션',
      sourceMessageId: messageId,
    })

    await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PLANNING',
      actorType: 'agent',
    })

    await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PRODUCING',
      actorType: 'agent',
    })

    await service.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'AWAITING_APPROVAL',
      actorType: 'agent',
    })

    const ownerView = await service.getMissionProjection(workspaceId, mission.id, 'owner')
    const adminView = await service.getMissionProjection(workspaceId, mission.id, 'admin')

    // Same core truth
    expect(ownerView.status).toBe('AWAITING_APPROVAL')
    expect(adminView.status).toBe('AWAITING_APPROVAL')
    expect(ownerView.missionId).toBe(adminView.missionId)
    expect(ownerView.isBlocked).toBe(adminView.isBlocked)
    expect(ownerView.requiresOwnerAction).toBe(adminView.requiresOwnerAction)
    expect(ownerView.requiresOwnerAction).toBe(true)
  })
})
