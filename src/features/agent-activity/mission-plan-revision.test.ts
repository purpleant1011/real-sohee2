import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviseMissionPlan } from './mission-plan-revision'
import { AgentApprovalService } from '@/features/agent-session/agent-approval-service'

const boundary = vi.hoisted(() => ({ db: null as any, dispatch: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => boundary.db }))
vi.mock('@/features/agent-session/agent-session-service', () => ({ AgentSessionService: { setSessionStatus: vi.fn() } }))
vi.mock('@/lib/conversation/conversation-repository', () => ({ ConversationRepository: { updateAgentRunStatus: vi.fn() } }))
vi.mock('@/features/tool-runtime/tool-dispatcher', () => ({ ToolDispatcher: { dispatch: boundary.dispatch } }))

// 저장소 경계만 대체한다. 조건은 실행 시 평가하여 경쟁 요청의 CAS를 검증한다.
function database() {
  const rows: Record<string, Record<string, any>[]> = {
    marketing_missions: [{ id: 'mission-1', workspace_id: 'ws-1', trace_id: 'trace-1', status: 'AWAITING_APPROVAL', updated_at: '2026-10-26T00:00:00Z', source_conversation_job_id: 'run-1', metadata: { threadId: 'thread-1', workItemId: 'work-1' } }],
    conversation_jobs: [{ id: 'run-1', workspace_id: 'ws-1', thread_id: 'thread-1', plan_data: { missionId: 'mission-1' } }],
    agent_approvals: [{ id: 'approval-1', workspace_id: 'ws-1', action_run_id: 'run-1', status: 'PENDING', version: 1 }],
  }
  let beforeWrite: ((table: string) => void) | undefined
  const db = { from(table: string) {
    const conditions: Array<(row: Record<string, any>) => boolean> = []
    let updates: Record<string, unknown> | undefined
    const execute = () => {
      if (updates) { beforeWrite?.(table); beforeWrite = undefined }
      const matches = rows[table].filter(row => conditions.every(test => test(row)))
      if (updates) matches.forEach(row => Object.assign(row, updates))
      return { data: matches, error: null }
    }
    const query: any = {
      select: () => query,
      update: (value: Record<string, unknown>) => { updates = value; return query },
      eq: (key: string, value: unknown) => { conditions.push(row => row[key] === value); return query },
      single: async () => { const result = execute(); return { ...result, data: result.data.length === 1 ? result.data[0] : null } },
      maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] || null } },
      then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
    }
    return query
  } }
  return { db, rows, race: (write: (table: string) => void) => { beforeWrite = write } }
}

const input = { workspaceId: 'ws-1', missionId: 'mission-1', runId: 'run-1', threadId: 'thread-1', expectedVersion: 0, message: '인스타만 해줘' }

describe('동일 미션 계획 변경의 durable 경계', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    AgentApprovalService.resetMemoryStoreForTesting()
    boundary.dispatch.mockReset().mockResolvedValue({ success: true, status: 'COMPLETED' })
  })

  it('계획 변경 뒤 이전 승인을 서버에 제출해도 게시 도구를 호출하지 않는다', async () => {
    const { db, rows } = database()
    boundary.db = db
    Object.assign(rows.agent_approvals[0], { proposal_id: 'proposal-1', session_id: 'session-1', proposal_type: 'PUBLISH_APPROVAL', proposed_value: { caption: 'old' } })
    await reviseMissionPlan(db, input)
    const result = await AgentApprovalService.resolveApproval({ workspaceId: 'ws-1', proposalId: 'proposal-1', action: 'APPROVE', expectedVersion: 1 })
    expect(result.success).toBe(false)
    expect(result.approval.status).toBe('EXPIRED')
    expect(boundary.dispatch).not.toHaveBeenCalled()
  })

  it('durable 조회가 사라지면 메모리의 이전 실행 승인을 사용하지 않는다', async () => {
    const { db } = database()
    boundary.db = db
    await AgentApprovalService.createProposal({ workspaceId: 'ws-1', sessionId: 'session-1', actionRunId: 'run-1', proposalId: 'cached-only', proposalType: 'PUBLISH_APPROVAL', title: '초안', description: '이전 초안', proposedValue: { caption: 'old' } })
    const result = await AgentApprovalService.resolveApproval({ workspaceId: 'ws-1', proposalId: 'cached-only', action: 'APPROVE', expectedVersion: 1 })
    expect(result.success).toBe(false)
    expect(boundary.dispatch).not.toHaveBeenCalled()
  })

  it('같은 미션에 채널 diff를 저장하고 기존 승인을 만료시킨다', async () => {
    const { db, rows } = database()
    const result = await reviseMissionPlan(db, input)
    expect(result).toMatchObject({ missionId: 'mission-1', traceId: 'trace-1', version: 1, constraints: { channels: ['instagram'] } })
    expect(rows.marketing_missions).toHaveLength(1)
    expect(rows.marketing_missions[0]).toMatchObject({ status: 'PLANNING', metadata: { workItemId: 'work-1', planRevision: 1, planConstraints: { channels: ['instagram'] } } })
    expect(rows.agent_approvals[0]).toMatchObject({ status: 'EXPIRED', version: 2 })
  })

  it('이전 채널 제한을 유지하며 할인 제외만 추가한다', async () => {
    const { db, rows } = database()
    Object.assign(rows.marketing_missions[0].metadata, { planRevision: 1, planConstraints: { channels: ['instagram'] } })
    const result = await reviseMissionPlan(db, { ...input, expectedVersion: 1, message: '할인 제외' })
    expect(result).toMatchObject({ version: 2, constraints: { channels: ['instagram'], excludeDiscounts: true } })
  })

  it.each([
    { workspaceId: 'other' }, { threadId: 'other' }, { runId: 'other' }, { expectedVersion: 7 },
  ])('다른 범위 또는 이전 버전은 쓰기 없이 거부한다: %j', async patch => {
    const { db, rows } = database()
    await expect(reviseMissionPlan(db, { ...input, ...patch })).rejects.toThrow()
    expect(rows.agent_approvals[0].status).toBe('PENDING')
    expect(rows.marketing_missions[0].status).toBe('AWAITING_APPROVAL')
  })

  it('승인이 먼저 실행권을 얻으면 계획 변경은 거부한다', async () => {
    const { db, rows, race } = database()
    race(table => { if (table === 'agent_approvals') Object.assign(rows.agent_approvals[0], { status: 'APPROVED', version: 2 }) })
    await expect(reviseMissionPlan(db, input)).rejects.toThrow('PLAN_CONFLICT')
    expect(rows.marketing_missions[0].status).toBe('AWAITING_APPROVAL')
  })

  it('미션 CAS 경쟁에서 지면 수정 완료를 반환하지 않는다', async () => {
    const { db, rows, race } = database()
    rows.agent_approvals = []
    race(table => { if (table === 'marketing_missions') rows.marketing_missions[0].updated_at = 'newer' })
    await expect(reviseMissionPlan(db, input)).rejects.toThrow('PLAN_CONFLICT')
    expect(rows.marketing_missions[0].metadata.planRevision).toBeUndefined()
  })

  it.each(['EXECUTING', 'RESULT_UNKNOWN', 'COMPLETED'])('실행·결과 경계에서는 계획을 덮어쓰지 않는다: %s', async status => {
    const { db, rows } = database()
    rows.marketing_missions[0].status = status
    await expect(reviseMissionPlan(db, input)).rejects.toThrow('PLAN_CONFLICT')
    expect(rows.agent_approvals[0].status).toBe('PENDING')
  })
})
