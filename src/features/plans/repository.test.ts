import { describe, expect, it, vi } from 'vitest'
import type { CreditRateCatalog } from '@/features/credits/rate-catalog'
import { approvePeriodPlan, previewPeriodPlan, savePeriodPlan, type PeriodPlanGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const request = {
  periodStart: '2026-08-24', periodEnd: '2026-08-30', timezone: 'Asia/Seoul', goal: '신규 예약',
  generationDepth: 'balanced' as const, idempotencyKey: '10000000-0000-4000-8000-000000000001',
  channels: [{ channel: 'instagram' as const, postCount: 7, imagesPerPost: 4 }],
}
const catalog: CreditRateCatalog = {
  catalogVersion: 1,
  rates: {
    period_plan_generation: {
      baseCredits: 1,
      perUnit: { chatTurns: 1, textGenerations: 2, imageGenerations: 2, sourceAnalyses: 0, externalActions: 0 },
    },
  },
}

function gateway(overrides: Partial<PeriodPlanGateway> = {}): PeriodPlanGateway {
  return {
    balance: vi.fn(async () => ({ data: { available: 20 }, error: null })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    ...overrides,
  }
}

describe('period plan server service', () => {
  it('returns adjustment choices when estimated cost exceeds available balance', async () => {
    const result = await previewPeriodPlan(request, { gateway: gateway(), catalog })

    expect(result.data?.status).toBe('insufficient')
    expect(result.data?.adjustments.map((item) => item.kind)).toEqual([
      'reduce_images', 'move_channels', 'plan_only', 'priority_first', 'use_fast_depth',
    ])
  })

  it('saves the normalized plan through the idempotent plan RPC', async () => {
    const providedGateway = gateway({ rpc: vi.fn(async () => ({ data: {
      planId: '30000000-0000-4000-8000-000000000001', version: 1, status: 'draft',
    }, error: null })) })
    const result = await savePeriodPlan({ workspaceId, request, catalogVersion: 1, estimatedCredits: 50 }, providedGateway)

    expect(result).toEqual({ data: expect.objectContaining({ status: 'draft' }) })
    expect(providedGateway.rpc).toHaveBeenCalledWith('create_period_content_plan', expect.objectContaining({
      p_workspace_id: workspaceId,
      p_idempotency_key: request.idempotencyKey,
    }))
  })

  it('returns a safe conflict code when approval observes a stale plan version', async () => {
    const result = await approvePeriodPlan({
      workspaceId,
      planId: '30000000-0000-4000-8000-000000000001',
      expectedVersion: 1,
      idempotencyKey: '10000000-0000-4000-8000-000000000002',
    }, gateway({ rpc: vi.fn(async () => ({ data: null, error: { message: 'PLAN_VERSION_CONFLICT' } })) }))

    expect(result).toEqual({ error: expect.objectContaining({ code: 'PLAN_VERSION_CONFLICT' }) })
  })
})
