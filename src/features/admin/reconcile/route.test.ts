import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ requireOperator: vi.fn(), store: vi.fn(), port: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.requireOperator }))
vi.mock('./repository', () => ({ SupabaseReconcileStore: mocks.store }))
vi.mock('./readback-port', () => ({ operatorReadbackPort: mocks.port }))
import { POST } from '@/app/api/admin/reconcile/route'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

const ws = 'e1559000-0000-4000-8000-000000000001'
const id = 'e1559000-0000-4000-8000-000000000003'
const operator = 'e1559000-0000-4000-8000-000000000002'
const body = (action: string, extras: object = {}) => new Request('http://localhost/api/admin/reconcile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, workspaceId: ws, requestId: id, ...extras }) })
describe('ANI-1559 admin API refuses blind retry', () => {
  it('rejects retry on the server even for an authenticated operator and never calls provider write', async () => {
    mocks.requireOperator.mockResolvedValue({ userId: operator })
    mocks.store.mockImplementation(function () { return { loadRequest: async () => ({ id, workspace_id: ws, status: 'unknown_result' }) } })
    const response = await POST(body('retry'))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('대사')
  })
  it('requires operator permissions, mandatory reasons and no provider calls for manual confirmation', async () => {
    mocks.requireOperator.mockResolvedValue({ userId: operator })
    const response = await POST(body('manual_confirm', { decision: 'POST_PRESENT', reason: ' ' }))
    expect(response.status).toBe(400)
    mocks.requireOperator.mockRejectedValueOnce(new OperatorAccessError('PERMISSION_DENIED'))
    expect((await POST(body('retry'))).status).toBe(403)
  })
  it('maps unauthenticated operator to 401 by error code', async () => {
    mocks.requireOperator.mockRejectedValueOnce(new OperatorAccessError('AUTH_REQUIRED'))
    expect((await POST(body('retry'))).status).toBe(401)
  })
  it('does not confuse a storage error mentioning permissions with an operator denial', async () => {
    mocks.requireOperator.mockResolvedValueOnce({ userId: operator })
    mocks.store.mockImplementationOnce(function () { throw new Error('PERMISSION_DENIED on storage') })
    expect((await POST(body('retry'))).status).toBe(503)
  })
})
