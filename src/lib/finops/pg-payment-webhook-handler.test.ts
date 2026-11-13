import { describe, expect, it } from 'vitest'
import { CreditLedgerSourceChain } from './credit-ledger-source-chain'
import { PgPaymentWebhookHandler, type PgWebhookPayload } from './pg-payment-webhook-handler'

const event: PgWebhookPayload = {
  webhookEventId: 'test-event', eventType: 'PAYMENT_COMPLETED', workspaceId: 'review-workspace',
  paymentKey: 'test-reference', orderId: 'test-order', amountKrw: 150000,
  planTier: 'TIER_150K_STARTER', timestamp: '2026-11-06T00:00:00Z',
}

function existingLedger() {
  const ledger = new CreditLedgerSourceChain()
  ledger.appendEntry({ workspaceId: event.workspaceId, entryType: 'GRANT', amount: 240,
    currentBalance: 0, transactionRefId: 'historical-grant', reason: 'Historical entitlement fixture',
    initiatedBy: 'TEST', idempotencyKey: 'historical-key' })
  return ledger
}

describe('레거시 PG 웹훅은 신규 구독 크레딧을 발행할 수 없다', () => {
  it.each(['PAYMENT_COMPLETED', 'SUBSCRIPTION_RENEWED'] as const)('%s가 기존 잔액·원장을 변경하거나 성공 처리되지 않는다', async (eventType) => {
    const ledger = existingLedger()
    const before = structuredClone(ledger.getChain(event.workspaceId))
    const handler = new PgPaymentWebhookHandler(ledger)
    const result = await handler.handleWebhook({ ...event, eventType }, 240)
    expect(result.status).toBe('FAILED')
    expect(result.creditsGranted).toBe(0)
    expect(result.newBalance).toBe(240)
    expect(ledger.getChain(event.workspaceId)).toEqual(before)
    expect(handler.isProcessed(event.webhookEventId)).toBe(false)
  })

  it('중복·재시작·위조 서명·임의 상품값으로도 크레딧을 지급하지 않는다', async () => {
    const ledger = existingLedger()
    for (const webhookEventId of ['test-event', 'test-event', 'other-event']) {
      const handler = new PgPaymentWebhookHandler(ledger)
      const result = await handler.handleWebhook({ ...event, webhookEventId, signature: 'forged', amountKrw: 1 }, 240)
      expect(result.status).toBe('FAILED')
      expect(result.creditsGranted).toBe(0)
      expect(result.newBalance).toBe(240)
    }
    expect(ledger.getChain(event.workspaceId)).toHaveLength(1)
    expect(ledger.verifyChainIntegrity(event.workspaceId).isValid).toBe(true)
  })

  it('결제실패 통보도 검증·영속기록 없이 처리완료로 가장하지 않는다', async () => {
    const ledger = existingLedger()
    const handler = new PgPaymentWebhookHandler(ledger)
    const result = await handler.handleWebhook({ ...event, eventType: 'PAYMENT_FAILED' }, 240)
    expect(result.status).toBe('FAILED')
    expect(result.creditsGranted).toBe(0)
    expect(handler.isProcessed(event.webhookEventId)).toBe(false)
    expect(ledger.getChain(event.workspaceId)).toHaveLength(1)
  })
})
