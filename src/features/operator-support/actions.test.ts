import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({ rpc })) }))
import { startOperatorSupportSessionAction, endOperatorSupportSessionAction } from './actions'

describe('operator support actions', () => {
  beforeEach(() => { vi.resetAllMocks(); rpc.mockResolvedValue({ data: { session_id: '45000000-0000-4000-8000-000000000101', status: 'active', replayed: false }, error: null }) })
  it('rejects malformed start input before RPC', async () => {
    const result = await startOperatorSupportSessionAction({ workspaceId: 'bad', reason: '운영 확인', idempotencyKey: 'bad' })
    expect(result).toMatchObject({ error: { requestId: 'support-session-start' } })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('forwards only safe support-session arguments', async () => {
    const result = await startOperatorSupportSessionAction({ workspaceId: '45000000-0000-4000-8000-000000000001', reason: '운영 확인', idempotencyKey: '45000000-0000-4000-8000-000000000002' })
    expect(result).toEqual({ data: { sessionId: '45000000-0000-4000-8000-000000000101', status: 'active', replayed: false } })
    expect(rpc).toHaveBeenCalledWith('start_operator_support_session', { p_workspace_id: '45000000-0000-4000-8000-000000000001', p_reason: '운영 확인', p_idempotency_key: '45000000-0000-4000-8000-000000000002' })
  })
  it('returns a safe failure for malformed end input', async () => {
    const result = await endOperatorSupportSessionAction({ sessionId: 'bad', idempotencyKey: 'bad' })
    expect(result).toMatchObject({ error: { requestId: 'support-session-end' } })
    expect(JSON.stringify(result)).not.toContain('raw')
  })
})
