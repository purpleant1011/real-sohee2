import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, publish } = vi.hoisted(() => ({ auth: vi.fn(), publish: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: auth, isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/vault/publish/batch-publish', () => ({ publishReleasedItems: publish }))
vi.mock('@/features/vault/publish/pg-dependencies', () => ({ createBatchPublishDependencies: () => ({}) }))

import { POST } from './route'

const context = { params: Promise.resolve({ workspaceId: 'shop' }) }
const request = (body: unknown) => new Request('https://example.com/api/workspaces/shop/vault/publish', { method: 'POST', body: JSON.stringify(body) })

describe('보관함 게시 경로', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ workspaceId: 'shop', userId: 'manager', admin: {} })
    publish.mockResolvedValue({ results: [], published: 0, blocked: 0, failed: 0, needs_check: 0 })
  })
  it('매장 관리자 권한과 매장 범위를 확인한다', async () => {
    expect((await POST(request({}), context)).status).toBe(200)
    expect(auth).toHaveBeenCalledWith('shop', { requireRole: 'manager', forbiddenMessage: '이 작업은 매장 관리자만 할 수 있어요.' })
    expect(publish.mock.calls[0][0]).toMatchObject({ workspaceId: 'shop', actorId: 'manager' })
  })
  it('잘못된 선택 또는 불허된 추가 필드는 실행하지 않는다', async () => {
    expect((await POST(request({ itemRefs: ['invalid'] }), context)).status).toBe(422)
    expect((await POST(request({ other: true }), context)).status).toBe(422)
    expect(publish).not.toHaveBeenCalled()
  })
  it('권한 거부 시 실행하지 않고 응답을 그대로 전달한다', async () => {
    auth.mockResolvedValueOnce(Response.json({ success: false, error: '이 작업은 매장 관리자만 할 수 있어요.' }, { status: 403 }))
    const response = await POST(request({}), context)
    expect(response.status).toBe(403)
    expect(publish).not.toHaveBeenCalled()
  })
})
