import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorPublishOperations } from './publish-read-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const otherWorkspaceId = '10000000-0000-4000-8000-000000000002'
const id = '20000000-0000-4000-8000-000000000001'
const fingerprint = 'a'.repeat(64)

const row = (overrides: Record<string, unknown> = {}) => ({
  workspace_id: workspaceId, workspace_name: '고객사', content_id: id, content_title: '제목', channel: 'instagram',
  current_version_id: id, current_version_number: 2, current_fingerprint: fingerprint,
  approval_id: id, approved_version_id: id, approved_version_number: 2, approval_fingerprint: fingerprint,
  approval_status: 'approved', approval_decided_at: '2026-08-23T00:00:00Z', fingerprint_match: true,
  schedule_id: id, publish_at: '2026-08-24T00:00:00Z', timezone: 'Asia/Seoul', schedule_status: 'scheduled',
  display_state: 'pending', attempt_number: null, attempt_status: null,
  provider_reference_present: false, provider_request_id_present: false, failure_code: null,
  recovery_status: null, idempotency_result: 'not_recorded', destination_url_present: false,
  published_at: null, freshness: 'fresh', ...overrides,
})

const operatorGateway = {
  getClaims: vi.fn(async () => ({ data: { claims: { sub: workspaceId, aal: 'aal2' } }, error: null })),
  getAal: vi.fn(async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null })),
  getOperatorContext: vi.fn(async () => ({ data: {
    user_id: workspaceId, status: 'active', mfa_required: true, workspace_scope: 'all',
    permissions: ['publish.read'], permission_scopes: [{ permission: 'publish.read', workspace_scope: 'all' }],
  }, error: null })),
}

describe('listOperatorPublishOperations', () => {
  it('uses only the scoped RPC and normalizes safe evidence fields', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [row()], next_cursor: null }, error: null }))
    const result = await listOperatorPublishOperations({}, { gateway: { rpc }, operatorGateway })
    expect(result.error).toBeNull()
    expect(result.data?.items[0]).toMatchObject({ displayState: 'pending', fingerprintMatch: true, idempotencyResult: 'not_recorded' })
    expect(JSON.stringify(result)).not.toContain('provider_reference')
    expect(JSON.stringify(result)).not.toContain('idempotency_key')
    expect(rpc).toHaveBeenCalledWith('list_operator_publish_operations', expect.objectContaining({ p_workspace_id: null, p_status: null }))
  })

  it('rejects a row that violates an explicitly requested workspace scope', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [row({ workspace_id: otherWorkspaceId })], next_cursor: null }, error: null }))
    const result = await listOperatorPublishOperations({ workspaceId }, { gateway: { rpc }, operatorGateway })
    expect(result).toEqual({ data: null, error: 'PUBLISH_READ_UNAVAILABLE' })
  })

  it.each([
    ['publishing', { schedule_status: 'publishing', display_state: 'publishing' }],
    ['success', { schedule_status: 'published', display_state: 'success', attempt_status: 'succeeded', provider_reference_present: true, destination_url_present: true }],
    ['failure', { schedule_status: 'failed', display_state: 'failure', attempt_status: 'failed', failure_code: 'PROVIDER_REJECTED' }],
    ['unknown', { schedule_status: 'unknown', display_state: 'unknown', attempt_status: 'unknown', failure_code: 'RESULT_UNKNOWN', recovery_status: 'reconcile_required' }],
  ])('preserves the %s display state', async (_name, overrides) => {
    const rpc = vi.fn(async () => ({ data: { items: [row(overrides)], next_cursor: null }, error: null }))
    const result = await listOperatorPublishOperations({}, { gateway: { rpc }, operatorGateway })
    expect(result.data?.items[0].displayState).toBe(overrides.display_state)
  })
})
