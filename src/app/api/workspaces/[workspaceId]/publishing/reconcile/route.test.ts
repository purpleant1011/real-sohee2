import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { authorize, serverClient, reconcile } = vi.hoisted(() => ({
  authorize: vi.fn(),
  serverClient: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: serverClient }))
vi.mock('@/features/external-actions/canonical-action-ledger', () => ({
  CanonicalActionLedgerService: { reconcileUnknownRequest: reconcile },
}))
vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(),
}))
vi.mock('@/lib/providers/instagram-provider', () => ({ getPostReadback: vi.fn() }))

const workspaceId = '00000000-0000-0000-0000-0000000000ff'
const ctx = () => ({ params: Promise.resolve({ workspaceId }) })
const request = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/publishing/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ actionRequestId: 'ar-1' }),
  })

beforeEach(() => {
  authorize.mockReset()
  serverClient.mockReset()
  reconcile.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  serverClient.mockResolvedValue({ from: vi.fn() })
})

describe('publishing reconcile route workspace authorization', () => {
  it('refuses a non-member before querying external action records', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await POST(request(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(serverClient).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
    expect(body).not.toContain('XTENANT_B_27770')
  })

  it('still validates the input for an active member', async () => {
    const response = await POST(
      new NextRequest(`https://example.test/api/workspaces/${workspaceId}/publishing/reconcile`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      ctx(),
    )

    expect(response.status).toBe(400)
    expect(reconcile).not.toHaveBeenCalled()
  })
})
