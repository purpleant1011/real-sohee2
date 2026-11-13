import 'server-only'
import { serializeAuditExportCsv, sha256Csv, type AuditExportRow } from './audit-export-serializer'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { z } from 'zod'

type ExportJob = Readonly<{ id: string; scope: 'workspace' | 'global'; workspaceId: string | null; from: string; to: string; status: 'queued' | 'running' }>
type Upload = (path: string, body: string) => Promise<void>
type Complete = (input: Readonly<{ jobId: string; path: string; hash: string; rowCount: number; byteSize: number }>) => Promise<void>
export type AuditExportExecutorDependencies = Readonly<{ upload: Upload; complete: Complete }>

function safeRows(job: ExportJob, rows: readonly AuditExportRow[]): readonly AuditExportRow[] {
  return rows.filter((row) => {
    const time = Date.parse(row.createdAt)
    return Number.isFinite(time) && time >= Date.parse(job.from) && time < Date.parse(job.to) && (job.scope === 'global' ? job.workspaceId === null : row.workspaceId === job.workspaceId)
  })
}

export async function executeAuditExportFixture(job: ExportJob, rows: readonly AuditExportRow[], dependencies: AuditExportExecutorDependencies): Promise<Readonly<{ hash: string; rowCount: number; byteSize: number }>> {
  if (job.status !== 'queued' && job.status !== 'running') throw new Error('AUDIT_EXPORT_STATE_INVALID')
  const selected = safeRows(job, rows)
  const csv = serializeAuditExportCsv(selected)
  const hash = await sha256Csv(csv)
  const path = `${job.scope}/${job.id}/audit.csv`
  await dependencies.upload(path, csv)
  const byteSize = new TextEncoder().encode(csv).byteLength
  await dependencies.complete({ jobId: job.id, path, hash, rowCount: selected.length, byteSize })
  return { hash, rowCount: selected.length, byteSize }
}

const claimSchema = z.object({ job_id: z.string().uuid(), scope: z.enum(['workspace', 'global']), workspace_id: z.string().uuid().nullable(), from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), status: z.literal('running') }).strict()
const rowSchema = z.object({ created_at: z.string().datetime({ offset: true }), workspace_name: z.string().nullable(), action: z.string(), target_type: z.string(), result: z.string(), fact_kind: z.string(), reason: z.string(), approval_status: z.string() }).strict()
export async function executeAuditExportJob(jobId: string): Promise<Readonly<{ hash: string; rowCount: number; byteSize: number }>> {
  if (!z.string().uuid().safeParse(jobId).success) throw new Error('AUDIT_EXPORT_INPUT_INVALID')
  const admin = createAdminSupabaseClient() as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>; storage: { from(bucket: string): { upload(path: string, body: string, options: Record<string, unknown>): Promise<{ error: unknown }>; remove(paths: string[]): Promise<{ error: unknown }> } } }
  let path = ''
  let claimSucceeded = false
  try {
    const claimed = await admin.rpc('claim_audit_export_job', { p_export_job_id: jobId })
    if (claimed.error) throw new Error('AUDIT_EXPORT_CLAIM_UNAVAILABLE')
    const job = claimSchema.parse(claimed.data)
    claimSucceeded = true
    const rowsResult = await admin.rpc('list_audit_export_rows', { p_export_job_id: job.job_id })
    if (rowsResult.error) throw new Error('AUDIT_EXPORT_SOURCE_UNAVAILABLE')
    const rows = z.array(rowSchema).parse(rowsResult.data).map((row) => ({ createdAt: row.created_at, workspaceId: job.workspace_id, workspaceName: row.workspace_name, action: row.action, targetType: row.target_type, result: row.result, factKind: row.fact_kind, reason: row.reason, approvalStatus: row.approval_status }))
    const csv = serializeAuditExportCsv(rows)
    const hash = await sha256Csv(csv)
    path = `${job.scope}/${job.job_id}/audit.csv`
    const uploaded = await admin.storage.from('audit-exports').upload(path, csv, { contentType: 'text/csv', upsert: true })
    if (uploaded.error) throw new Error('AUDIT_EXPORT_UPLOAD_UNAVAILABLE')
    const byteSize = new TextEncoder().encode(csv).byteLength
    const completed = await admin.rpc('complete_audit_export_job', { p_export_job_id: job.job_id, p_storage_path: path, p_content_sha256: hash, p_row_count: rows.length, p_byte_size: byteSize })
    if (completed.error) throw new Error('AUDIT_EXPORT_COMPLETE_UNAVAILABLE')
    return { hash, rowCount: rows.length, byteSize }
  } catch (error) {
    if (path) { try { await admin.storage.from('audit-exports').remove([path]) } catch { /* best effort cleanup */ } }
    const safeCode = error instanceof Error && /^AUDIT_EXPORT_[A-Z_]+$/u.test(error.message) ? error.message : 'AUDIT_EXPORT_UNAVAILABLE'
    if (claimSucceeded) { try { await admin.rpc('fail_audit_export_job', { p_export_job_id: jobId, p_error_code: safeCode }) } catch { /* bounded failure recording */ } }
    throw new Error(safeCode)
  }
}

export async function cleanupExpiredAuditExportJobs(): Promise<number> {
  const admin = createAdminSupabaseClient() as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>; storage: { from(bucket: string): { remove(paths: string[]): Promise<{ error: unknown }> } } }
  const result = await admin.rpc('expire_audit_export_jobs', { p_now: new Date().toISOString() })
  const rows = z.array(z.object({ job_id: z.string().uuid(), storage_bucket: z.literal('audit-exports').nullable(), storage_path: z.string().nullable() }).strict()).safeParse(result.data)
  if (result.error || !rows.success) throw new Error('AUDIT_EXPORT_CLEANUP_UNAVAILABLE')
  let removed = 0
  for (const row of rows.data) {
    if (row.storage_path) { const deleted = await admin.storage.from('audit-exports').remove([row.storage_path]); if (!deleted.error) removed += 1 }
  }
  return removed
}
