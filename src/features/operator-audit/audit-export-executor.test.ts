import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { executeAuditExportFixture } from './audit-export-executor'

const job = { id: '10000000-0000-4000-8000-000000000001', scope: 'workspace' as const, workspaceId: '20000000-0000-4000-8000-000000000001', from: '2026-08-23T00:00:00.000Z', to: '2026-08-24T00:00:00.000Z', status: 'queued' as const }
const row = { createdAt: '2026-08-23T12:00:00.000Z', workspaceId: job.workspaceId, workspaceName: '고객사', action: 'audit.export.workspace.applied', targetType: 'platform_audit_export', result: 'succeeded', factKind: 'observed', reason: '사유', approvalStatus: 'applied' }

describe('audit export executor fixture', () => {
  it('uploads only scoped rows and completes with canonical hash metadata', async () => {
    const upload = vi.fn(async (_path: string, body: string) => { expect(body).toContain('고객사') })
    const complete = vi.fn(async () => {})
    await expect(executeAuditExportFixture(job, [row, { ...row, createdAt: '2026-08-24T00:00:00.000Z', workspaceName: 'other' }], { upload, complete })).resolves.toMatchObject({ rowCount: 1 })
    expect(upload).toHaveBeenCalledWith(`${job.scope}/${job.id}/audit.csv`, expect.any(String))
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ jobId: job.id, rowCount: 1, hash: expect.stringMatching(/^[a-f0-9]{64}$/u) }))
  })
})
