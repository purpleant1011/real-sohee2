import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { createAuditExportJob, type AuditExportRpcGateway } from './audit-export-repository'

const id = '10000000-0000-4000-8000-000000000001'
const gateway = (data: unknown = { export_job_id: id, status: 'queued', expires_at: '2026-08-24T00:00:00.000Z' }): AuditExportRpcGateway => ({ rpc: vi.fn(async () => ({ data, error: null })) })

describe('audit export repository', () => {
  it('calls the approved-only job RPC and returns safe fields', async () => {
    const read = gateway()
    await expect(createAuditExportJob({ approvalRequestId: id }, { gateway: read })).resolves.toEqual({ data: { exportJobId: id, status: 'queued', expiresAt: '2026-08-24T00:00:00.000Z' }, error: null })
    expect(read.rpc).toHaveBeenCalledWith('create_approved_audit_export_job', { p_approval_request_id: id })
  })
  it('fails closed on storage-shaped response fields', async () => {
    await expect(createAuditExportJob({ approvalRequestId: id }, { gateway: gateway({ export_job_id: id, status: 'queued', expires_at: '2026-08-24T00:00:00.000Z', storage_path: 'secret' }) })).resolves.toMatchObject({ data: null, error: 'AUDIT_EXPORT_UNAVAILABLE' })
  })
})
