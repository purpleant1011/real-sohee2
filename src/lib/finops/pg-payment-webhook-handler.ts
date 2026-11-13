import type { SoheePlanTier } from '@/features/credit-economy/types'
import type { CreditLedgerSourceChain } from './credit-ledger-source-chain'

export interface PgWebhookPayload {
  webhookEventId: string
  eventType: 'PAYMENT_COMPLETED' | 'SUBSCRIPTION_RENEWED' | 'PAYMENT_FAILED'
  workspaceId: string
  paymentKey: string
  orderId: string
  amountKrw: number
  planTier: SoheePlanTier
  timestamp: string
  signature?: string
}

/**
 * @deprecated 검증·영속 처리가 없는 과거 인메모리 웹훅 prototype.
 * 신규 월 구독은 모델·기능 이용권이며 PG 통보로 크레딧을 지급하지 않는다.
 * 실제 웹훅은 공식 서명·서버 readback·durable 주문 대사를 갖춘 별도 경로로 구현해야 한다.
 * 이 클래스는 청구 성공/실패를 판정하거나 원장에 쓰지 않고 항상 거부한다.
 */
export class PgPaymentWebhookHandler {
  constructor(ledgerChain: CreditLedgerSourceChain) {
    // 기존 호출부 타입 호환만 유지하며 원장 쓰기 참조는 보관하지 않는다.
    void ledgerChain
  }

  async handleWebhook(_payload: PgWebhookPayload, currentBalance: number): Promise<{
    status: 'FAILED'
    creditsGranted: number
    newBalance: number
    message: string
  }> {
    return {
      status: 'FAILED',
      creditsGranted: 0,
      newBalance: currentBalance,
      message: '구독 크레딧 자동지급은 지원하지 않습니다. 이 레거시 경로는 결제 검증을 처리하지 않습니다.',
    }
  }

  isProcessed(webhookEventId: string): boolean {
    void webhookEventId
    return false
  }
}
