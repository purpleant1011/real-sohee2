import 'server-only'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({ approvalRequestId: z.string().uuid() }).strict()
const responseSchema = z.object({ export_job_id: z.string().uuid(), status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired']), expires_at: z.string().datetime({ offset: true }) }).strict()
export type AuditExportRpcGateway = Readonly<{ rpc(name: 'create_approved_audit_export_job', args: Readonly<{ p_approval_request_id: string }>): Promise<{ data: unknown; error: unknown }> }>
export type AuditExportError = 'AUDIT_EXPORT_INPUT_INVALID' | 'AUDIT_EXPORT_UNAVAILABLE'
type Dependencies = Readonly<{ gateway: AuditExportRpcGateway }>
type Result = Readonly<{ data: Readonly<{ exportJobId: string; status: z.infer<typeof responseSchema>['status']; expiresAt: string }> | null; error: AuditExportError | null }>
async function productionGateway(): Promise<AuditExportRpcGateway> { const client = await createServerSupabaseClient(); return { rpc: (name, args) => client.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> } }
export async function createAuditExportJob(input: unknown, dependencies?: Dependencies): Promise<Result> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { data: null, error: 'AUDIT_EXPORT_INPUT_INVALID' }
  try {
    const result = await (dependencies?.gateway ?? await productionGateway()).rpc('create_approved_audit_export_job', { p_approval_request_id: parsed.data.approvalRequestId })
    const wire = responseSchema.safeParse(result.data)
    if (result.error || !wire.success) return { data: null, error: 'AUDIT_EXPORT_UNAVAILABLE' }
    return { data: { exportJobId: wire.data.export_job_id, status: wire.data.status, expiresAt: wire.data.expires_at }, error: null }
  } catch { return { data: null, error: 'AUDIT_EXPORT_UNAVAILABLE' } }
}
