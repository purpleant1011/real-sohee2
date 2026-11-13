import 'server-only'
import { z } from 'zod'
import { requireOperatorAnyScope, type OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const uuid = z.string().uuid()
const wireSchema = z.object({ workspace_id: uuid.nullable(), storage_path: z.string().regex(/^(workspace|global)\/[0-9a-f-]{36}\/audit\.csv$/u), expires_at: z.string().datetime({ offset: true }) }).strict()
type RpcGateway = Readonly<{ rpc(name: 'get_audit_export_download', args: Readonly<{ p_export_job_id: string }>): Promise<{ data: unknown; error: unknown }> }>
type Signer = (path: string, seconds: number) => Promise<string>
type Dependencies = Readonly<{ gateway: RpcGateway; operatorGateway?: OperatorAuthGateway; sign?: Signer }>
export type AuditExportDownloadError = 'AUDIT_EXPORT_INPUT_INVALID' | 'AUDIT_EXPORT_EXPIRED' | 'AUDIT_EXPORT_UNAVAILABLE'
async function productionGateway(): Promise<RpcGateway> { const client = await createServerSupabaseClient(); return { rpc: (name, args) => client.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> } }
async function productionSign(path: string, seconds: number): Promise<string> { const client = createAdminSupabaseClient(); const result = await client.storage.from('audit-exports').createSignedUrl(path, seconds); if (result.error || !result.data?.signedUrl) throw new Error('AUDIT_EXPORT_UNAVAILABLE'); return result.data.signedUrl }
export async function getAuditExportDownload(jobId: string, dependencies?: Dependencies): Promise<Readonly<{ url: string; error: AuditExportDownloadError | null }>> {
  if (!uuid.safeParse(jobId).success) return { url: '', error: 'AUDIT_EXPORT_INPUT_INVALID' }
  try {
    await requireOperatorAnyScope('audit.read', dependencies?.operatorGateway)
    const result = await (dependencies?.gateway ?? await productionGateway()).rpc('get_audit_export_download', { p_export_job_id: jobId })
    const wire = wireSchema.safeParse(result.data)
    if (result.error || !wire.success) return { url: '', error: 'AUDIT_EXPORT_UNAVAILABLE' }
    const remaining = Math.floor((Date.parse(wire.data.expires_at) - Date.now()) / 1000)
    if (remaining <= 0) return { url: '', error: 'AUDIT_EXPORT_EXPIRED' }
    const url = await (dependencies?.sign ?? productionSign)(wire.data.storage_path, Math.min(60, remaining))
    return { url, error: null }
  } catch { return { url: '', error: 'AUDIT_EXPORT_UNAVAILABLE' } }
}
