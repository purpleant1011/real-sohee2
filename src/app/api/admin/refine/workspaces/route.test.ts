import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
  listOperatorWorkspaces: vi.fn(async () => ({ data: { items: [{ workspaceId: '11111111-1111-4111-8111-111111111111', workspaceName: '바이름' }], nextCursor: null }, error: null })),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperatorAnyScope: mocks.requireOperatorAnyScope }))
vi.mock('@/features/operator-workspaces/repository', () => ({ listOperatorWorkspaces: mocks.listOperatorWorkspaces }))

import { GET } from './route'

describe('GET /api/admin/refine/workspaces', () => {
  beforeEach(() => vi.clearAllMocks())

  it('guards the endpoint and maps the operator RPC projection to Refine records', async () => {
    const response = await GET(new Request('https://sohee.local/api/admin/refine/workspaces?page=1&pageSize=25&query=%EB%B0%94%EC%9D%B4%EB%A6%84&status=active'))
    expect(mocks.requireOperatorAnyScope).toHaveBeenCalledWith('workspace.read')
    expect(mocks.listOperatorWorkspaces).toHaveBeenCalledWith({ cursor: null, query: '바이름', status: 'active', limit: 25 })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: [{ id: '11111111-1111-4111-8111-111111111111', workspaceName: '바이름' }], total: 1, nextCursor: null })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects unsupported pagination and invalid lifecycle filters', async () => {
    await expect(GET(new Request('https://sohee.local/api/admin/refine/workspaces?page=2&pageSize=25'))).resolves.toMatchObject({ status: 400 })
    await expect(GET(new Request('https://sohee.local/api/admin/refine/workspaces?page=1&status=invalid'))).resolves.toMatchObject({ status: 400 })
    expect(mocks.listOperatorWorkspaces).not.toHaveBeenCalled()
  })
})
