import { describe, expect, it, vi } from 'vitest'
import { loadReconciliationSupportQueue } from './reconciliation-support'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const row = { id: 'job', case_id: 'case', workspace_id: workspaceId, state: 'UNKNOWN', attempt: 1, updated_at: '2026-10-21T10:00:00Z', customer_ref: 'private', source_event_key: 'private-event', payload: 'private-message' }
function db(data: unknown[], error: unknown = null) {
  const filters: unknown[] = []
  const query: any = { select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query }, in: () => query, order: () => query, limit: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) }
  return { filters, from: vi.fn(() => query) }
}
describe('UNKNOWN support queue', () => {
  it('authorizes before reading and denies other-workspace access', async () => {
    const client = db([row])
    const authorize = vi.fn(async () => { throw new Error('DENIED') })
    await expect(loadReconciliationSupportQueue({ client, workspaceId, authorize })).rejects.toThrow('DENIED')
    expect(client.from).not.toHaveBeenCalled()
  })
  it('scopes rows, strips private data and never offers resend or success override', async () => {
    const client = db([row])
    const result = await loadReconciliationSupportQueue({ client, workspaceId, authorize: async () => undefined })
    expect(client.filters).toContainEqual(['workspace_id', workspaceId])
    expect(result).toMatchObject({ state: 'OBSERVED', items: [{ id: 'job', caseId: 'case', statusLabel: '결과 확인 필요', nextAction: 'READBACK_ONLY' }] })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('missing schema and query failure are not observed zero queues', async () => {
    await expect(loadReconciliationSupportQueue({ client: db([], { code: '42P01' }), workspaceId, authorize: async () => undefined })).rejects.toThrow('RECONCILIATION_QUERY_FAILED')
    await expect(loadReconciliationSupportQueue({ client: db(null as any), workspaceId, authorize: async () => undefined })).rejects.toThrow('RECONCILIATION_QUERY_FAILED')
    expect(await loadReconciliationSupportQueue({ client: db([]), workspaceId, authorize: async () => undefined })).toMatchObject({ state: 'OBSERVED', items: [] })
  })
  it('rejects unexpected cross-workspace rows even from privileged client', async () => {
    await expect(loadReconciliationSupportQueue({ client: db([{ ...row, workspace_id: 'other' }]), workspaceId, authorize: async () => undefined })).rejects.toThrow('RECONCILIATION_SCOPE_MISMATCH')
  })
})
