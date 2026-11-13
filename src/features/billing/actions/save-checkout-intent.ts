'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createCheckoutIntent } from '../repository'
import { billingPlanCodes } from '../types'
import { findBillingPlan } from '../billing-plan-catalog'

const inputSchema = z.object({
  planCode: z.enum(billingPlanCodes),
  idempotencyKey: z.string().uuid(),
}).strict()

type SavedCheckoutIntent = Readonly<{
  checkoutIntentId: string
  state: 'provider_pending'
}>

type Dependencies = Readonly<{
  workspace: typeof getCurrentWorkspaceContext
  create: typeof createCheckoutIntent
}>

function failure(message: string, requestId: string): ActionResult<SavedCheckoutIntent> {
  return { error: { message, requestId } }
}

export async function saveCheckoutIntentAction(
  input: unknown,
  providedDependencies?: Dependencies,
): Promise<ActionResult<SavedCheckoutIntent>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('요금제 선택을 확인해 주세요.', 'billing-selection-input')

  const dependencies = providedDependencies ?? {
    workspace: getCurrentWorkspaceContext,
    create: createCheckoutIntent,
  }
  const workspace = await dependencies.workspace()
  if (!workspace || (workspace.role !== 'owner' && workspace.role !== 'manager')) {
    return failure('요금제 선택을 저장할 권한이 없습니다.', 'billing-selection-forbidden')
  }

  const plan = findBillingPlan(parsed.data.planCode)
  if (!plan) return failure('요금제 선택을 확인해 주세요.', 'billing-selection-input')
  const result = await dependencies.create({
    workspaceId: workspace.workspaceId,
    billingPlanId: plan.id,
    idempotencyKey: parsed.data.idempotencyKey,
  })
  if (result.error) return failure('요금제 선택을 저장하지 못했습니다. 결제는 시작되지 않았습니다.', 'billing-selection-save')
  if (result.data.state !== 'provider_pending') {
    return failure('결제 상태를 확인하지 못했습니다.', 'billing-selection-state')
  }
  revalidatePath('/app/account/billing')
  return { data: result.data }
}
