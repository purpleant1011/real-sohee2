/**
 * SOHEE V0.91 · Harness-First SOHEE_READY Entitlement & Starter Grant (HF-05)
 *
 * Invariants:
 * 1. Pre-ready user receives ONLY bounded EDUCATION_TEST_BUDGET.
 * 2. Production execution budget (50 Energy / 40,000 credits) is unavailable before SOHEE_READY.
 * 3. Pre-ready production execution spend = 0 is a release invariant.
 * 4. Starter grant is executed exactly-once, business-scoped, retry-safe, and idempotent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSoheeReadiness } from './read-model'
import { SoheeNotReadyError } from './admission-guard'
import type { SoheeReadinessSnapshot } from './types'

import { TRIAL_CREDIT_ALLOCATION } from '@/lib/entitlements/trial-credit-engine'

export interface ProductEntitlementPolicy {
  policyKey: string
  starterEnergyGrant: number
  starterCreditGrant: number
  benefitType: string
  approved: boolean
}

export const APPROVED_PRODUCT_ENTITLEMENT_POLICIES: Record<string, ProductEntitlementPolicy> = {
  SOHEE_READY_STARTER_V1: {
    policyKey: 'SOHEE_READY_STARTER_V1',
    starterEnergyGrant: 50,
    starterCreditGrant: TRIAL_CREDIT_ALLOCATION.TOTAL,
    benefitType: 'FREE_TASTE_50',
    approved: true,
  },
}

export function getApprovedStarterPolicy(policyKey = 'SOHEE_READY_STARTER_V1'): ProductEntitlementPolicy {
  const policy = APPROVED_PRODUCT_ENTITLEMENT_POLICIES[policyKey]
  if (!policy || !policy.approved) {
    throw new Error('PRODUCT_POLICY_UNKNOWN: 승인된 Product Entitlement 설정을 찾을 수 없습니다 (HF-05 Invariant).')
  }
  return policy
}

export const EDUCATION_TEST_BUDGET_DEFAULTS = {
  textHarnessTestRuns: 20,
  imageHarnessTestRuns: 10,
  sandboxMode: true,
} as const

export interface EducationTestBudget {
  textHarnessTestRuns: number
  imageHarnessTestRuns: number
  sandboxMode: boolean
}

export interface SoheeStarterEntitlementResult {
  granted: boolean
  alreadyGranted: boolean
  energyGranted: number
  creditsGranted: number
  benefitType: string
  claimedAt?: string
}

export interface ProvisionEducationWorkspaceParams {
  userId: string
  workspaceName?: string
  provider?: string
}

export interface ProvisionEducationWorkspaceResult {
  success: boolean
  workspaceId: string
  isNewWorkspace: boolean
  energyGranted: number
  commercialState: string
  educationBudget: EducationTestBudget
}

/**
 * SOHEE_READY Starter Entitlement Grant
 *
 * Must fail-closed if workspace is NOT overallReady.
 * Exactly-once grant enforced by DB constraint (uq_free_taste_claim).
 */
export async function grantSoheeReadyStarterEntitlement(
  supabase: SupabaseClient,
  workspaceId: string,
  operatorId: string,
  policyKey?: string,
  options?: { readinessSnapshot?: SoheeReadinessSnapshot }
): Promise<SoheeStarterEntitlementResult> {
  // 1. Approved Product Entitlement Policy Verification
  const policy = getApprovedStarterPolicy(policyKey)

  // 2. Server-authoritative Readiness Gate
  const readiness = options?.readinessSnapshot || await getSoheeReadiness(workspaceId, { supabaseClient: supabase })
  if (!readiness.ready) {
    throw new SoheeNotReadyError(readiness, 'STARTER_ENTITLEMENT_GRANT')
  }


  // 2. Execute Exactly-Once DB RPC
  const { data, error } = await (supabase as any).rpc(
    'grant_sohee_ready_starter_entitlement',
    {
      p_workspace_id: workspaceId,
      p_operator_id: operatorId,
    }
  )

  if (error) {
    console.error('[grantSoheeReadyStarterEntitlement] RPC failed:', error)
    const err: any = new Error(error.message || 'SOHEE_READY 스타터 혜택 지급에 실패했습니다.')
    err.code = error.code
    throw err
  }

  return {
    granted: Boolean(data?.success),
    alreadyGranted: Boolean(data?.already_granted),
    energyGranted: data?.energy_granted ?? 0,
    creditsGranted: data?.credits_granted ?? 0,
    benefitType: data?.benefit_type || 'FREE_TASTE_50',
    claimedAt: data?.claimed_at,
  }
}

/**
 * Provision Education Workspace (Pre-ready Signup Phase)
 *
 * Creates workspace and members, connects business verification,
 * but sets production energy to 0 and provides bounded EDUCATION_TEST_BUDGET.
 */
export async function provisionEducationWorkspace(
  supabase: SupabaseClient,
  params: ProvisionEducationWorkspaceParams
): Promise<ProvisionEducationWorkspaceResult> {
  const { data, error } = await (supabase as any).rpc(
    'provision_education_workspace',
    {
      p_user_id: params.userId,
      p_workspace_name: params.workspaceName || '나의 소희 마케팅',
      p_provider: params.provider || 'google',
    }
  )

  if (error) {
    console.error('[provisionEducationWorkspace] RPC failed:', error)
    const err: any = new Error(error.message || '교육용 워크스페이스 생성에 실패했습니다.')
    err.code = error.code
    throw err
  }

  return {
    success: Boolean(data?.success),
    workspaceId: data?.workspace_id,
    isNewWorkspace: Boolean(data?.is_new_workspace),
    energyGranted: data?.energy_granted ?? 0,
    commercialState: data?.commercial_state || 'EDUCATION_MODE',
    educationBudget: data?.education_budget || EDUCATION_TEST_BUDGET_DEFAULTS,
  }
}
