import { describe, expect, it, vi } from 'vitest'
import { getCreditBalance, listCreditLedger, listCreditUsageDetail, reserveCredits, type CreditGateway } from './repository'

const workspaceId = '20000000-0000-4000-8000-000000000001'

function gateway(overrides: Partial<CreditGateway> = {}): CreditGateway {
  return { rpc: vi.fn(async () => ({ data: null, error: null })), ...overrides }
}

describe('credit server service', () => {
  it('parses the transactionally derived balance returned by the RPC', async () => {
    const result = await getCreditBalance(workspaceId, gateway({
      rpc: vi.fn(async () => ({ data: {
        workspaceId,
        periodStart: '2026-08-17', periodEnd: '2026-08-23',
        granted: 2000, adjustments: 0, released: 40, consumed: 25, reserved: 40, available: 1975,
        weeklyLimit: 2000, policyVersion: 'v08-test-2000-1',
      }, error: null })),
    }))

    expect(result).toEqual({ data: expect.objectContaining({
      available: 1975,
      reserved: 40,
      weeklyLimit: 2000,
      policyVersion: 'v08-test-2000-1',
    }) })
  })

  it('returns the safe insufficient-credit code instead of a database error detail', async () => {
    const result = await reserveCredits({
      workspaceId, action: 'image_generation', credits: 90,
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
      reservationId: '30000000-0000-4000-8000-000000000001',
    }, gateway({ rpc: vi.fn(async () => ({ data: null, error: { message: 'CREDIT_INSUFFICIENT' } })) }))

    expect(result).toEqual({ error: expect.objectContaining({ code: 'CREDIT_INSUFFICIENT' }) })
  })

  it('reuses the original reservation through the RPC for the same idempotency key', async () => {
    const rpc = vi.fn(async () => ({ data: {
      reservationId: '30000000-0000-4000-8000-000000000001', state: 'reserved', requestedCredits: 10,
    }, error: null }))
    const input = {
      workspaceId, action: 'chat_turn' as const, credits: 10,
      idempotencyKey: '10000000-0000-4000-8000-000000000001',
      reservationId: '30000000-0000-4000-8000-000000000001',
    }
    const providedGateway = gateway({ rpc })

    await reserveCredits(input, providedGateway)
    await reserveCredits(input, providedGateway)

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls).toEqual([
      ['reserve_workspace_credits', expect.objectContaining({ p_idempotency_key: input.idempotencyKey })],
      ['reserve_workspace_credits', expect.objectContaining({ p_idempotency_key: input.idempotencyKey })],
    ])
  })

  it('reads ledger rows only through the workspace-scoped RPC', async () => {
    const providedGateway = gateway({ rpc: vi.fn(async () => ({ data: [], error: null })) })
    await listCreditLedger(workspaceId, { kind: 'release' }, providedGateway)

    expect(providedGateway.rpc).toHaveBeenCalledWith('list_workspace_credit_ledger', {
      p_workspace_id: workspaceId,
      p_kind: 'release',
      p_limit: 50,
    })
  })

  it('maps actual token usage with reservation settlement and release', async () => {
    const providedGateway = gateway({ rpc: vi.fn(async () => ({ data: [{
      occurred_at: '2026-08-23T03:10:00.000Z',
      operation: 'image_generation', usage_source: 'actual',
      text_input_tokens: 1438, cached_text_input_tokens: 0, text_output_tokens: 0,
      image_input_tokens: 0, image_output_tokens: 1372, provider_total_tokens: 3689,
      requested_credits: 45, settled_credits: 11, released_credits: 34,
      policy_version: 'v08-test-2000-1',
    }], error: null })) })

    const result = await listCreditUsageDetail(workspaceId, 20, providedGateway)

    expect(result).toEqual({ data: [{
      occurredAt: '2026-08-23T03:10:00.000Z',
      operation: 'image_generation', usageSource: 'actual',
      textInputTokens: 1438, cachedTextInputTokens: 0, textOutputTokens: 0,
      imageInputTokens: 0, imageOutputTokens: 1372, providerTotalTokens: 3689,
      requestedCredits: 45, settledCredits: 11, releasedCredits: 34,
      policyVersion: 'v08-test-2000-1',
    }] })
    expect(providedGateway.rpc).toHaveBeenCalledWith('get_workspace_credit_usage_detail', {
      p_workspace_id: workspaceId,
      p_limit: 20,
    })
  })

  it('rejects malformed usage detail instead of showing invented zeroes', async () => {
    const result = await listCreditUsageDetail(workspaceId, 20, gateway({
      rpc: vi.fn(async () => ({ data: [{ operation: 'image_generation' }], error: null })),
    }))

    expect(result).toEqual({ error: { code: 'CREDIT_RPC_FAILED' } })
  })
})
