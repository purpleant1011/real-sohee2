import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeApprovalFingerprint } from '@/features/engagement/draft'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), comment: vi.fn(), draft: vi.fn(), approve: vi.fn(), send: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/engagement/compose', () => ({ createEngagementService: () => ({ repo: {
  findCommentById: mocks.comment, findDraftByCommentId: mocks.draft, approveDraft: mocks.approve,
}, send: mocks.send }) }))
import { POST } from './route'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const commentId = '30000000-0000-4000-8000-000000000001'
const comment = { id: commentId, workspace_id: workspaceId, channel: 'threads', status: 'DRAFTED', comment_text: '가격 문의' }
const draft = { id: '40000000-0000-4000-8000-000000000001', draft_text: '상담 후 안내드릴게요.', approved_fingerprint: null }
const expectedFingerprint = computeApprovalFingerprint(workspaceId, commentId, draft.draft_text)
const expectedSourceFingerprint = computeApprovalFingerprint(workspaceId, commentId, comment.comment_text)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ workspaceId, admin: {}, userId: '90000000-0000-4000-8000-000000000001', role: 'manager' })
  mocks.comment.mockResolvedValue(comment); mocks.draft.mockResolvedValue(draft)
  mocks.approve.mockResolvedValue({ ...draft, approved_fingerprint: expectedFingerprint })
  mocks.send.mockResolvedValue({ sent: true, status: 'SENT', providerReplyId: 'provider-receipt' })
})
const submit = (body: unknown) => POST(new Request('https://example.com/api/send', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ workspaceId, commentId }) })
describe('native comment send binds a reviewed source', () => {
  it('rejects a changed source before approving or sending the unchanged draft', async () => {
    const response = await submit({ expectedFingerprint, expectedSourceFingerprint: '0'.repeat(64) })
    expect(response.status).toBe(409)
    expect(mocks.approve).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled()
  })
  it('allows the exact reviewed source and body through the existing native send service', async () => {
    const response = await submit({ expectedFingerprint, expectedSourceFingerprint })
    expect(response.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.auth).toHaveBeenCalledWith(workspaceId, { requireRole: 'manager' })
  })
  it('preserves existing native clients that already confirm the exact draft body', async () => {
    expect((await submit({ expectedFingerprint })).status).toBe(200)
    expect(mocks.send).toHaveBeenCalledOnce()
  })
})
