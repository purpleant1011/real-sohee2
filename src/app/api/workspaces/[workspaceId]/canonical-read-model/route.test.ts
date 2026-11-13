import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const { authorize, readModel, serverClient } = vi.hoisted(() => ({
  authorize: vi.fn(),
  readModel: vi.fn(),
  serverClient: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/canonical-read-model/server', () => ({
  getWorkspaceCanonicalReadModel: readModel,
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: serverClient }))

const workspaceId = '00000000-0000-0000-0000-0000000000aa'
const context = { params: Promise.resolve({ workspaceId }) }
const request = () => new NextRequest(`https://example.test/api/workspaces/${workspaceId}/canonical-read-model`)

const canonicalFixture = {
  workspaceId,
  businessName: { state: 'AVAILABLE', value: '살롱 드 바이름' },
  channels: [{ channel: 'instagram', state: 'CONNECTED' }],
}

beforeEach(() => {
  authorize.mockReset()
  readModel.mockReset()
  serverClient.mockReset()
  serverClient.mockResolvedValue({ from: vi.fn() })
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
  readModel.mockResolvedValue(canonicalFixture)
})

describe('canonical read model route', () => {
  it('returns the canonical read model unchanged for an active member', async () => {
    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: canonicalFixture })
    // Credentials are service-role-only; authorization must precede the scoped projection.
    const auth = await authorize.mock.results[0].value
    expect(readModel).toHaveBeenCalledWith(workspaceId, auth.admin)
    expect(serverClient).not.toHaveBeenCalled()
  })

  it('refuses a non-member with 403 before building the read model (E2E-F F-2)', async () => {
    authorize.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }), {
        status: 403,
      }),
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(403)
    expect(readModel).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('살롱 드 바이름')
  })
})
