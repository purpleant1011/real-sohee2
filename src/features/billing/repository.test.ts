import { describe, expect, it, vi } from 'vitest'
import { createCheckoutIntent, listCheckoutIntents, type BillingGateway } from './repository'

describe('billing intent server service', () => {
  it('returns latest workspace-scoped safe intent history with a state filter and page limit', async () => {
    const rpc = vi.fn(async () => ({ data: [{
      id: '30000000-0000-4000-8000-000000000001', workspace_id: '20000000-0000-4000-8000-000000000001',
      billing_plan_id: '40000000-0000-4000-8000-000000000001', state: 'provider_pending', created_at: '2026-08-19T00:00:00.000Z',
    }], error: null }))
    const result = await listCheckoutIntents('20000000-0000-4000-8000-000000000001', { state: 'provider_pending', limit: 10 }, { rpc })
    expect(result).toEqual({ data: [expect.objectContaining({ state: 'provider_pending', providerReference: null })] })
    expect(rpc).toHaveBeenCalledWith('list_checkout_intents', expect.objectContaining({ p_limit: 10, p_state: 'provider_pending' }))
  })
  it('exposes a provider-pending intent without calling it paid or active', async () => {
    const gateway: BillingGateway = { rpc: vi.fn(async () => ({ data: {
      checkoutIntentId: '30000000-0000-4000-8000-000000000001', state: 'provider_pending',
    }, error: null })) }

    const result = await createCheckoutIntent({
      workspaceId: '20000000-0000-4000-8000-000000000001',
      billingPlanId: '40000000-0000-4000-8000-000000000001',
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
    }, gateway)

    expect(result).toEqual({ data: expect.objectContaining({ state: 'provider_pending' }) })
    expect(JSON.stringify(result)).not.toContain('paymentSucceeded')
    expect(JSON.stringify(result)).not.toContain('activationSucceeded')
  })
})
