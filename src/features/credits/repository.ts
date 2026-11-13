import { z } from 'zod'
import { creditActions, type CreditBalance, type CreditLedgerEntry, type CreditReservation, type CreditUsageDetail } from './types'
import { toSafeServiceError, type ServiceResult } from './service-result'

type RpcResponse = Promise<Readonly<{ data: unknown; error: unknown }>>

export type CreditGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): RpcResponse
}>

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const balanceSchema = z.object({
  workspaceId: uuidSchema,
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  granted: z.number().int(),
  adjustments: z.number().int(),
  released: z.number().int(),
  consumed: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  weeklyLimit: z.number().int().positive(),
  policyVersion: z.string().trim().min(1).max(80),
}).strict()
const ledgerEntrySchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  account_id: uuidSchema,
  reservation_id: uuidSchema.nullable(),
  kind: z.enum(['grant', 'reserve', 'consume', 'release', 'refund', 'adjustment']),
  action: z.enum(creditActions).nullable(),
  amount: z.number().int(),
  idempotency_key: z.string().min(1).max(200),
  occurred_at: timestampSchema,
}).strict()
const reservationSchema = z.object({
  reservationId: uuidSchema,
  state: z.enum(['reserved', 'settled', 'released']),
  requestedCredits: z.number().int().positive().optional(),
}).strict()
const mutationInputSchema = z.object({
  workspaceId: uuidSchema,
  action: z.enum(creditActions),
  credits: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
  reservationId: uuidSchema,
}).strict()
const settleInputSchema = z.object({
  workspaceId: uuidSchema,
  reservationId: uuidSchema,
  actualCredits: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
}).strict()
const releaseInputSchema = z.object({
  workspaceId: uuidSchema,
  reservationId: uuidSchema,
  credits: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
}).strict()
const ledgerFilterSchema = z.object({
  kind: z.enum(['grant', 'reserve', 'consume', 'release', 'refund', 'adjustment']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict().default({ limit: 50 })
const usageDetailSchema = z.object({
  occurred_at: timestampSchema,
  operation: z.enum(['text_response', 'image_generation', 'image_edit']),
  usage_source: z.enum(['actual', 'estimated_missing_usage']),
  text_input_tokens: z.number().int().nonnegative(),
  cached_text_input_tokens: z.number().int().nonnegative(),
  text_output_tokens: z.number().int().nonnegative(),
  image_input_tokens: z.number().int().nonnegative(),
  image_output_tokens: z.number().int().nonnegative(),
  provider_total_tokens: z.number().int().nonnegative(),
  requested_credits: z.number().int().positive(),
  settled_credits: z.number().int().nonnegative(),
  released_credits: z.number().int().nonnegative(),
  policy_version: z.string().trim().min(1).max(80),
}).strict().superRefine((row, context) => {
  if (row.cached_text_input_tokens > row.text_input_tokens) {
    context.addIssue({ code: 'custom', path: ['cached_text_input_tokens'], message: 'cached input exceeds total input' })
  }
  if (row.settled_credits + row.released_credits > row.requested_credits) {
    context.addIssue({ code: 'custom', path: ['settled_credits'], message: 'settlement exceeds reservation' })
  }
})

async function productionGateway(): Promise<CreditGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as RpcResponse }
}

function mapBalance(row: z.infer<typeof balanceSchema>): CreditBalance {
  return {
    workspaceId: row.workspaceId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    granted: row.granted,
    adjustments: row.adjustments,
    released: row.released,
    consumed: row.consumed,
    reserved: row.reserved,
    available: row.available,
    weeklyLimit: row.weeklyLimit,
    policyVersion: row.policyVersion,
  }
}

function mapLedgerEntry(row: z.infer<typeof ledgerEntrySchema>): CreditLedgerEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    reservationId: row.reservation_id,
    kind: row.kind,
    action: row.action,
    amount: row.amount,
    idempotencyKey: row.idempotency_key,
    occurredAt: row.occurred_at,
  }
}

function mapReservation(row: z.infer<typeof reservationSchema>, input: { workspaceId: string; action: typeof creditActions[number]; credits: number; idempotencyKey: string }): CreditReservation {
  return {
    id: row.reservationId,
    workspaceId: input.workspaceId,
    action: input.action,
    requestedCredits: row.requestedCredits ?? input.credits,
    settledCredits: row.state === 'settled' ? input.credits : 0,
    releasedCredits: row.state === 'released' ? input.credits : 0,
    state: row.state,
    idempotencyKey: input.idempotencyKey,
  }
}

