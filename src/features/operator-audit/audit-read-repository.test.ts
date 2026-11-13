import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorAuditEvents, getOperatorAuditEvent, type OperatorAuditReadRpcGateway } from './audit-read-repository'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const eventId = '22222222-2222-4222-8222-222222222222'
const row = {
  id: eventId, workspace_id: workspaceId, workspace_name: 'Workspace A', action: 'credit.adjust.requested',
  target_type: 'credit_account', target_label: '확인 전', result: 'succeeded', fact_kind: 'observed',
  reason: '운영 보정', approval_request_id: null, approval_status: 'none',
  before: {}, after: { status: 'pending' }, created_at: '2026-08-23T00:00:00.000Z',
  freshness: 'fresh', linked_event_count: 0,
}
const globalRow = { ...row, id: '33333333-3333-4333-8333-333333333333', workspace_id: null, workspace_name: null }
const operatorGateway = {
  getClaims: vi.fn(async () => ({ data: { claims: { sub: '99999999-9999-4999-8999-999999999999' } }, error: null })),
  getAal: vi.fn(async () => ({ data: { currentLevel: 'aal2' }, error: null })),
  getOperatorContext: vi.fn(async () => ({ data: { user_id: '99999999-9999-4999-8999-999999999999', status: 'active', permissions: ['audit.read'], workspace_scope: 'all', mfa_required: true, permission_scopes: [{ permission: 'audit.read', workspace_scope: 'all' }] }, error: null })),
}
function gateway(data: unknown = { items: [row], next_cursor: null }): OperatorAuditReadRpcGateway {
  return { rpc: vi.fn(async () => ({ data, error: null })) }
}

describe('operator audit safe read repository', () => {
  it('calls the safe list RPC with strict filters and removes sensitive fields', async () => {
    const read = gateway()
    const result = await listOperatorAuditEvents({ workspaceId, result: 'succeeded', limit: 20 }, { gateway: read, operatorGateway })
    expect(result.error).toBeNull()
    expect(read.rpc).toHaveBeenCalledWith('list_operator_audit_events', expect.objectContaining({ p_workspace_id: workspaceId, p_result: 'succeeded', p_limit: 20 }))
    expect(result.data?.items[0]).toMatchObject({ id: eventId, workspaceId, action: 'credit.adjust.requested' })
    expect(JSON.stringify(result)).not.toContain('idempotency_key')
  })

  it('fails closed on forbidden fields or workspace mismatch', async () => {
    await expect(listOperatorAuditEvents({}, { gateway: gateway({ items: [{ ...row, idempotency_key: 'secret' }], next_cursor: null }), operatorGateway })).resolves.toMatchObject({ data: null, error: 'AUDIT_READ_UNAVAILABLE' })
    await expect(getOperatorAuditEvent(eventId, { gateway: gateway({ ...row, workspace_id: '33333333-3333-4333-8333-333333333333' }), operatorGateway })).resolves.toMatchObject({ data: null, error: 'AUDIT_READ_UNAVAILABLE' })
  })

  it('accepts a global event and preserves the null workspace contract', async () => {
    const result = await listOperatorAuditEvents({}, { gateway: gateway({ items: [globalRow], next_cursor: null }), operatorGateway })
    expect(result.error).toBeNull()
    expect(result.data?.items[0]).toMatchObject({ workspaceId: null, workspaceName: null })
  })
})
