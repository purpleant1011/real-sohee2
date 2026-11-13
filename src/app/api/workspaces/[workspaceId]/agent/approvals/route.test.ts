import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const { authorize, getApprovals, resolveApproval } = vi.hoisted(() => ({
  authorize: vi.fn(),
  getApprovals: vi.fn(),
  resolveApproval: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/agent-session/agent-approval-service', () => ({
  AgentApprovalService: { getApprovals, resolveApproval },
}))

const workspaceId = '00000000-0000-0000-0000-0000000000ab'
const FOREIGN_MARKER = 'XTENANT_B_27770'

const ctx = () => ({ params: Promise.resolve({ workspaceId }) })
const getRequest = () => new NextRequest(`https://example.test/api/workspaces/${workspaceId}/agent/approvals`)
const postRequest = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/agent/approvals`, {
    method: 'POST',
    body: JSON.stringify({ proposalId: 'p-1', action: 'APPROVE', actorId: 'user-owner' }),
  })

beforeEach(() => {
  authorize.mockReset()
  getApprovals.mockReset()
  resolveApproval.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  getApprovals.mockResolvedValue([{ id: 'p-1', status: 'PENDING' }])
  resolveApproval.mockResolvedValue({ success: true, status: 'APPROVED', approval: { id: 'p-1' } })
})

describe('agent approvals route workspace authorization', () => {
  it('GET refuses a non-member before listing approvals', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await GET(getRequest(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(getApprovals).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('POST refuses a non-member before resolving an approval', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await POST(postRequest(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(resolveApproval).not.toHaveBeenCalled()
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('lists approvals for an active member', async () => {
    const response = await GET(getRequest(), ctx())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true })
    expect(getApprovals).toHaveBeenCalledWith(workspaceId, expect.anything())
  })

  it.each(['APPROVE', 'REJECT'])('uses the authenticated actor for %s even when the body forges another user', async (action) => {
    const request = new NextRequest(`https://example.test/api/workspaces/${workspaceId}/agent/approvals`, {
      method: 'POST',
      body: JSON.stringify({ proposalId: 'p-1', action, actorId: 'forged-owner' }),
    })

    const response = await POST(request, ctx())

    expect(response.status).toBe(200)
    expect(resolveApproval).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-owner', action }))
  })

  it.each(['reviewer', 'viewer'])('refuses execution approval from a %s before resolving the proposal', async (role) => {
    authorize.mockResolvedValueOnce({ userId: 'member-1', workspaceId, role, supabase: {}, admin: {} })

    const response = await POST(postRequest(), ctx())

    expect(response.status).toBe(403)
    expect(resolveApproval).not.toHaveBeenCalled()
  })

  it('allows an authenticated manager to resolve an approval', async () => {
    authorize.mockResolvedValueOnce({ userId: 'manager-1', workspaceId, role: 'manager', supabase: {}, admin: {} })

    const response = await POST(postRequest(), ctx())

    expect(response.status).toBe(200)
    expect(resolveApproval).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'manager-1' }))
  })

  it('resolves an approval for an active member', async () => {
    const response = await POST(postRequest(), ctx())

    expect(response.status).toBe(200)
    expect(resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, proposalId: 'p-1', action: 'APPROVE' }),
    )
  })
})
