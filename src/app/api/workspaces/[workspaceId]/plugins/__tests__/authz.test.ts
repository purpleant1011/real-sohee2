import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '../route'

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

const workspaceId = '00000000-0000-0000-0000-0000000000cd'
const FOREIGN_MARKER = 'XTENANT_B_27770'

const ctx = () => ({ params: Promise.resolve({ workspaceId }) })
const getRequest = () => new NextRequest(`https://example.test/api/workspaces/${workspaceId}/plugins`)
const postRequest = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/plugins`, {
    method: 'POST',
    body: JSON.stringify({ action: 'INSTALL', pluginId: 'plg_google_ads_intelligence' }),
  })

const denial = () =>
  new Response(
    JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
    { status: 403 },
  )

beforeEach(() => {
  authorize.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
})

describe('plugins route workspace authorization', () => {
  it('GET refuses a non-member before listing plugin installations', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await GET(getRequest(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).not.toContain('plg_')
    expect(body).not.toContain(FOREIGN_MARKER)
  })

  it('POST refuses a non-member before installing a plugin', async () => {
    authorize.mockResolvedValueOnce(denial())

    const response = await POST(postRequest(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).not.toContain('plg_google_ads_intelligence')
  })

  it('serves the catalog to an active member', async () => {
    const response = await GET(getRequest(), ctx())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.plugins).toBeDefined()
  })
})
