import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

const workspaceId = '00000000-0000-0000-0000-0000000000bc'
const ctx = () => ({ params: Promise.resolve({ workspaceId }) })
const getRequest = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/channels/naver/credentials`)
const postRequest = () =>
  new NextRequest(`https://example.test/api/workspaces/${workspaceId}/channels/naver/credentials`, {
    method: 'POST',
    body: JSON.stringify({ naverId: 'xtenant_b_27770', blogId: 'xtenant_b_27770' }),
  })

beforeEach(() => {
  authorize.mockReset()
  authorize.mockResolvedValue({ userId: 'user-owner', workspaceId, role: 'owner', supabase: {}, admin: {} })
})

describe('naver channel credentials route workspace authorization', () => {
  it('GET refuses a non-member before returning credentials', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await GET(getRequest(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).not.toContain('findk3')
    expect(body).not.toContain('blog.naver.com')
  })

  it('POST refuses a non-member before overwriting credentials', async () => {
    authorize.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).' }),
        { status: 403 },
      ),
    )

    const response = await POST(postRequest(), ctx())
    const body = await response.text()

    expect(response.status).toBe(403)
    expect(body).not.toContain('xtenant_b_27770')
  })

  it('returns credentials to an active member with autoPostEnabled always false', async () => {
    // V1.2 G0-02: GET 상태 조회는 autoPostEnabled 를 항상 false 로 응답
    const response = await GET(getRequest(), ctx())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.workspaceId).toBe(workspaceId)
    expect(data.autoPostEnabled).toBe(false)
    expect(data.status).toBe('MANUAL_ONLY')
    expect(JSON.stringify(data)).not.toMatch(/findk3|blog\.naver\.com|naverId/)
  })

  it('POST refuses credential saving even for an active member with 403 POLICY_DISABLED', async () => {
    // V1.2 G0-02: POST 자격증명 저장은 정책 정본에 따라 403 POLICY_DISABLED 로 즉시 차단
    const response = await POST(postRequest(), ctx())
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('login')
  })
})
