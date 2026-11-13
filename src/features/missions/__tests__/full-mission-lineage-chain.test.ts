import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarketingMissionService } from '../marketing-mission-service'
import { CanonicalContentLifecycleService } from '@/features/content/canonical-content-lifecycle'

let mockDb: Record<string, any[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((tableName: string) => {
      mockDb[tableName] = mockDb[tableName] || []

      return {
        select: vi.fn((_cols?: string) => {
          const filters: Array<{ col: string; val: any }> = []
          const chain = {
            eq: vi.fn((col: string, val: any) => {
              filters.push({ col, val })
              return chain
            }),
            order: vi.fn(() => chain),
            limit: vi.fn(() => chain),
            maybeSingle: vi.fn(async () => {
              const row = mockDb[tableName]?.find(r =>
                filters.every(f => r[f.col] === f.val)
              )
              return { data: row ? { ...row } : null, error: null }
            }),
            single: vi.fn(async () => {
              const row = mockDb[tableName]?.find(r =>
                filters.every(f => r[f.col] === f.val)
              )
              if (!row) return { data: null, error: new Error(`Row not found in ${tableName}`) }
              return { data: { ...row }, error: null }
            }),
          }
          return chain
        }),

        insert: vi.fn((payload: any) => {
          const id = payload.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          const record = { ...payload, id }
          mockDb[tableName] = mockDb[tableName] || []
          mockDb[tableName].push(record)

          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { ...record }, error: null })),
              maybeSingle: vi.fn(async () => ({ data: { ...record }, error: null })),
            })),
          }
        }),

        update: vi.fn((updates: any) => {
          const filters: Array<{ col: string; val: any }> = []
          const applyUpdates = () => {
            const row = mockDb[tableName]?.find(r =>
              filters.every(f => r[f.col] === f.val)
            )
            if (row) {
              Object.assign(row, updates)
            }
            return { data: row ? { ...row } : null, error: null }
          }

          const chain: any = {
            eq: vi.fn((col: string, val: any) => {
              filters.push({ col, val })
              applyUpdates()
              return chain
            }),
            select: vi.fn(() => ({
              single: vi.fn(async () => applyUpdates()),
              maybeSingle: vi.fn(async () => applyUpdates()),
            })),
            then: (resolve: any, reject?: any) => Promise.resolve(applyUpdates()).then(resolve, reject),
          }
          return chain
        }),

        upsert: vi.fn(async (payload: any) => {
          mockDb[tableName] = mockDb[tableName] || []
          mockDb[tableName].push({ ...payload })
          return { error: null }
        }),
      }
    }),
  })),
}))

describe('Wave 1 Full Mission Lineage Chain Integration (ANI-1192, ANI-1211, ANI-1212)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const traceId = 'trc-byreum-golden-001'
  const sourceMessageId = 'b0000000-0000-4000-8000-000000000001'
  const actorId = '00000000-0000-4000-a000-000000000001'

  beforeEach(() => {
    mockDb = {
      marketing_missions: [],
      mission_events: [],
      content_items: [],
      content_versions: [],
      content_drafts: [],
      approvals: [],
      external_action_receipts: [],
    }
    vi.clearAllMocks()
  })

  it('orchestrates complete lineage from user command to approved mission with same-truth projections', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const missionService = new MarketingMissionService(client as any)

    // Step 1: User message creates Marketing Mission (RECEIVED)
    const mission = await missionService.ensureMarketingMission({
      workspaceId,
      traceId,
      goal: '평일 오후 자연눈썹 예약 공백 채우기',
      sourceMessageId,
      strategySummary: '인스타그램 피드 룩북 및 슬롯 안내',
      targetChannel: 'instagram',
      actorType: 'user',
      actorId,
    })

    expect(mission.id).toBeDefined()
    expect(mission.status).toBe('RECEIVED')
    expect(mission.workspace_id).toBe(workspaceId)
    expect(mission.trace_id).toBe(traceId)

    // Step 2: Planning & Producing transitions
    await missionService.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PLANNING',
      actorType: 'agent',
      reason: '소희가 마케팅 전략 수립',
    })

    await missionService.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'PRODUCING',
      actorType: 'agent',
      reason: '콘텐츠 원고 작성 시작',
    })

    // Step 3: Content creation with lineage binding
    const contentCaption = '바이름 가을 맞춤 자연눈썹 특별 케어 예약 안내 ✨'
    const content = await CanonicalContentLifecycleService.createContent({
      workspaceId,
      channel: 'instagram',
      title: '가을 자연눈썹 룩북',
      caption: contentCaption,
      hashtags: ['#자연눈썹', '#청라눈썹', '#바이름뷰티'],
      createdBy: actorId,
      missionId: mission.id,
      traceId,
    })

    expect(content.contentId).toBeDefined()
    expect(content.fingerprint).toBeDefined()

    // Step 4: Transition to AWAITING_APPROVAL
    await missionService.transitionMission({
      workspaceId,
      missionId: mission.id,
      traceId,
      toStatus: 'AWAITING_APPROVAL',
      actorType: 'agent',
      reason: '원장님 컨펌 대기',
      ownerActionRequired: true,
    })

    // Verify Same-Truth projections at AWAITING_APPROVAL
    const ownerWaitingView = await missionService.getMissionProjection(workspaceId, mission.id, 'owner')
    const adminWaitingView = await missionService.getMissionProjection(workspaceId, mission.id, 'admin')
    expect(ownerWaitingView.status).toBe('AWAITING_APPROVAL')
    expect(adminWaitingView.status).toBe('AWAITING_APPROVAL')
    expect(ownerWaitingView.requiresOwnerAction).toBe(true)
    expect(adminWaitingView.requiresOwnerAction).toBe(true)

    // Step 5: Exact Approval binding with fingerprint
    const approval = await CanonicalContentLifecycleService.approveContentVersion({
      workspaceId,
      contentId: content.contentId,
      versionId: content.versionId,
      fingerprint: content.fingerprint,
      decidedBy: actorId,
      reason: '원장님 확인 완료',
      missionId: mission.id,
      traceId,
    })

    expect(approval.status).toBe('approved')
    expect(approval.approvalId).toBeDefined()

    // Step 6: Verify mission was transitioned to APPROVED
    const approvedMission = await missionService.getMissionProjection(workspaceId, mission.id, 'owner')
    expect(approvedMission.status).toBe('APPROVED')
    expect(approvedMission.requiresOwnerAction).toBe(false)

    // Step 7: Negative test: Stale fingerprint approval rejection
    await expect(
      CanonicalContentLifecycleService.approveContentVersion({
        workspaceId,
        contentId: content.contentId,
        versionId: content.versionId,
        fingerprint: 'tampered-or-stale-fingerprint-hex',
        decidedBy: actorId,
        missionId: mission.id,
        traceId,
      })
    ).rejects.toThrow('버전 지문(fingerprint)이 일치하지 않습니다.')
  })
})
