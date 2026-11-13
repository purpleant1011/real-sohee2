import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const guard = vi.hoisted(() => vi.fn())
const service = vi.hoisted(() => ({
  getStudioOverview: vi.fn(),
  getStudioKnowledgeViews: vi.fn(),
  processStudioTurn: vi.fn(),
  decideKnowledgeProposal: vi.fn(),
  resolveCuriosity: vi.fn(),
  saveGoal: vi.fn(),
  listStudioGoals: vi.fn(),
  listStudioTurns: vi.fn(),
}))
vi.mock('@/lib/auth/workspace-guard', () => ({ requireWorkspaceMembership: guard }))
vi.mock('@/features/sohee-studio/services/sohee-studio-service', () => service)

import { GET as knowledge } from './knowledge/route'
import { GET as questions } from './questions/route'
import { GET as goalsRead, POST as goalsWrite } from './goals/route'
import { GET as turnsRead, POST as turns } from './turns/route'
import { POST as decideFact } from './knowledge-proposals/[id]/decide/route'
import { POST as decideQuestion } from './questions/[id]/decision/route'

const workspaceId = '3c043535-e630-4b2a-acb0-8e944d4593a9'
const itemId = '0d0611c4-40b6-41c3-b2aa-761cd558d1e9'
const params = { params: Promise.resolve({ workspaceId }) }
const itemParams = { params: Promise.resolve({ workspaceId, id: itemId }) }
const get = (path: string) => new NextRequest(`http://localhost/api/workspaces/${workspaceId}/sohee-studio/${path}`)
const post = (path: string, body: object) => new NextRequest(`http://localhost/api/workspaces/${workspaceId}/sohee-studio/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const reads = [
  ['turn history', () => turnsRead(get('turns'), params)],
  ['knowledge', () => knowledge(get('knowledge'), params)],
  ['questions', () => questions(get('questions'), params)],
  ['goals', () => goalsRead(get('goals'), params)],
] as const
const writes = [
  ['turns', () => turns(post('turns', { content: '우리 매장 위치는 서울이에요.', clientMessageId: crypto.randomUUID() }), params)],
  ['fact decision', () => decideFact(post(`knowledge-proposals/${itemId}/decide`, { decision: 'confirm' }), itemParams)],
  ['question decision', () => decideQuestion(post(`questions/${itemId}/decision`, { status: 'snoozed' }), itemParams)],
  ['goals', () => goalsWrite(post('goals', { title: '재방문 고객을 늘리고 싶어요' }), params)],
] as const

describe('Studio route authorization', () => {
  for (const [name, call] of [...reads, ...writes]) {
    it(`${name} denies guests before accessing service`, async () => {
      vi.clearAllMocks()
      guard.mockResolvedValue({ ok: false, status: 401, error: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' })
      expect((await call()).status).toBe(401)
      expect(Object.values(service).every((method) => !method.mock.calls.length)).toBe(true)
    })
    it(`${name} denies cross-workspace requests`, async () => {
      vi.clearAllMocks()
      guard.mockResolvedValue({ ok: false, status: 403, error: 'WORKSPACE_FORBIDDEN', message: '접근할 수 없습니다.' })
      expect((await call()).status).toBe(403)
      expect(Object.values(service).every((method) => !method.mock.calls.length)).toBe(true)
    })
  }

  for (const [name, call] of writes) {
    it(`${name} denies a viewer mutation`, async () => {
      vi.clearAllMocks()
      guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'viewer' })
      expect((await call()).status).toBe(403)
      expect(Object.values(service).every((method) => !method.mock.calls.length)).toBe(true)
    })
  }

  it('lets a member read the persisted turn history without creating an AI response', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'viewer' })
    service.listStudioTurns.mockResolvedValue([{ id: itemId, sender: 'sohee', content: '저장된 대화' }])
    const response = await turnsRead(get('turns'), params)
    expect(response.status).toBe(200)
    expect((await response.json()).data[0].content).toBe('저장된 대화')
    expect(service.processStudioTurn).not.toHaveBeenCalled()
  })

  it('lists paused goals so owners can resume them', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'owner' })
    service.listStudioGoals.mockResolvedValue([{ id: itemId, status: 'paused' }])
    const response = await goalsRead(get('goals'), params)
    expect(response.status).toBe(200)
    expect((await response.json()).data[0].status).toBe('paused')
    expect(service.listStudioGoals).toHaveBeenCalledWith(workspaceId)
  })

  it('requires a server-recorded goal proposal instead of accepting an arbitrary active goal', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'owner' })
    const response = await goalsWrite(post('goals', {
      id: crypto.randomUUID(), workspaceId, status: 'active', title: '임의 활성 목표',
    }), params)
    expect(response.status).toBe(400)
    expect(service.saveGoal).not.toHaveBeenCalled()
  })

  it('rejects an arbitrary question status before reaching storage', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'owner' })
    const response = await decideQuestion(post(`questions/${itemId}/decision`, { status: 'resolved' }), itemParams)
    expect(response.status).toBe(400)
    expect(service.resolveCuriosity).not.toHaveBeenCalled()
  })

  it('accepts a stable curiosity key without treating it as a fact UUID', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'owner' })
    service.processStudioTurn.mockResolvedValue({ id: crypto.randomUUID(), sender: 'sohee', content: '확인할게요.' })
    const response = await turns(post('turns', {
      content: '정기 휴무일은 월요일이에요.', clientMessageId: crypto.randomUUID(), focus: 'curiosity', relatedEntityId: 'missing_hours',
    }), params)
    expect(response.status).toBe(200)
  })

  it('rejects an empty turn even if a user is authorized', async () => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ ok: true, workspaceId, userId: crypto.randomUUID(), role: 'owner' })
    const response = await turns(post('turns', { content: '  ', clientMessageId: crypto.randomUUID() }), params)
    expect(response.status).toBe(400)
    expect(service.processStudioTurn).not.toHaveBeenCalled()
  })
})
