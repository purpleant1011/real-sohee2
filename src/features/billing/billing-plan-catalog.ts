import type { BillingPlanCode } from './types'
import { weeklyCreditsForPlan } from '@/features/credits/commercial-credit-policy'

export const billingPlanCatalog = [
  { id: '88000000-0000-4000-8000-000000000001', code: 'starter', label: '스타터', monthlyPriceLabel: '월 0원', weeklyCredits: weeklyCreditsForPlan('starter') },
  { id: '88000000-0000-4000-8000-000000000002', code: 'growth', label: '그로스', monthlyPriceLabel: '월 15만원', weeklyCredits: weeklyCreditsForPlan('growth') },
  { id: '88000000-0000-4000-8000-000000000003', code: 'operations', label: '운영', monthlyPriceLabel: '월 30만원', weeklyCredits: weeklyCreditsForPlan('operations') },
  { id: '88000000-0000-4000-8000-000000000004', code: 'focus', label: '포커스', monthlyPriceLabel: '월 50만원', weeklyCredits: weeklyCreditsForPlan('focus') },
] as const satisfies readonly Readonly<{
  id: string
  code: BillingPlanCode
  label: string
  monthlyPriceLabel: string
  weeklyCredits: number
}>[]

export function findBillingPlan(code: BillingPlanCode) {
  return billingPlanCatalog.find((plan) => plan.code === code) ?? null
}
