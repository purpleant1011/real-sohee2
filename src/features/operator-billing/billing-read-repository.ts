import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { billingWireSchema, type BillingErrorCode, type BillingItem, type BillingOverview, type BillingWire } from './billing-read-schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
export type OperatorBillingRpcGateway = Readonly<{
  rpc(name: 'list_operator_billing_overview', args: Readonly<{ p_workspace_id: string | null; p_limit: number }>): Promise<RpcResult>
}>
type Dependencies = Readonly<{
  gateway?: OperatorBillingRpcGateway
  adminClient?: { rpc(name: 'workspace_membership_overview'): Promise<{ data: unknown; error: unknown }> }
}>
type Result = Readonly<{ data: BillingOverview | null; error: BillingErrorCode | null }>

const inputSchema = z.object({ workspaceId: z.string().uuid().nullable().optional(), limit: z.number().int().min(1).max(100).optional() }).strict().default({})
const dbErrors = new Set<BillingErrorCode>([
  'BILLING_INPUT_INVALID', 'OPERATOR_UNAUTHENTICATED', 'MFA_REQUIRED', 'OPERATOR_DISABLED',
  'OPERATOR_SCOPE_DENIED', 'OPERATOR_PERMISSION_DENIED', 'BILLING_READ_UNAVAILABLE',
])

function safeError(error: unknown): BillingErrorCode {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return dbErrors.has(message as BillingErrorCode) ? message as BillingErrorCode : 'BILLING_READ_UNAVAILABLE'
}

async function productionGateway(): Promise<OperatorBillingRpcGateway> {
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as Promise<RpcResult> }
}

export async function listOperatorBillingOverview(input: unknown = {}, dependencies?: Dependencies): Promise<Result> {
  const parsedInput = inputSchema.safeParse(input)
  if (!parsedInput.success) return { data: null, error: 'BILLING_INPUT_INVALID' }
  const workspaceId = parsedInput.data.workspaceId ?? null
  const limit = parsedInput.data.limit ?? 100
  let result: RpcResult
  try {
    const gateway = dependencies?.gateway ?? await productionGateway()
    result = await gateway.rpc('list_operator_billing_overview', { p_workspace_id: workspaceId, p_limit: limit })
  } catch (error) {
    return { data: null, error: safeError(error) }
  }
  if (result.error) return { data: null, error: safeError(result.error) }
  const wire = billingWireSchema.safeParse(result.data)
  if (!wire.success) return { data: null, error: 'BILLING_READ_UNAVAILABLE' }
  if (workspaceId !== null && wire.data.items.some((item) => item.workspace_id !== workspaceId)) {
    return { data: null, error: 'BILLING_READ_UNAVAILABLE' }
  }
  return {
    data: {
      items: Object.freeze(wire.data.items),
      summary: { state: wire.data.summary.state, workspaceCount: wire.data.summary.workspace_count, sourceTimestamp: wire.data.summary.source_timestamp },
    },
    error: null,
  }
}

const STATE_SEVERITY: Record<BillingWire['summary']['state'], number> = {
  error: 5,
  stale: 4,
  unknown: 3,
  fresh: 2,
  empty: 1,
}

function worstSummaryState(states: Array<BillingWire['summary']['state']>): BillingWire['summary']['state'] {
  if (states.length === 0) return 'empty'
  let worst = states[0]!
  for (const s of states) {
    if (STATE_SEVERITY[s] > STATE_SEVERITY[worst]) {
      worst = s
    }
  }
  return worst
}

export async function listOperatorBillingOverviewForFormalMembers(
  dependencies?: Dependencies
): Promise<Result> {
  let membershipData: unknown
  try {
    const admin = dependencies?.adminClient ?? (createAdminSupabaseClient() as any)
    const { data, error } = await admin.rpc('workspace_membership_overview')
    if (error || !Array.isArray(data)) {
      return { data: null, error: 'BILLING_READ_UNAVAILABLE' }
    }
    membershipData = data
  } catch (err) {
    return { data: null, error: safeError(err) }
  }

  const rows = membershipData as Array<{ workspace_id: string; is_formal?: boolean }>
  const formalMembers = rows.filter((r) => r.is_formal === true)
  const applicantCount = rows.length - formalMembers.length
  const formalIds = formalMembers.map((r) => r.workspace_id).slice(0, 100)

  if (formalIds.length === 0) {
    return {
      data: {
        items: Object.freeze([]),
        summary: { state: 'empty', workspaceCount: 0, sourceTimestamp: null },
        applicantCount,
      },
      error: null,
    }
  }

  const BATCH_SIZE = 10
  const allItems: BillingItem[] = []
  const summaryStates: Array<BillingWire['summary']['state']> = []
  let latestTimestamp: string | null = null

  for (let i = 0; i < formalIds.length; i += BATCH_SIZE) {
    const batch = formalIds.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map((id) => listOperatorBillingOverview({ workspaceId: id, limit: 1 }, dependencies))
    )

    for (const res of batchResults) {
      if (res.error) {
        return { data: null, error: res.error }
      }
      if (res.data) {
        for (const item of res.data.items) {
          allItems.push({
            ...item,
            isFormal: true,
            is_formal: true,
            member_status: 'FORMAL',
          })
        }
        summaryStates.push(res.data.summary.state)
        if (res.data.summary.sourceTimestamp) {
          if (!latestTimestamp || res.data.summary.sourceTimestamp > latestTimestamp) {
            latestTimestamp = res.data.summary.sourceTimestamp
          }
        }
      }
    }
  }

  return {
    data: {
      items: Object.freeze(allItems),
      summary: {
        state: worstSummaryState(summaryStates),
        workspaceCount: allItems.length,
        sourceTimestamp: latestTimestamp,
      },
      applicantCount,
    },
    error: null,
  }
}
