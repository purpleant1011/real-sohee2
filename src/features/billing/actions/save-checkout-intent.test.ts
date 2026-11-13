import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { saveCheckoutIntentAction } from './save-checkout-intent'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const idempotencyKey = '20000000-0000-4000-8000-000000000001'

describe('saveCheckoutIntentAction', () => {
  it('maps the selected seeded plan to a provider-pending intent without payment activation', async () => {
    const create = vi.fn().mockResolvedValue({
      data: { checkoutIntentId: '30000000-0000-4000-8000-000000000001', state: 'provider_pending' },
    })

    await expect(saveCheckoutIntentAction({ planCode: 'growth', idempotencyKey }, {
      workspace: async () => ({ workspaceId, role: 'owner' }),
      create,
    })).resolves.toEqual({
      data: { checkoutIntentId: '30000000-0000-4000-8000-000000000001', state: 'provider_pending' },
    })
    expect(create).toHaveBeenCalledWith({
      workspaceId,
      billingPlanId: '88000000-0000-4000-8000-000000000002',
      idempotencyKey,
    })
  })

  it('does not save a selection for a viewer, reviewer, or an invalid plan', async () => {
    const create = vi.fn()
    await expect(saveCheckoutIntentAction({ planCode: 'growth', idempotencyKey }, {
      workspace: async () => ({ workspaceId, role: 'viewer' }),
      create,
    })).resolves.toMatchObject({ error: { requestId: 'billing-selection-forbidden' } })
    await expect(saveCheckoutIntentAction({ planCode: 'growth', idempotencyKey }, {
      workspace: async () => ({ workspaceId, role: 'reviewer' }),
      create,
    })).resolves.toMatchObject({ error: { requestId: 'billing-selection-forbidden' } })
    await expect(saveCheckoutIntentAction({ planCode: 'unlimited', idempotencyKey }, {
      workspace: async () => ({ workspaceId, role: 'owner' }),
      create,
    })).resolves.toMatchObject({ error: { requestId: 'billing-selection-input' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('maps a repository failure to a safe action error without implying payment state', async () => {
    const create = vi.fn().mockResolvedValue({ error: { code: 'CHECKOUT_RPC_FAILED' } })

    await expect(saveCheckoutIntentAction({ planCode: 'focus', idempotencyKey }, {
      workspace: async () => ({ workspaceId, role: 'owner' }),
      create,
    })).resolves.toMatchObject({ error: { requestId: 'billing-selection-save' } })
  })
})
