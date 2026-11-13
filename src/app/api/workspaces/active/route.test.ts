import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceSwitchPostHandler } from './route'

const STORE_B = '10000000-0000-4000-8000-000000000002'

function request(body: unknown) {
  return new Request('https://example.com/api/workspaces/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function build(overrides: Partial<Parameters<typeof createWorkspaceSwitchPostHandler>[0]> = {}) {
  const dependencies = {
    authenticate: vi.fn(async () => 'user-1' as string | null),
    verifyMembership: vi.fn(async () => 'active' as const),
    persistActiveWorkspace: vi.fn(async () => {}),
    ...overrides,
  }
  return { dependencies, handler: createWorkspaceSwitchPostHandler(dependencies) }
}

describe('POST /api/workspaces/active', () => {
  it('로그인하지 않았으면 401 이고 아무것도 저장하지 않는다', async () => {
    const { dependencies, handler } = build({ authenticate: vi.fn(async () => null) })

    const response = await handler(request({ workspaceId: STORE_B }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: { code: 'AUTH_REQUIRED' } })
    expect(dependencies.persistActiveWorkspace).not.toHaveBeenCalled()
  })

  it('가게 id 형식이 틀리면 400 이다', async () => {
    const { dependencies, handler } = build()

    expect((await handler(request({ workspaceId: 'not-a-uuid' }))).status).toBe(400)
    expect((await handler(request({ workspaceId: STORE_B, role: 'owner' }))).status).toBe(400)
    expect((await handler(new Request('https://example.com/api/workspaces/active', {
      method: 'POST',
      body: '{',
    }))).status).toBe(400)
    expect(dependencies.persistActiveWorkspace).not.toHaveBeenCalled()
  })

  it('멤버가 아닌 가게는 403 이고 쿠키를 쓰지 않는다', async () => {
    const { dependencies, handler } = build({ verifyMembership: vi.fn(async () => 'forbidden' as const) })

    const response = await handler(request({ workspaceId: STORE_B }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: { code: 'WORKSPACE_FORBIDDEN' } })
    expect(dependencies.persistActiveWorkspace).not.toHaveBeenCalled()
  })

  it('없는 가게도 403 이고 쿠키를 쓰지 않는다', async () => {
    const { dependencies, handler } = build({ verifyMembership: vi.fn(async () => 'not_found' as const) })

    expect((await handler(request({ workspaceId: STORE_B }))).status).toBe(403)
    expect(dependencies.persistActiveWorkspace).not.toHaveBeenCalled()
  })

  it('멤버십 재검증이 불가능하면 500 이고 쿠키를 쓰지 않는다', async () => {
    const { dependencies, handler } = build({
      verifyMembership: vi.fn(async () => { throw new Error('db down') }),
    })

    expect((await handler(request({ workspaceId: STORE_B }))).status).toBe(500)
    expect(dependencies.persistActiveWorkspace).not.toHaveBeenCalled()
  })

  it('검증을 통과하면 그 가게를 저장하고 activeId 를 돌려준다', async () => {
    const { dependencies, handler } = build()

    const response = await handler(request({ workspaceId: STORE_B }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ data: { activeId: STORE_B } })
    expect(dependencies.verifyMembership).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: STORE_B })
    expect(dependencies.persistActiveWorkspace).toHaveBeenCalledWith(STORE_B)
  })

  it('쿠키 저장이 실패하면 성공이라고 하지 않는다', async () => {
    const { handler } = build({
      persistActiveWorkspace: vi.fn(async () => { throw new Error('cookie write failed') }),
    })

    const response = await handler(request({ workspaceId: STORE_B }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: { code: 'WORKSPACE_SELECTION_UNAVAILABLE' } })
  })
})
