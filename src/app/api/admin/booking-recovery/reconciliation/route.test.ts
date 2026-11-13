import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), client: vi.fn(), load: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.authorize }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.client }))
vi.mock('@/features/capabilities/reconciliation-support', () => ({ loadReconciliationSupportQueue: mocks.load }))
import { GET } from './route'
const workspace = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({}); mocks.client.mockReturnValue({}); mocks.load.mockResolvedValue({ state: 'OBSERVED', items: [] }) })
describe('operator reconciliation queue', () => {
  it('authorizes the exact workspace before creating privileged client', async () => {
    mocks.authorize.mockRejectedValue(new Error('denied'))
    const response = await GET(new Request(`http://localhost/api/admin/booking-recovery/reconciliation?workspaceId=${workspace}`))
    expect(response.status).toBe(403)
    expect(mocks.authorize).toHaveBeenCalledWith('booking.read', workspace)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('schema absence returns service unavailable instead of zero work', async () => {
    mocks.load.mockRejectedValue(new Error('RECONCILIATION_QUERY_FAILED'))
    const response = await GET(new Request(`http://localhost/api/admin/booking-recovery/reconciliation?workspaceId=${workspace}`))
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects unscoped or invalid workspace and returns safe observed queue', async () => {
    expect((await GET(new Request('http://localhost/api/admin/booking-recovery/reconciliation'))).status).toBe(400)
    const response = await GET(new Request(`http://localhost/api/admin/booking-recovery/reconciliation?workspaceId=${workspace}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'OBSERVED', items: [] })
  })
})
