import 'server-only'

import { createHash } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type ProviderGateway = Readonly<{
  getIntent: (approvalRequestId: string) => Promise<{ emailHash: string; status: string } | null>
  invite: (email: string) => Promise<{ ok: boolean }>
  record: (approvalRequestId: string, state: 'provider_succeeded' | 'provider_failed') => Promise<void>
}>

const emailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex')

async function productionGateway(): Promise<ProviderGateway> {
  const client = createAdminSupabaseClient() as unknown as {
    from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: { email_hash: string; status: string } | null; error: unknown }> } } }
    auth: { admin: { inviteUserByEmail: (email: string) => Promise<{ error: unknown }> } }
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>
  }
  return {
    getIntent: async (approvalRequestId) => {
      const { data, error } = await client.from('admin_invite_intents').select('email_hash,status').eq('approval_request_id', approvalRequestId).maybeSingle()
      return error || !data ? null : { emailHash: data.email_hash, status: data.status }
    },
    invite: async (email) => ({ ok: !(await client.auth.admin.inviteUserByEmail(email)).error }),
    record: async (approvalRequestId, state) => {
      const { error } = await client.rpc('record_admin_invite_provider_result', { p_approval_request_id: approvalRequestId, p_provider_state: state })
      if (error) throw new Error('PROVIDER_RESULT_RECORD_FAILED')
    },
  }
}

export type InviteExecutionResult = Readonly<{ state: 'provider_succeeded' | 'provider_failed' | 'provider_pending'; safeCode: string }>

export async function executeApprovedAdminInvite(approvalRequestId: string, email: string, gateway?: ProviderGateway): Promise<InviteExecutionResult> {
  if (!/^[0-9a-f-]{36}$/u.test(approvalRequestId) || !email.includes('@') || email.length > 320) return { state: 'provider_failed', safeCode: 'INPUT_INVALID' }
  const activeGateway = gateway ?? await productionGateway()
  const intent = await activeGateway.getIntent(approvalRequestId)
  if (!intent || intent.status !== 'provider_pending') return { state: 'provider_failed', safeCode: 'INTENT_NOT_PENDING' }
  if (intent.emailHash !== emailHash(email)) return { state: 'provider_failed', safeCode: 'EMAIL_HASH_MISMATCH' }
  try {
    const result = await activeGateway.invite(email)
    const state = result.ok ? 'provider_succeeded' : 'provider_failed'
    await activeGateway.record(approvalRequestId, state)
    return { state, safeCode: result.ok ? 'PROVIDER_ACCEPTED' : 'PROVIDER_REJECTED' }
  } catch {
    try { await activeGateway.record(approvalRequestId, 'provider_failed') } catch { /* preserve safe provider failure */ }
    return { state: 'provider_failed', safeCode: 'PROVIDER_UNAVAILABLE' }
  }
}

export { emailHash }
