import { z } from 'zod'
import { previewCreditCost, type CreditRateCatalog } from '@/features/credits/rate-catalog'
import { getCreditBalance } from '@/features/credits/repository'
import { toSafeServiceError, type ServiceResult } from '@/features/credits/service-result'
import { periodPlanRequestSchema } from './plan-schema'
import type { PeriodPlanAdjustment, PeriodPlanRequest } from './types'

type RpcResponse = Promise<Readonly<{ data: unknown; error: unknown }>>

export type PeriodPlanGateway = Readonly<{
  balance(): RpcResponse
  rpc(name: string, args: Record<string, unknown>): RpcResponse
}>

const uuidSchema = z.string().uuid()
const planOutputSchema = z.object({
  planId: uuidSchema,
  version: z.number().int().positive(),
  status: z.enum(['draft', 'approved', 'cancelled']),
}).strict()
const savePlanInputSchema = z.object({
  workspaceId: uuidSchema,
  request: periodPlanRequestSchema,
  catalogVersion: z.number().int().positive(),
  estimatedCredits: z.number().int().nonnegative(),
}).strict()
const approveInputSchema = z.object({
  workspaceId: uuidSchema,
  planId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
}).strict()

const adjustments: readonly PeriodPlanAdjustment[] = Object.freeze([
  { kind: 'reduce_images', label: '이미지 수 줄이기' },
  { kind: 'move_channels', label: '일부 채널을 다음 기간으로 이동' },
  { kind: 'plan_only', label: '계획만 먼저 만들기' },
  { kind: 'priority_first', label: '중요한 콘텐츠부터 만들기' },
  { kind: 'use_fast_depth', label: '빠른 생성으로 변경' },
])

async function productionGateway(): Promise<PeriodPlanGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const { getCurrentWorkspaceContext } = await import('@/features/auth/current-workspace')
  const supabase = await createServerSupabaseClient()
  const context = await getCurrentWorkspaceContext()
  return {
    async balance() {
      if (context === null) return { data: null, error: { message: 'CREDIT_FORBIDDEN' } }
      const result = await getCreditBalance(context.workspaceId)
      if ('error' in result) return { data: null, error: { message: result.error?.code ?? 'CREDIT_RPC_FAILED' } }
      return { data: { available: result.data.available }, error: null }
    },
    rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as RpcResponse,
  }
}

function planUnits(request: PeriodPlanRequest) {
  const posts = request.channels.reduce((total, channel) => total + channel.postCount, 0)
  const images = request.channels.reduce((total, channel) => total + channel.postCount * channel.imagesPerPost, 0)
  return {
    chatTurns: 1,
    textGenerations: posts,
    imageGenerations: images,
    sourceAnalyses: request.generationDepth === 'deep' ? posts : 0,
    externalActions: 0,
  }
}

export type PeriodPlanPreview = Readonly<{
  status: 'ready' | 'insufficient'
  catalogVersion: number
  estimatedCredits: number
  availableCredits: number
  expectedRemainingCredits: number
  adjustments: readonly PeriodPlanAdjustment[]
}>

export async function previewPeriodPlan(
  input: unknown,
  dependencies: Readonly<{ gateway?: PeriodPlanGateway; catalog: CreditRateCatalog }>,
): Promise<ServiceResult<PeriodPlanPreview>> {
  const request = periodPlanRequestSchema.safeParse(input)
  if (!request.success) return { error: { code: 'PLAN_RPC_FAILED' } }
  const preview = previewCreditCost({ action: 'period_plan_generation', units: planUnits(request.data) }, dependencies.catalog)
  const gateway = dependencies.gateway ?? await productionGateway()
  const balance = await gateway.balance()
  const balanceData = z.object({ available: z.number().int() }).strict().safeParse(balance.data)
  if (balance.error || !balanceData.success) return toSafeServiceError(balance.error, 'PLAN_RPC_FAILED')
  const availableCredits = balanceData.data.available
  const insufficient = preview.estimatedCredits > availableCredits
  return {
    data: {
      status: insufficient ? 'insufficient' : 'ready',
      catalogVersion: preview.catalogVersion,
      estimatedCredits: preview.estimatedCredits,
      availableCredits,
      expectedRemainingCredits: availableCredits - preview.estimatedCredits,
      adjustments: insufficient ? adjustments : Object.freeze([]),
    },
  }
}

export async function savePeriodPlan(input: unknown, providedGateway?: PeriodPlanGateway): Promise<ServiceResult<z.infer<typeof planOutputSchema>>> {
  const parsed = savePlanInputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'PLAN_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('create_period_content_plan', {
    p_workspace_id: parsed.data.workspaceId,
    p_request: parsed.data.request,
    p_catalog_version: parsed.data.catalogVersion,
    p_estimated_credits: parsed.data.estimatedCredits,
    p_idempotency_key: parsed.data.request.idempotencyKey,
  })
  const output = planOutputSchema.safeParse(result.data)
  if (result.error || !output.success) return toSafeServiceError(result.error, 'PLAN_RPC_FAILED')
  return { data: output.data }
}

export async function approvePeriodPlan(input: unknown, providedGateway?: PeriodPlanGateway): Promise<ServiceResult<z.infer<typeof planOutputSchema>>> {
  const parsed = approveInputSchema.safeParse(input)
  if (!parsed.success) return { error: { code: 'PLAN_RPC_FAILED' } }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('approve_period_content_plan', {
    p_workspace_id: parsed.data.workspaceId,
    p_plan_id: parsed.data.planId,
    p_expected_version: parsed.data.expectedVersion,
    p_idempotency_key: parsed.data.idempotencyKey,
  })
  const output = planOutputSchema.safeParse(result.data)
  if (result.error || !output.success) return toSafeServiceError(result.error, 'PLAN_RPC_FAILED')
  return { data: output.data }
}
