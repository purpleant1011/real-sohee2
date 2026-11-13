import { z } from 'zod'

export const billingPlanCodes = ['starter', 'growth', 'operations', 'focus'] as const
export const billingPlanPrices = [0, 150000, 300000, 500000] as const
export const checkoutIntentStates = [
  'draft',
  'provider_pending',
  'provider_succeeded',
  'activation_succeeded',
  'failed',
  'cancelled',
] as const

export type BillingPlanCode = typeof billingPlanCodes[number]
export type CheckoutIntentState = typeof checkoutIntentStates[number]

export const billingPlanSchema = z.object({
  id: z.string().uuid(),
  code: z.enum(billingPlanCodes),
  monthlyPriceKrw: z.union(billingPlanPrices.map((price) => z.literal(price)) as [z.ZodLiteral<0>, z.ZodLiteral<150000>, z.ZodLiteral<300000>, z.ZodLiteral<500000>]),
  includedCredits: z.number().int().nonnegative().nullable(),
  policyStatus: z.enum(['draft', 'active', 'retired']),
}).strict()

export type BillingPlan = z.infer<typeof billingPlanSchema>

export type CheckoutIntent = Readonly<{
  id: string
  workspaceId: string
  billingPlanId: string
  idempotencyKey: string
  state: CheckoutIntentState
  providerReference: string | null
  createdAt: string
}>
