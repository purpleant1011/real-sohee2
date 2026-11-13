import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOperatorAnyScope: vi.fn(),
  requireOperator: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: mocks.requireOperatorAnyScope,
  requireOperator: mocks.requireOperator,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))

import { OperatorAccessError } from '@/features/operator-auth/current-operator'
import { POST } from './route'

describe('POST /api/admin/channels/naver-categories/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthorized requests with 403 when operator lacks channel scopes', async () => {
    mocks.requireOperatorAnyScope.mockRejectedValue(new OperatorAccessError('PERMISSION_DENIED'))
    mocks.requireOperator.mockRejectedValue(new OperatorAccessError('PERMISSION_DENIED'))

    const request = new Request('http://localhost/api/admin/channels/naver-categories/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(request)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('PERMISSION_DENIED')
  })

  it('rejects with 401 when operator authentication is missing', async () => {
    mocks.requireOperatorAnyScope.mockRejectedValue(new OperatorAccessError('AUTH_REQUIRED'))
    mocks.requireOperator.mockRejectedValue(new OperatorAccessError('AUTH_REQUIRED'))

    const request = new Request('http://localhost/api/admin/channels/naver-categories/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(request)
    expect(res.status).toBe(401)
  })

  it('returns 404 if naver_blog connection is not found', async () => {
    // V1.2 G0-02: 정책 정본에 따라 DB 조회 전에 403 POLICY_DISABLED 로 즉시 차단, DB mock 미호출
    mocks.requireOperatorAnyScope.mockResolvedValue({ userId: 'admin-1' })
    const chain: any = {
      eq: vi.fn().mockImplementation(() => chain),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const mockDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(chain),
      }),
    }
    mocks.createAdminSupabaseClient.mockReturnValue(mockDb)

    const request = new Request('http://localhost/api/admin/channels/naver-categories/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(request)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('fill')
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled()
  })

  it('successfully syncs categories for target connection', async () => {
    // V1.2 G0-02: 정책 정본에 따라 정상 동기화 요청도 403 POLICY_DISABLED 로 즉시 차단, DB mock 미호출
    mocks.requireOperatorAnyScope.mockResolvedValue({ userId: 'admin-1' })

    const workspaceId = '24000000-0000-4000-8000-000000000001'

    const request = new Request('http://localhost/api/admin/channels/naver-categories/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })

    const res = await POST(request)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('fill')
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled()
  })
})
