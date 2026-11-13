import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({ approvalRequestId: z.string().uuid() }).strict()
const responseSchema = z.object({ ledger_entry_id: z.string().uuid(), account_version: z.number().int().positive(), status: z.literal('applied') }).strict()

export type CreditAdjustApplyRpcGateway = Readonly<{
  rpc(name: 'apply_approved_credit_adjustment', args: Readonly<{ p_approval_request_id: string }>): Promise<{ data: unknown; error: unknown }>
}>
export type CreditAdjustApplyError = 'BILLING_INPUT_INVALID' | 'BILLING_WRITE_UNAVAILABLE'
type Dependencies = Readonly<{ gateway: CreditAdjustApplyRpcGateway }>
type Result = Readonly<{ data: Readonly<{ ledgerEntryId: string; accountVersion: number; status: 'applied' }> | null; error: CreditAdjustApplyError | null }>

async function productionGateway(): Promise<CreditAdjustApplyRpcGateway> {
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> }
}

export async function applyApprovedCreditAdjustment(input: unknown, dependencies?: Dependencies): Promise<Result> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { data: null, error: 'BILLING_INPUT_INVALID' }
  try {
    const result = await (dependencies?.gateway ?? await productionGateway()).rpc('apply_approved_credit_adjustment', { p_approval_request_id: parsed.data.approvalRequestId })
    if (result.error) return { data: null, error: 'BILLING_WRITE_UNAVAILABLE' }
    const wire = responseSchema.safeParse(result.data)
    if (!wire.success) return { data: null, error: 'BILLING_WRITE_UNAVAILABLE' }
    return { data: { ledgerEntryId: wire.data.ledger_entry_id, accountVersion: wire.data.account_version, status: wire.data.status }, error: null }
  } catch {
    return { data: null, error: 'BILLING_WRITE_UNAVAILABLE' }
  }
}
