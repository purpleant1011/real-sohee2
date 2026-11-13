import { z } from 'zod'
const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
export const auditExportJobSchema = z.object({ id: uuid, status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired']), scope: z.enum(['workspace', 'global']), workspace_name: z.string().nullable(), export_from: timestamp, export_to: timestamp, filter_fingerprint_prefix: z.string().regex(/^[a-f0-9]{0,8}$/u).nullable(), filter_fingerprint_present: z.boolean(), generated_at: timestamp.nullable(), row_count: z.number().int().nonnegative().nullable(), expires_at: timestamp, created_at: timestamp, integrity_state: z.enum(['hash_recorded', 'verification_pending', 'verified', 'failed']), event_chain_state: z.enum(['verified', 'unknown', 'error']), freshness: z.enum(['fresh', 'stale', 'unknown']) }).strict()
export const auditExportJobListSchema = z.object({ items: z.array(auditExportJobSchema) }).strict()
export type AuditExportJob = z.infer<typeof auditExportJobSchema>
