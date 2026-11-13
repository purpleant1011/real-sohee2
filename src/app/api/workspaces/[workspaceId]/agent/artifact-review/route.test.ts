import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { MissionPublishReviewError } from '@/features/agent-activity/mission-publish-review'
import { POST } from './route'

const { authorize, issue, approve, snapshot } = vi.hoisted(() => ({ authorize: vi.fn(), issue: vi.fn(), approve: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: authorize, isResponse: (value: unknown) => value instanceof NextResponse }))
vi.mock('@/features/agent-activity/mission-publish-review', async original => ({
  ...await original<typeof import('@/features/agent-activity/mission-publish-review')>(),
  MissionPublishReviewService: class { issue = issue; approve = approve; snapshot = snapshot },
}))
const workspaceId = '00000000-0000-4000-8000-000000000001'
const scope = { missionId: '00000000-0000-4000-8000-000000000002', runId: '00000000-0000-4000-8000-000000000003', contentId: '00000000-0000-4000-8000-000000000004', versionId: '00000000-0000-4000-8000-000000000005' }
const consent = { quoteId: 'stored-quote', reviewFingerprint: 'a'.repeat(64), rightsConfirmed: true, disclosureConfirmed: true }
const context = { params: Promise.resolve({ workspaceId }) }
const request = (body: unknown) => new NextRequest(`http://localhost/api/workspaces/${workspaceId}/agent/artifact-review`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  vi.clearAllMocks()
  authorize.mockResolvedValue({ userId: 'signed-in-reviewer', workspaceId, role: 'reviewer', admin: {} })
  issue.mockResolvedValue({ quoteId: 'stored-quote', requiredCredits: 50, executionAllowed: false })
  approve.mockResolvedValue({ state: 'REVIEW_APPROVED', decidedBy: 'signed-in-reviewer', executionAllowed: false })
  snapshot.mockResolvedValue({ quote: { quoteId: 'stored-quote', requiredCredits: 50, executionAllowed: false }, preview: { text: '견적과 결합된 원고' } })
})
it.each([401, 403])('권한 없는 요청은 견적·승인 저장 전에 %s로 차단한다', async status => {
  authorize.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }))
  expect((await POST(request({ action: 'ISSUE_QUOTE', ...scope }), context)).status).toBe(status)
  expect(issue).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled()
})
it('검토자 권한을 요구하고 저장 확인된 50크레딧 견적을 반환한다', async () => {
  const response = await POST(request({ action: 'ISSUE_QUOTE', ...scope }), context)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ success: true, quote: { requiredCredits: 50, executionAllowed: false } })
  expect(authorize).toHaveBeenCalledWith(workspaceId, { requireRole: 'reviewer' })
  expect(issue).toHaveBeenCalledWith({ workspaceId, ...scope })
  expect(response.headers.get('cache-control')).toContain('no-store')
})
it('발행된 견적과 재검증된 검토 스냅샷을 함께 반환한다', async () => {
  const response = await POST(request({ action: 'ISSUE_QUOTE', ...scope }), context)
  expect(await response.json()).toMatchObject({ preview: { text: '견적과 결합된 원고' } })
  expect(snapshot).toHaveBeenCalledWith({ workspaceId, ...scope }, 'stored-quote')
})
it('견적 저장 후 화면용 스냅샷이 바뀌면 성공을 반환하지 않는다', async () => {
  snapshot.mockRejectedValueOnce(new MissionPublishReviewError('MISSION_EXACT_REVIEW_REQUIRED'))
  const response = await POST(request({ action: 'ISSUE_QUOTE', ...scope }), context)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ success: false })
})
it('정확 검토에는 인증된 승인자만 전달하며 외부 실행을 허용하지 않는다', async () => {
  const response = await POST(request({ action: 'APPROVE_REVIEW', ...scope, ...consent }), context)
  expect(response.status).toBe(200)
  expect(approve).toHaveBeenCalledWith({ workspaceId, ...scope }, consent, 'signed-in-reviewer')
  expect(await response.json()).toMatchObject({ success: true, reviewApproval: { state: 'REVIEW_APPROVED', executionAllowed: false } })
  expect(issue).not.toHaveBeenCalled()
})
it.each([
  { action: 'PUBLISH', ...scope },
  { action: 'ISSUE_QUOTE', ...scope, runId: 'invalid' },
  { action: 'ISSUE_QUOTE', ...scope, requiredCredits: 0 },
  { action: 'APPROVE_REVIEW', ...scope, ...consent, decidedBy: 'forged-actor' },
  { action: 'APPROVE_REVIEW', ...scope, ...consent, rightsConfirmed: false },
])('잘못된 범위·가격·승인자·동의 입력을 거부한다: %j', async body => {
  expect((await POST(request(body), context)).status).toBe(400)
  expect(issue).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled()
})
it('저장 근거 미확인은 성공이 아닌 409로 반환한다', async () => {
  issue.mockRejectedValueOnce(new MissionPublishReviewError('MISSION_QUOTE_SAVE_UNCONFIRMED'))
  const response = await POST(request({ action: 'ISSUE_QUOTE', ...scope }), context)
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ success: false, error: { code: 'MISSION_QUOTE_SAVE_UNCONFIRMED' } })
})
it('예상하지 못한 DB 오류 원문을 응답에 노출하지 않는다', async () => {
  issue.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_SECRET'))
  const response = await POST(request({ action: 'ISSUE_QUOTE', ...scope }), context)
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('PRIVATE_DATABASE_SECRET')
})
