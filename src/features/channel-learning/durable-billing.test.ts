import { describe, expect, it } from 'vitest'
import { createDurableLearningBilling } from './durable-billing'
import type { CreditGateway } from '@/features/credits/repository'
import type { CreditRateCatalog } from '@/features/credits/types'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const jobId = '20000000-0000-4000-8000-000000000001'
const catalog: CreditRateCatalog = { catalogVersion: 1, rates: { source_analysis: { baseCredits: 0,
  perUnit: { chatTurns: 0, textGenerations: 0, imageGenerations: 0, sourceAnalyses: 2, externalActions: 0 } } } }
function ledger() {
  let reserved = 0
  let consumed = 0
  const gateway: CreditGateway = { async rpc(name, input) {
    if (name === 'reserve_workspace_credits') {
      reserved = Number(input.p_credits)
      return { data: { reservationId: input.p_reservation_id, state: 'reserved' }, error: null }
    }
    if (name === 'settle_credit_reservation') {
      consumed = Number(input.p_actual_credits)
      reserved = 0
      return { data: { reservationId: input.p_reservation_id, state: 'settled' }, error: null }
    }
    throw new Error('unexpected ledger action')
  } }
  return { gateway, totals: () => ({ reserved, consumed }) }
}

describe('durable source analysis billing integration', () => {
  it('requires an approved source analysis rate instead of inventing a price', async () => {
    const state = ledger()
    const billing = createDurableLearningBilling({ workspaceId, jobId, gateway: state.gateway, catalog: { catalogVersion: 1, rates: {} }, async recordState() {} })
    expect((await billing.quote('extract_knowledge', 2)).allowed).toBe(false)
    expect(state.totals()).toEqual({ reserved: 0, consumed: 0 })
  })
  it('reserves and settles through durable credit RPC using analysis units, not number of extracted facts', async () => {
    const state = ledger()
    const billing = createDurableLearningBilling({ workspaceId, jobId, gateway: state.gateway, catalog, async recordState() {} })
    const quote = await billing.quote('extract_knowledge', 3)
    const reservation = await billing.reserve(quote.quoteId!)
    expect(state.totals()).toEqual({ reserved: 6, consumed: 0 })
    await billing.settle(reservation.reservationId, 100)
    expect(state.totals()).toEqual({ reserved: 0, consumed: 6 })
  })
  it('does not refund an ambiguous provider failure and records reconciliation required', async () => {
    const state = ledger()
    let checkpoint = ''
    const billing = createDurableLearningBilling({ workspaceId, jobId, gateway: state.gateway, catalog,
      async recordState(value) { checkpoint = value.state } })
    const quote = await billing.quote('extract_knowledge', 1)
    const reservation = await billing.reserve(quote.quoteId!)
    await expect(billing.release(reservation.reservationId)).rejects.toMatchObject({ code: 'BILLING_RECONCILIATION_REQUIRED' })
    expect(checkpoint).toBe('reconciliation_required')
    expect(state.totals()).toEqual({ reserved: 2, consumed: 0 })
  })

  it('rejects duplicate settle attempts and duplicate reserve attempts after settlement', async () => {
    const state = ledger()
    const billing = createDurableLearningBilling({ workspaceId, jobId, gateway: state.gateway, catalog, async recordState() {} })
    const quote = await billing.quote('extract_knowledge', 2)
    const reservation = await billing.reserve(quote.quoteId!)
    await billing.settle(reservation.reservationId, 2)

    // Duplicate settle must throw BILLING_RESERVATION_INVALID
    await expect(billing.settle(reservation.reservationId, 2)).rejects.toMatchObject({ code: 'BILLING_RESERVATION_INVALID' })
    // Duplicate reserve must throw BILLING_QUOTE_INVALID
    await expect(billing.reserve(quote.quoteId!)).rejects.toMatchObject({ code: 'BILLING_QUOTE_INVALID' })
    // Release after settle must throw BILLING_RESERVATION_INVALID
    await expect(billing.release(reservation.reservationId)).rejects.toMatchObject({ code: 'BILLING_RESERVATION_INVALID' })
    expect(state.totals()).toEqual({ reserved: 0, consumed: 4 })
  })

  it('blocks retry when initialState is already settled to prevent double billing or free re-execution', async () => {
    const state = ledger()
    const settledBilling = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: state.gateway,
      catalog,
      initialState: { state: 'settled', reservationId: 'test-res-id', credits: 6 },
      async recordState() {},
    })

    const quote = await settledBilling.quote('extract_knowledge', 3)
    expect(quote.allowed).toBe(false)
    expect(quote.reason).toBe('BILLING_RECONCILIATION_REQUIRED')
    await expect(settledBilling.reserve('any-quote')).rejects.toMatchObject({ code: 'BILLING_QUOTE_INVALID' })
    await expect(settledBilling.settle('test-res-id', 3)).rejects.toMatchObject({ code: 'BILLING_RESERVATION_INVALID' })
  })

  it('allows resuming settlement when initialState is reserved', async () => {
    const state = ledger()
    let recordedState = ''
    const expectedResId = '0dab5caf-2d41-5af8-bd59-68c58bd4cc2e'
    // Existing durable reservation in ledger:
    await state.gateway.rpc('reserve_workspace_credits', { p_credits: 4, p_reservation_id: expectedResId })
    const reservedBilling = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: state.gateway,
      catalog,
      initialState: {
        state: 'reserved',
        reservationId: expectedResId,
        credits: 4,
      },
      async recordState(val) { recordedState = val.state },
    })

    // Quote should be blocked to prevent free re-execution
    const quote = await reservedBilling.quote('extract_knowledge', 2)
    expect(quote.allowed).toBe(false)
    expect(quote.reason).toBe('BILLING_RECONCILIATION_REQUIRED')

    // Settle should succeed using the matching reservationId
    await reservedBilling.settle(expectedResId, 2)
    expect(recordedState).toBe('settled')
    expect(state.totals()).toEqual({ reserved: 0, consumed: 4 })
  })

  it('aborts without touching ledger when pre-reserve journal recordState fails', async () => {
    const state = ledger()
    let recordCalls = 0
    const failingBilling = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: state.gateway,
      catalog,
      async recordState() {
        recordCalls++
        throw new Error('DB write failure during pre-reserve journal')
      },
    })

    const quote = await failingBilling.quote('extract_knowledge', 1)
    await expect(failingBilling.reserve(quote.quoteId!)).rejects.toThrow('DB write failure during pre-reserve journal')
    expect(recordCalls).toBe(1)
    // Zero ledger calls occurred; provider re-execution cannot proceed
    expect(state.totals()).toEqual({ reserved: 0, consumed: 0 })
  })

  it('preserves pre-reserve reconciliation checkpoint and durable ledger reservation if post-reserve recordState fails', async () => {
    const state = ledger()
    const recordedStates: string[] = []
    const failingPostBilling = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: state.gateway,
      catalog,
      async recordState(val) {
        recordedStates.push(val.state)
        if (recordedStates.length === 2) {
          throw new Error('DB network glitch during post-reserve recordState')
        }
      },
    })

    const quote = await failingPostBilling.quote('extract_knowledge', 1)
    await expect(failingPostBilling.reserve(quote.quoteId!)).rejects.toThrow('DB network glitch during post-reserve recordState')

    // 1. Pre-reserve journal was recorded before calling ledger
    expect(recordedStates[0]).toBe('reconciliation_required')
    // 2. Ledger successfully holds the durable reservation
    expect(state.totals()).toEqual({ reserved: 2, consumed: 0 })

    // 3. Next worker resuming with the pre-reserve checkpoint is blocked from free/duplicate AI execution
    const resumingBilling = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: state.gateway,
      catalog,
      initialState: {
        state: 'reconciliation_required',
        reservationId: '0dab5caf-2d41-5af8-bd59-68c58bd4cc2e',
        credits: 2,
      },
      async recordState() {},
    })
    const resumeQuote = await resumingBilling.quote('extract_knowledge', 1)
    expect(resumeQuote.allowed).toBe(false)
    expect(resumeQuote.reason).toBe('BILLING_RECONCILIATION_REQUIRED')
  })

  it('F4: explicit CREDIT_INSUFFICIENT records rejected state instead of perpetual reconciliation hold', async () => {
    let recordedState: any = null
    const failingGateway: CreditGateway = {
      async rpc(name) {
        if (name === 'reserve_workspace_credits') {
          return { data: null, error: { message: 'CREDIT_INSUFFICIENT' } }
        }
        throw new Error('unexpected')
      },
    }

    const billing = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: failingGateway,
      catalog,
      async recordState(val) {
        recordedState = val
      },
    })

    const quote = await billing.quote('extract_knowledge', 2)
    await expect(billing.reserve(quote.quoteId!)).rejects.toMatchObject({
      code: 'BILLING_INSUFFICIENT_CREDITS',
    })

    expect(recordedState).toEqual(
      expect.objectContaining({
        state: 'rejected',
        failureCode: 'CREDIT_INSUFFICIENT',
      }),
    )

    // Resuming with rejected state returns BILLING_RESERVATION_REJECTED
    const resumingBilling = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: failingGateway,
      catalog,
      initialState: recordedState,
      async recordState() {},
    })
    const resumeQuote = await resumingBilling.quote('extract_knowledge', 2)
    expect(resumeQuote.allowed).toBe(false)
    expect(resumeQuote.reason).toBe('BILLING_RESERVATION_REJECTED')
  })

  it('F4: ambiguous network error preserves reconciliation_required with unknown_reserve_outcome reason', async () => {
    let recordedState: any = null
    const ambiguousGateway: CreditGateway = {
      async rpc(name) {
        if (name === 'reserve_workspace_credits') {
          return { data: null, error: { message: 'CREDIT_RPC_FAILED: connection reset' } }
        }
        throw new Error('unexpected')
      },
    }

    const billing = createDurableLearningBilling({
      workspaceId,
      jobId,
      gateway: ambiguousGateway,
      catalog,
      async recordState(val) {
        recordedState = val
      },
    })

    const quote = await billing.quote('extract_knowledge', 2)
    await expect(billing.reserve(quote.quoteId!)).rejects.toMatchObject({
      code: 'BILLING_RESERVATION_BLOCKED',
    })

    expect(recordedState).toEqual(
      expect.objectContaining({
        state: 'reconciliation_required',
        reconciliationReason: 'unknown_reserve_outcome',
      }),
    )
  })
})
