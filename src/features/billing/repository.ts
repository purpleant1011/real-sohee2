import { z } from 'zod'
import { toSafeServiceError, type ServiceResult } from '@/features/credits/service-result'

type RpcResponse = Promise<Readonly<{ data: unknown; error: unknown }>>

export type BillingGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): RpcResponse
}>

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  billingPlanId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
}).strict()
const outputSchema = z.object({
  checkoutIntentId: z.string().uuid(),
  state: z.literal('provider_pending'),
}).strict()
const intentRowSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), billing_plan_id: z.string().uuid(), state: z.enum(['draft', 'provider_pending', 'provider_succeeded', 'activation_succeeded', 'failed', 'cancelled']), created_at: z.string().datetime({ offset: true }) }).strict()
const historyFilterSchema = z.object({ state: z.enum(['draft', 'provider_pending', 'provider_succeeded', 'activation_succeeded', 'failed', 'cancelled']).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict().default({ limit: 20 })

async function productionGateway(): Promise<BillingGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as RpcResponse }
}

export async function createCheckoutIntent(input: unknown, providedGateway?: BillingGateway): Promise<ServiceResult<z.infer<typeof outputSchema>>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'CHECKOUT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('create_checkout_intent', {
    p_workspace_id: parsed.data.workspaceId,
    p_billing_plan_id: parsed.data.billingPlanId,
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  const output = outputSchema.safeParse(result.data)
  if (result.error || !output.success) return toSafeServiceError(result.error, 'CHECKOUT_RPC_FAILED')
  return { data: output.data }
}

export async function listCheckoutIntents(workspaceId: string, filter: unknown = {}, providedGateway?: BillingGateway): Promise<ServiceResult<readonly import('./types').CheckoutIntent[]>> {
  const workspace = z.string().uuid().safeParse(workspaceId); const parsedFilter = historyFilterSchema.safeParse(filter)
  if (!workspace.success || !parsedFilter.success) return { error: { code: 'CHECKOUT_RPC_FAILED' } }
  const result = await (providedGateway ?? await productionGateway()).rpc('list_checkout_intents', { p_workspace_id: workspace.data, p_state: parsedFilter.data.state ?? null, p_limit: parsedFilter.data.limit })
  const rows = z.array(intentRowSchema).safeParse(result.data)
  if (result.error || !rows.success || rows.data.some((row) => row.workspace_id !== workspace.data)) return toSafeServiceError(result.error, 'CHECKOUT_RPC_FAILED')
  return { data: Object.freeze(rows.data.map((row) => Object.freeze({ id: row.id, workspaceId: row.workspace_id, billingPlanId: row.billing_plan_id, idempotencyKey: '', state: row.state, providerReference: null, createdAt: row.created_at }))) }
}
