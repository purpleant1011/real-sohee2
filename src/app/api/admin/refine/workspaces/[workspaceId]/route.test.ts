import { beforeEach, describe, expect, it, vi } from 'vitest'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
  getOperatorWorkspace: vi.fn(async () => ({ data: { workspaceId, workspaceName: '바이름' }, error: null })),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.requireOperator }))
vi.mock('@/features/operator-workspaces/repository', () => ({ getOperatorWorkspace: mocks.getOperatorWorkspace }))

import { GET } from './route'

describe('GET /api/admin/refine/workspaces/:workspaceId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks the exact workspace scope and returns one Refine record', async () => {
    const response = await GET(new Request(`https://sohee.local/api/admin/refine/workspaces/${workspaceId}`), { params: Promise.resolve({ workspaceId }) })
    expect(mocks.requireOperator).toHaveBeenCalledWith('workspace.read', workspaceId)
    expect(mocks.getOperatorWorkspace).toHaveBeenCalledWith(workspaceId)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { id: workspaceId, workspaceId, workspaceName: '바이름' } })
  })

  it('rejects malformed workspace identities before repository access', async () => {
    const response = await GET(new Request('https://sohee.local/api/admin/refine/workspaces/not-a-uuid'), { params: Promise.resolve({ workspaceId: 'not-a-uuid' }) })
    expect(response.status).toBe(400)
    expect(mocks.requireOperator).not.toHaveBeenCalled()
    expect(mocks.getOperatorWorkspace).not.toHaveBeenCalled()
  })
})
