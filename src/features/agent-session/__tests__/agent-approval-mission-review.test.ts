import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/workspaces/[workspaceId]/agent/approvals/route'

const mocks = vi.hoisted(() => ({ createServer: vi.fn(), dispatch: vi.fn(), updateRun: vi.fn(), setSessionStatus: vi.fn(), loadBundle: vi.fn() }))
vi.mock('@/features/creative/creative-bundle-store', () => ({ SupabaseCreativeBundleStore: class { getBundleById = mocks.loadBundle } }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: async () => ({ userId: 'owner-review', role: 'owner' }),
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServer }))
vi.mock('@/features/tool-runtime/tool-dispatcher', () => ({ ToolDispatcher: { dispatch: mocks.dispatch } }))
vi.mock('../agent-session-service', () => ({ AgentSessionService: { setSessionStatus: mocks.setSessionStatus } }))
vi.mock('@/lib/conversation/conversation-repository', () => ({ ConversationRepository: { updateAgentRunStatus: mocks.updateRun } }))
import { AgentApprovalService, resetApprovalExecutionClaimsForTests } from '../agent-approval-service'

const workspaceId = 'ws-review'
const proposalId = 'publish-review'

function database(options: { proposalType?: string; proposedValue?: Record<string, unknown>; run?: Record<string, unknown> | null; runError?: boolean; actionRunId?: string | null; mission?: Record<string, unknown> } = {}) {
  let row = { id: 'approval-review', workspace_id: workspaceId, proposal_id: proposalId, session_id: 'session-review',
    action_run_id: options.actionRunId === undefined ? 'run-review' : options.actionRunId,
    proposal_type: options.proposalType || 'PUBLISH_APPROVAL', title: '원고 게시', description: '원고 검토',
    proposed_value: options.proposedValue || { channel: 'THREADS', caption: '검토할 원고' }, status: 'PENDING', version: 1,
    expires_at: new Date(Date.now() + 3600000).toISOString(), created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z' }
  const writes: string[] = []
  const reads: { table: string; filters: Record<string, unknown> }[] = []
  const db = { from(table: string) {
    let changes: Record<string, unknown> | undefined
    const filters: Record<string, unknown> = {}
    const execute = async () => {
      if (changes) { writes.push(table); row = { ...row, ...changes }; return { data: row, error: null } }
      reads.push({ table, filters })
      if (table === 'agent_approvals') return { data: row, error: null }
      if (table === 'conversation_jobs') {
        const run = options.run === undefined ? { id: 'run-review', workspace_id: workspaceId, plan_data: { missionId: 'mission-review' } } : options.run
        const matches = run && Object.entries(filters).every(([key, value]) => run[key] === value)
        return { data: matches ? run : null, error: options.runError ? { message: 'unavailable' } : null }
      }
      if (table === 'marketing_missions') return { data: { id: 'mission-review', workspace_id: workspaceId,
        content_id: 'content-review', content_version_id: 'version-review', status: 'APPROVED', metadata: {}, ...options.mission }, error: null }
      throw new Error(`Unexpected table ${table}`)
    }
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      update: (value: Record<string, unknown>) => { changes = value; return query }, single: execute, maybeSingle: execute }
    return query
  } }
  return { db, writes, reads, current: () => row }
}

beforeEach(() => {
  vi.clearAllMocks()
  AgentApprovalService.resetMemoryStoreForTesting()
  resetApprovalExecutionClaimsForTests()
  mocks.dispatch.mockResolvedValue({ success: true, status: 'COMPLETED', data: {} })
  mocks.loadBundle.mockResolvedValue(null)
})

it.each(['PUBLISH_APPROVAL', 'CONTENT_PUBLISH'])('%s는 미션의 정확한 검토 없이 일반 승인으로 게시하지 않는다', async proposalType => {
  const store = database({ proposalType })
  mocks.createServer.mockResolvedValue(store.db)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE', actorId: 'owner-review', expectedVersion: 1 })
  expect(result.success).toBe(false)
  expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
  expect(store.current().status).toBe('PENDING')
  expect(store.writes).toEqual([])
  expect(store.reads).toContainEqual({ table: 'conversation_jobs', filters: { workspace_id: workspaceId, id: 'run-review' } })
  expect(mocks.dispatch).not.toHaveBeenCalled()
  expect(mocks.updateRun).not.toHaveBeenCalled()
})

