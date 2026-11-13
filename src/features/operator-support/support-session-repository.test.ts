import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorSupportSessions } from './support-session-repository'

const workspaceId = '45000000-0000-4000-8000-000000000001'
const operatorId = '45000000-0000-4000-8000-000000000002'

describe('operator support session repository', () => {
  it('reads only safe view-only session fields through the scoped RPC', async () => {
    const rpc = vi.fn(async () => ({ data: [{ session_id: '45000000-0000-4000-8000-000000000101', workspace_id: workspaceId, operator_user_id: operatorId, mode: 'view_only', status: 'active', reason: '운영 확인', close_reason: null, started_at: '2026-08-23T00:00:00.000Z', expires_at: '2026-08-23T00:30:00.000Z', closed_at: null }], error: null }))
    const result = await listOperatorSupportSessions(workspaceId, { gateway: { rpc } })
    expect(result.error).toBeNull()
    expect(result.data?.[0].mode).toBe('view_only')
    expect(rpc).toHaveBeenCalledWith('list_operator_support_sessions_v2', { p_workspace_id: workspaceId, p_limit: 50 })
  })

  it('rejects raw session or credential-shaped wire fields', async () => {
    const result = await listOperatorSupportSessions(undefined, { gateway: { rpc: async () => ({ data: [{ session_id: '45000000-0000-4000-8000-000000000101', workspace_id: workspaceId, operator_user_id: operatorId, mode: 'view_only', status: 'active', reason: '운영 확인', close_reason: null, started_at: '2026-08-23T00:00:00.000Z', expires_at: '2026-08-23T00:30:00.000Z', closed_at: null, session_cookie: 'raw' }], error: null }) } })
    expect(result).toEqual({ data: null, sourceState: 'unavailable', error: 'SUPPORT_SESSION_READ_UNAVAILABLE' })
  })
  it('preserves explicit empty source state from the versioned wrapper', async () => {
    await expect(listOperatorSupportSessions(workspaceId, { gateway: { rpc: async () => ({ data: { source_state: 'empty', items: [] }, error: null }) } })).resolves.toMatchObject({ data: [], sourceState: 'empty', error: null })
  })
})
