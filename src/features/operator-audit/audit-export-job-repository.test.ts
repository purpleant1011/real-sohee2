import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorAuditExportJobs } from './audit-export-job-repository'
const job = { id: '10000000-0000-4000-8000-000000000001', status: 'succeeded', scope: 'workspace', workspace_name: '고객사', export_from: '2026-08-23T00:00:00.000Z', export_to: '2026-08-24T00:00:00.000Z', filter_fingerprint_prefix: 'abcdef12', filter_fingerprint_present: true, generated_at: '2026-08-23T01:00:00.000Z', row_count: 2, expires_at: '2026-08-24T00:00:00.000Z', created_at: '2026-08-23T01:00:00.000Z', integrity_state: 'hash_recorded', event_chain_state: 'unknown', freshness: 'fresh' }
describe('audit export job repository', () => {
  it('returns only safe metadata and rejects storage-shaped fields', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [job] }, error: null }))
    await expect(listOperatorAuditExportJobs(20, { gateway: { rpc } })).resolves.toMatchObject({ data: [{ id: job.id, filter_fingerprint_prefix: 'abcdef12' }] })
    expect(rpc).toHaveBeenCalledWith('list_operator_audit_export_jobs', { p_limit: 20 })
    await expect(listOperatorAuditExportJobs(20, { gateway: { rpc: vi.fn(async () => ({ data: { items: [{ ...job, storage_path: 'secret' }] }, error: null })) } })).resolves.toMatchObject({ data: null, error: 'AUDIT_EXPORT_UNAVAILABLE' })
  })
})