function mapUsageDetail(row: z.infer<typeof usageDetailSchema>): CreditUsageDetail {
  return {
    occurredAt: row.occurred_at,
    operation: row.operation,
    usageSource: row.usage_source,
    textInputTokens: row.text_input_tokens,
    cachedTextInputTokens: row.cached_text_input_tokens,
    textOutputTokens: row.text_output_tokens,
    imageInputTokens: row.image_input_tokens,
    imageOutputTokens: row.image_output_tokens,
    providerTotalTokens: row.provider_total_tokens,
    requestedCredits: row.requested_credits,
    settledCredits: row.settled_credits,
    releasedCredits: row.released_credits,
    policyVersion: row.policy_version,
  }
}

export async function getCreditBalance(workspaceId: string, providedGateway?: CreditGateway): Promise<ServiceResult<CreditBalance>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) return { error: { code: 'CREDIT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('get_workspace_credit_balance', { p_workspace_id: parsedWorkspaceId.data })
  const parsed = balanceSchema.safeParse(result.data)
  if (result.error || !parsed.success || parsed.data.workspaceId !== parsedWorkspaceId.data) {
    return toSafeServiceError(result.error, 'CREDIT_RPC_FAILED')
  }
  return { data: mapBalance(parsed.data) }
}

export async function listCreditLedger(
  workspaceId: string,
  filter: unknown = {},
  providedGateway?: CreditGateway,
): Promise<ServiceResult<readonly CreditLedgerEntry[]>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  const parsedFilter = ledgerFilterSchema.safeParse(filter)
  if (!parsedWorkspaceId.success || !parsedFilter.success) return { error: { code: 'CREDIT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('list_workspace_credit_ledger', {
    p_workspace_id: parsedWorkspaceId.data,
    p_kind: parsedFilter.data.kind ?? null,
    p_limit: parsedFilter.data.limit,
  })
  const rows = z.array(ledgerEntrySchema).safeParse(result.data)
  if (result.error || !rows.success || rows.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)) {
    return toSafeServiceError(result.error, 'CREDIT_RPC_FAILED')
  }
  return { data: Object.freeze(rows.data.map(mapLedgerEntry)) }
}

export async function listCreditUsageDetail(
  workspaceId: string,
  limit = 50,
  providedGateway?: CreditGateway,
): Promise<ServiceResult<readonly CreditUsageDetail[]>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  const parsedLimit = z.number().int().min(1).max(100).safeParse(limit)
  if (!parsedWorkspaceId.success || !parsedLimit.success) return { error: { code: 'CREDIT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('get_workspace_credit_usage_detail', {
    p_workspace_id: parsedWorkspaceId.data,
    p_limit: parsedLimit.data,
  })
  const rows = z.array(usageDetailSchema).safeParse(result.data)
  if (result.error || !rows.success) return toSafeServiceError(result.error, 'CREDIT_RPC_FAILED')
  return { data: Object.freeze(rows.data.map(mapUsageDetail)) }
}

export async function reserveCredits(input: unknown, providedGateway?: CreditGateway): Promise<ServiceResult<CreditReservation>> {
  const parsed = mutationInputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'CREDIT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('reserve_workspace_credits', {
    p_workspace_id: parsed.data.workspaceId,
    p_action: parsed.data.action,
    p_credits: parsed.data.credits,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_reservation_id: parsed.data.reservationId,
  })
  const reservation = reservationSchema.safeParse(result.data)
  if (result.error || !reservation.success || reservation.data.reservationId !== parsed.data.reservationId) {
    return toSafeServiceError(result.error, 'CREDIT_RPC_FAILED')
  }
  return { data: mapReservation(reservation.data, parsed.data) }
}

export async function settleCredits(input: unknown, providedGateway?: CreditGateway): Promise<ServiceResult<Readonly<{ reservationId: string; state: 'settled' }>>> {
  const parsed = settleInputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'CREDIT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('settle_credit_reservation', {
    p_workspace_id: parsed.data.workspaceId,
    p_reservation_id: parsed.data.reservationId,
    p_actual_credits: parsed.data.actualCredits,
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  const output = z.object({ reservationId: uuidSchema, state: z.literal('settled') }).strict().safeParse(result.data)
  if (result.error || !output.success || output.data.reservationId !== parsed.data.reservationId) {
    return toSafeServiceError(result.error, 'CREDIT_RPC_FAILED')
  }
  return { data: output.data }
}

export async function releaseCredits(input: unknown, providedGateway?: CreditGateway): Promise<ServiceResult<Readonly<{ reservationId: string; state: 'reserved' | 'released' }>>> {
  const parsed = releaseInputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'CREDIT_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('release_credit_reservation', {
    p_workspace_id: parsed.data.workspaceId,
    p_reservation_id: parsed.data.reservationId,
    p_release_credits: parsed.data.credits,
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  const output = z.object({ reservationId: uuidSchema, state: z.enum(['reserved', 'released']) }).strict().safeParse(result.data)
  if (result.error || !output.success || output.data.reservationId !== parsed.data.reservationId) {
    return toSafeServiceError(result.error, 'CREDIT_RPC_FAILED')
  }
  return { data: output.data }
}
