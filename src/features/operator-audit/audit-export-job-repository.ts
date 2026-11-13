import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { auditExportJobListSchema, type AuditExportJob } from './audit-export-job-schemas'
export type AuditExportJobRpcGateway = Readonly<{ rpc(name: 'list_operator_audit_export_jobs', args: Readonly<{ p_limit: number }>): Promise<{ data: unknown; error: unknown }> }>
type Result = Readonly<{ data: readonly AuditExportJob[] | null; error: 'AUDIT_EXPORT_INPUT_INVALID' | 'AUDIT_EXPORT_UNAVAILABLE' | null }>
async function productionGateway(): Promise<AuditExportJobRpcGateway> { const client = await createServerSupabaseClient(); return { rpc: (name, args) => client.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> } }
export async function listOperatorAuditExportJobs(limit = 20, dependencies?: Readonly<{ gateway: AuditExportJobRpcGateway }>): Promise<Result> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { data: null, error: 'AUDIT_EXPORT_INPUT_INVALID' }
  try { const result = await (dependencies?.gateway ?? await productionGateway()).rpc('list_operator_audit_export_jobs', { p_limit: limit }); const wire = auditExportJobListSchema.safeParse(result.data); if (result.error || !wire.success) return { data: null, error: 'AUDIT_EXPORT_UNAVAILABLE' }; return { data: wire.data.items, error: null } } catch { return { data: null, error: 'AUDIT_EXPORT_UNAVAILABLE' } }
}
