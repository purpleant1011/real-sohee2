import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  fetchApprovals: vi.fn(),
  executeBatch: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))

vi.mock('@/features/home/home-approval-service', () => ({
  fetchPendingHomeApprovals: mocks.fetchApprovals,
  executeBatchHomeApprovals: mocks.executeBatch,
}))

import { GET, POST } from './route'

describe('/api/workspaces/[workspaceId]/home/approvals route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthorized requests with auth response', async () => {
    mocks.authorize.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '인증 실패' }), { status: 401 })
    )

    const req = new Request('http://localhost/api/workspaces/ws-1/home/approvals')
    const ctx = { params: Promise.resolve({ workspaceId: 'ws-1' }) }
    const res = await GET(req, ctx)

    expect(res.status).toBe(401)
    expect(mocks.fetchApprovals).not.toHaveBeenCalled()
  })

  it('returns pending approvals with autonomy level and summary', async () => {
    const admin = {}
    mocks.authorize.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin,
      userId: 'user-1',
    })

    const mockData = {
      autonomyLevel: 'L2',
      items: [
        {
          id: 'comment:1',
          category: 'comment_reply',
          channel: 'instagram',
          title: '인스타그램 댓글 답글 승인',
          targetLabel: '@customer',
          sourceSnippet: '문의드려요',
          draftSnippet: '안녕하세요 고객님!',
          urgency: '답변 요망',
          createdAt: '2026-10-15T00:00:00Z',
        },
      ],
      autoHandledCount: 2,
      autoHandledLabel: '일상 칭찬 댓글 2건은 소희가 알아서 답글 발송 중입니다',
      summary: { total: 1, comments: 1, posts: 0, dms: 0, proposals: 0 },
    }
    mocks.fetchApprovals.mockResolvedValueOnce(mockData)

    const req = new Request('http://localhost/api/workspaces/ws-1/home/approvals')
    const ctx = { params: Promise.resolve({ workspaceId: 'ws-1' }) }
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.autonomyLevel).toBe('L2')
    expect(json.data.items).toHaveLength(1)
    expect(json.data.autoHandledCount).toBe(2)
  })

  it('executes batch approve action with manager authorization and role context', async () => {
    const admin = {}
    mocks.authorize.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin,
      userId: 'user-1',
      role: 'manager',
    })

    mocks.executeBatch.mockResolvedValueOnce({
      succeededIds: ['comment:1', 'post:2'],
      failedIds: [],
      processedCount: 2,
    })

    const req = new Request('http://localhost/api/workspaces/ws-1/home/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        itemIds: ['comment:1', 'post:2'],
        fingerprints: { 'comment:1': 'fp1' },
      }),
    })
    const ctx = { params: Promise.resolve({ workspaceId: 'ws-1' }) }
    const res = await POST(req, ctx)

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.code).toBe('REVIEW_REQUIRED')
    expect(mocks.executeBatch).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid action payload', async () => {
    mocks.authorize.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {},
      userId: 'user-1',
    })

    const req = new Request('http://localhost/api/workspaces/ws-1/home/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid_action' }),
    })
    const ctx = { params: Promise.resolve({ workspaceId: 'ws-1' }) }
    const res = await POST(req, ctx)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.success).toBe(false)
  })
})
