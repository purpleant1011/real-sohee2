import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceListGetHandler } from './route'

const STORE_A = '10000000-0000-4000-8000-000000000001'
const STORE_B = '10000000-0000-4000-8000-000000000002'
const STORE_C = '10000000-0000-4000-8000-000000000003'

const memberships = [
  { workspace_id: STORE_A, role: 'owner', status: 'active' },
  { workspace_id: STORE_B, role: 'manager', status: 'active' },
]

function build(overrides: Partial<Parameters<typeof createWorkspaceListGetHandler>[0]> = {}) {
  const dependencies = {
    authenticate: vi.fn(async () => 'user-1'),
    readPreferredWorkspaceId: vi.fn(async () => null as string | null),
    listMemberships: vi.fn(async () => memberships as unknown[]),
    loadWorkspaceNames: vi.fn(async () => ({ [STORE_A]: '바이름 강남점', [STORE_B]: null })),
    ...overrides,
  }
  return { dependencies, handler: createWorkspaceListGetHandler(dependencies) }
}

describe('GET /api/workspaces', () => {
  it('로그인하지 않았으면 401 이고 조회하지 않는다', async () => {
    const listMemberships = vi.fn(async () => memberships)
    const { handler } = build({ authenticate: vi.fn(async () => null), listMemberships })

    const response = await handler()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: { code: 'AUTH_REQUIRED' } })
    expect(listMemberships).not.toHaveBeenCalled()
  })

  it('인증 확인이 던지면 500 이다', async () => {
    const { handler } = build({ authenticate: vi.fn(async () => { throw new Error('boom') }) })
    expect((await handler()).status).toBe(500)
  })

  it('활성 가게 목록과 서버가 확인한 이름을 돌려준다', async () => {
    const { handler } = build()

    const response = await handler()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body).toEqual({
      data: {
        loadState: 'ready',
        workspaces: [
          { id: STORE_A, name: '바이름 강남점', role: 'owner' },
          { id: STORE_B, name: null, role: 'manager' },
        ],
        activeId: STORE_A,
        fellBack: false,
      },
    })
  })

  it('선택한 가게에 접근할 수 없으면 첫 가게를 열고 fellBack 을 알린다', async () => {
    const { handler } = build({ readPreferredWorkspaceId: vi.fn(async () => STORE_C) })

    const body = await (await handler()).json()

    expect(body.data.activeId).toBe(STORE_A)
    expect(body.data.fellBack).toBe(true)
  })

  it('멤버십 응답 형식이 계약과 다르면 빈 목록이 아니라 500 이다', async () => {
    const { handler } = build({ listMemberships: vi.fn(async () => [{ workspace_id: 'nope' }]) })

    const response = await handler()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: { code: 'WORKSPACE_LIST_UNAVAILABLE' } })
  })

  it('멤버십 조회가 실패하면 0건으로 위장하지 않고 500 이다', async () => {
    const { handler } = build({ listMemberships: vi.fn(async () => { throw new Error('db down') }) })
    expect((await handler()).status).toBe(500)
  })

  it('가게 이름 조회가 실패하면 0건이 아니라 500 이다', async () => {
    const { handler } = build({ loadWorkspaceNames: vi.fn(async () => { throw new Error('db down') }) })
    expect((await handler()).status).toBe(500)
  })

  it('활성 멤버십이 없으면 loadState empty 로 정직하게 알린다', async () => {
    const { handler } = build({
      listMemberships: vi.fn(async () => [
        { workspace_id: STORE_A, role: 'owner', status: 'invited' },
      ]),
      loadWorkspaceNames: vi.fn(async () => ({})),
    })

    const body = await (await handler()).json()

    expect(body).toEqual({
      data: { loadState: 'empty', workspaces: [], activeId: null, fellBack: false },
    })
  })
})
