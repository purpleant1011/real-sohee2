import { describe, expect, it } from 'vitest'
import { billingPlanSchema } from './types'

describe('billing policy contracts', () => {
  it('keeps included credits unset while the policy is draft', () => {
    expect(billingPlanSchema.parse({
      id: '10000000-0000-4000-8000-000000000001',
      code: 'growth',
      monthlyPriceKrw: 150000,
      includedCredits: null,
      policyStatus: 'draft',
    })).toMatchObject({ includedCredits: null, policyStatus: 'draft' })
  })
})
