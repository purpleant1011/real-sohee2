import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { BillingGateway } from './analysis'
import { reserveCredits, settleCredits, type CreditGateway } from '@/features/credits/repository'
import { previewCreditCost } from '@/features/credits/rate-catalog'
import type { CreditRateCatalog } from '@/features/credits/types'
import { LearningError } from './contracts'

export type LearningBillingState = {
  state: 'reserved' | 'settled' | 'reconciliation_required' | 'rejected'
  reservationId: string
  credits: number
  reconciliationReason?: 'unknown_reserve_outcome' | 'provider_attempted' | 'settle_failed'
  failureCode?: string
}
function operationId(jobId: string, phase: string): string {
  const bytes = createHash('sha256').update(`learning:${jobId}:${phase}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Reuses the existing source_analysis catalog and durable ledger; never invents a price or a reservation receipt. */
export function createDurableLearningBilling(input: {
  workspaceId: string; jobId: string; gateway: CreditGateway; catalog: CreditRateCatalog
  initialState?: LearningBillingState
  recordState(value: LearningBillingState): Promise<void>
}): BillingGateway {
  z.string().uuid().parse(input.workspaceId)
  z.string().uuid().parse(input.jobId)
  const reservationId = operationId(input.jobId, 'reservation')
  const quoteId = operationId(input.jobId, `quote:${input.catalog.catalogVersion}`)
  let credits = input.initialState?.credits ?? 0
  let reserved = input.initialState?.state === 'reserved'
  let settled = input.initialState?.state === 'settled'
  return {
    async quote(operation, units) {
      if (input.initialState) {
        if (input.initialState.state === 'rejected') {
          return { allowed: false, reason: 'BILLING_RESERVATION_REJECTED' }
        }
        return { allowed: false, reason: 'BILLING_RECONCILIATION_REQUIRED' }
      }
      if (operation !== 'extract_knowledge' || !Number.isSafeInteger(units) || units < 1 || units > 30) {
        return { allowed: false, reason: 'BILLING_INPUT_INVALID' }
      }
      try {
        const preview = previewCreditCost({ action: 'source_analysis', units: { chatTurns: 0,
          textGenerations: 0, imageGenerations: 0, sourceAnalyses: units, externalActions: 0 } }, input.catalog)
        if (preview.estimatedCredits <= 0) return { allowed: false, reason: 'FINOPS_RATE_NOT_CONFIGURED' }
        credits = preview.estimatedCredits
        return { allowed: true, quoteId }
      } catch { return { allowed: false, reason: 'FINOPS_RATE_NOT_CONFIGURED' } }
    },
    async reserve(requestedQuoteId) {
      if (requestedQuoteId !== quoteId || credits <= 0 || reserved || settled) throw new LearningError('BILLING_QUOTE_INVALID', '분석 이용 조건을 다시 확인해야 해요.')
      // Pre-reserve durable journal: record reconciliation_required before touching the ledger.
      // If journal write fails, zero ledger operations occur. If ledger fails or process crashes,
      // the job already holds a billing state preventing free/duplicate provider re-execution.
      await input.recordState({
        state: 'reconciliation_required',
        reservationId,
        credits,
        reconciliationReason: 'unknown_reserve_outcome',
      })
      const result = await reserveCredits({ workspaceId: input.workspaceId, action: 'source_analysis', credits,
        idempotencyKey: operationId(input.jobId, 'reserve'), reservationId }, input.gateway)

      if (result.error) {
        const code = result.error.code
        // Explicit rejection from ledger (definite no reservation): insufficient credits or forbidden
        if (code === 'CREDIT_INSUFFICIENT' || code === 'CREDIT_FORBIDDEN') {
          await input.recordState({
            state: 'rejected',
            reservationId,
            credits,
            failureCode: code,
          })
          throw new LearningError(
            code === 'CREDIT_INSUFFICIENT' ? 'BILLING_INSUFFICIENT_CREDITS' : 'BILLING_FORBIDDEN',
            '이용 가능한 크레딧이 부족해요.',
          )
        }
        // Ambiguous RPC / network failure: outcome unknown, state remains reconciliation_required
        throw new LearningError('BILLING_RESERVATION_BLOCKED', '분석 이용 조건을 확인하지 못했어요.')
      }

      if (!result.data || result.data.state !== 'reserved') {
        throw new LearningError('BILLING_RESERVATION_BLOCKED', '분석 이용 조건을 확인하지 못했어요.')
      }
      reserved = true
      await input.recordState({ state: 'reserved', reservationId, credits })
      return { reservationId }
    },
    async settle(id) {
      if (!reserved || settled || id !== reservationId) throw new LearningError('BILLING_RESERVATION_INVALID', '분석 처리 내역을 확인해야 해요.')
      // The catalog charges source-analysis units, not the number of extracted candidates.
      const result = await settleCredits({ workspaceId: input.workspaceId, reservationId,
        actualCredits: credits, idempotencyKey: operationId(input.jobId, 'settle') }, input.gateway)
      if (result.error || !result.data) {
        await input.recordState({
          state: 'reconciliation_required',
          reservationId,
          credits,
          reconciliationReason: 'settle_failed',
          failureCode: result.error?.code,
        })
        throw new LearningError('BILLING_RECONCILIATION_REQUIRED', '분석 처리 내역을 확인 중이에요.')
      }
      reserved = false
      settled = true
      await input.recordState({ state: 'settled', reservationId, credits })
    },
    async release(id) {
      if (!reserved || settled || id !== reservationId) throw new LearningError('BILLING_RESERVATION_INVALID', '분석 처리 내역을 확인해야 해요.')
      // Once the AI pipeline was entered, an exception does not prove the provider did no work.
      // Preserve the durable reservation for reconciliation instead of refunding a possibly paid call.
      reserved = false
      await input.recordState({
        state: 'reconciliation_required',
        reservationId,
        credits,
        reconciliationReason: 'provider_attempted',
      })
      throw new LearningError('BILLING_RECONCILIATION_REQUIRED', '분석 처리 내역을 확인 중이에요.')
    },
  }
}