it.each([
  { runError: true },
  { run: null },
  { run: { id: 'run-review', workspace_id: workspaceId, plan_data: null } },
  { run: { id: 'run-review', workspace_id: workspaceId, plan_data: [] } },
  { run: { id: 'run-review', workspace_id: 'another-workspace', plan_data: {} } },
])('게시 실행의 미션 결합을 읽지 못하면 승인과 게시를 보류한다: %j', async options => {
  const store = database(options)
  mocks.createServer.mockResolvedValue(store.db)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE' })
  expect(result.success).toBe(false)
  expect(result.error?.code).toBe('RESULT_UNKNOWN')
  expect(store.writes).toEqual([])
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

it('실행 ID가 없어도 명시적으로 미션에 연결된 일반 게시 승인은 우회하지 않는다', async () => {
  const store = database({ actionRunId: null, proposedValue: { missionId: 'mission-review', caption: '검토할 원고' } })
  mocks.createServer.mockResolvedValue(store.db)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE' })
  expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
  expect(store.writes).toEqual([])
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

it.each(['PUBLISH_APPROVAL', 'CONTENT_PUBLISH'])('HTTP 일반 승인 요청도 %s의 미션 검토 차단을 우회하지 못한다', async proposalType => {
  const store = database({ proposalType })
  mocks.createServer.mockResolvedValue(store.db)
  const response = await POST(new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/approvals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposalId, action: 'APPROVE', expectedVersion: 1, actorId: 'forged-owner', missionId: null }),
  }), { params: Promise.resolve({ workspaceId }) })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ success: false, error: { code: 'ARTIFACT_REVIEW_REQUIRED' }, approval: { status: 'PENDING' } })
  expect(store.writes).toEqual([])
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

it('미션 원고의 반려는 검토 미확인으로 막지 않고 게시 없이 취소한다', async () => {
  const store = database()
  mocks.createServer.mockResolvedValue(store.db)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'REJECT', actorId: 'owner-review' })
  expect(result.success).toBe(true)
  expect(store.current().status).toBe('REJECTED')
  expect(mocks.dispatch).not.toHaveBeenCalled()
  expect(mocks.updateRun).toHaveBeenCalledWith('run-review', 'cancelled', true)
})

const exactProposal = { channel: 'THREADS', contentVersionId: 'version-review', bundleId: 'bundle-review', expectedFingerprint: 'reviewed-fingerprint', missionId: 'mission-review', idempotencyKey: 'publish-review' }
const approvedBundle = { bundleId: 'bundle-review', workspaceId, contentId: 'content-review', versionId: 'version-review', channel: 'threads', bundleFingerprint: 'reviewed-fingerprint', approvedFingerprint: 'reviewed-fingerprint', approvalStatus: 'APPROVED' }

it('서버에서 정확 승인된 같은 미션 원고만 durable 승인 후 실행을 재개한다', async () => {
  const store = database({ proposedValue: exactProposal })
  mocks.createServer.mockResolvedValue(store.db)
  mocks.loadBundle.mockResolvedValue(approvedBundle)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE', actorId: 'owner-review' })
  expect(result.success).toBe(true)
  expect(store.current().status).toBe('APPROVED')
  expect(mocks.loadBundle).toHaveBeenCalledWith(workspaceId, 'bundle-review')
  expect(mocks.dispatch).toHaveBeenCalledWith('publish.create', exactProposal, expect.objectContaining({ actorId: 'owner-review', intentMode: 'EXECUTE' }))
})

it.each([
  { approvalStatus: 'PENDING' }, { approvedFingerprint: 'stale' }, { bundleFingerprint: 'changed' },
  { workspaceId: 'other' }, { channel: 'instagram' }, { versionId: 'other-version' },
])('서버 묶음의 정확 승인이 다르면 일반 승인을 보류한다: %j', async change => {
  const store = database({ proposedValue: exactProposal })
  mocks.createServer.mockResolvedValue(store.db)
  mocks.loadBundle.mockResolvedValue({ ...approvedBundle, ...change })
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE', actorId: 'owner-review' })
  expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
  expect(store.writes).toEqual([])
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

it.each([{ content_version_id: 'changed' }, { content_id: 'other-content' }, { status: 'PAUSED' }, { metadata: { control_epoch: 2 } }])('정확 승인 묶음이어도 변경되거나 중지된 미션은 실행하지 않는다: %j', async mission => {
  const store = database({ proposedValue: exactProposal, mission })
  mocks.createServer.mockResolvedValue(store.db)
  mocks.loadBundle.mockResolvedValue(approvedBundle)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE', actorId: 'owner-review' })
  expect(result.success).toBe(false)
  expect(store.writes).toEqual([])
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

it('미션이 없는 게시도 원고 검토 없이 일반 승인으로 우회하지 않는다', async () => {
  const store = database({ actionRunId: null })
  mocks.createServer.mockResolvedValue(store.db)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE', actorId: 'owner-review' })
  expect(result.error?.code).toBe('ARTIFACT_REVIEW_REQUIRED')
  expect(store.writes).toEqual([])
  expect(mocks.dispatch).not.toHaveBeenCalled()
})

it('게시가 아닌 승인에는 미션 원고의 검토 차단을 적용하지 않는다', async () => {
  const store = database({ proposalType: 'RESERVATION_CONFIRMATION' })
  mocks.createServer.mockResolvedValue(store.db)
  const result = await AgentApprovalService.resolveApproval({ workspaceId, proposalId, action: 'APPROVE' })
  expect(result.success).toBe(true)
  expect(store.current().status).toBe('APPROVED')
  expect(mocks.dispatch).toHaveBeenCalledWith('reservation.create', expect.anything(), expect.anything())
})
