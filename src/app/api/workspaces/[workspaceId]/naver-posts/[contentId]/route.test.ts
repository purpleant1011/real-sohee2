import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  authorizeQuickRequest: vi.fn(),
  getApprovalPreview: vi.fn(),
  approveAndDispatchAction: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorizeQuickRequest,
  isResponse: (val: unknown) => val instanceof Response,
}))

vi.mock('@/features/approvals/approval-preview-repository', () => ({
  getApprovalPreview: mocks.getApprovalPreview,
}))

vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({
  approveAndDispatchAction: mocks.approveAndDispatchAction,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

const workspaceId = '00000000-0000-0000-0000-000000000001'
const contentId = '00000000-0000-0000-0000-000000000002'
const ctx = { params: Promise.resolve({ workspaceId, contentId }) }

describe('POST /api/workspaces/[workspaceId]/naver-posts/[contentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerSupabaseClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [] }),
                }),
              }),
            }),
          }),
        }),
      }),
    })
  })

  it('fails closed with 403 POLICY_DISABLED and zero dispatch calls when authorized', async () => {
    mocks.authorizeQuickRequest.mockResolvedValue({ workspaceId, userId: 'user-1', role: 'manager' })

    const request = new Request(`https://example.com/api/workspaces/${workspaceId}/naver-posts/${contentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: 'ver-1' }),
    })

    const response = await POST(request, ctx)
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('publish')
    expect(mocks.approveAndDispatchAction).not.toHaveBeenCalled()
  })

  it('preserves auth failure response when unauthorized', async () => {
    mocks.authorizeQuickRequest.mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))

    const request = new Request(`https://example.com/api/workspaces/${workspaceId}/naver-posts/${contentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: 'ver-1' }),
    })

    const response = await POST(request, ctx)
    expect(response.status).toBe(401)
    expect(mocks.approveAndDispatchAction).not.toHaveBeenCalled()
  })

  it('retains GET read-only preview method', async () => {
    mocks.authorizeQuickRequest.mockResolvedValue({ workspaceId, userId: 'user-1', role: 'manager' })
    mocks.getApprovalPreview.mockResolvedValue({
      data: { versionId: 'ver-1', title: '제목', body: '본문' },
    })

    const request = new Request(`https://example.com/api/workspaces/${workspaceId}/naver-posts/${contentId}`, {
      method: 'GET',
    })

    const response = await GET(request, ctx)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.data.preview.title).toBe('제목')
  })
})
