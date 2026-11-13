import * as PortOneWebhook from '@portone/server-sdk/webhook'
import { InvalidInputError, WebhookVerificationError } from '@portone/server-sdk/webhook'
import type { Webhook } from '@portone/server-sdk/webhook'

export type PortOneWebhookHeaders = Record<string, string | string[] | undefined>

export type VerifyWebhookFn = (
  secret: string,
  payload: string,
  headers: PortOneWebhookHeaders
) => Promise<Webhook>

export interface VerifyPortOneWebhookParams {
  rawBody: string
  headers: PortOneWebhookHeaders
  secret: string
  verify?: VerifyWebhookFn
}

export type VerifyPortOneWebhookResult =
  | { ok: true; webhook: Webhook; webhookId: string }
  | { ok: false; reason: string }

/**
 * PortOne 웹훅 서명을 검증하는 래퍼 함수.
 *
 * 제약사항:
 * - 시크릿은 인자로만 전달받으며 process.env 등을 읽지 않는다.
 * - 서명 실패/헤더 누락/입력 오류 시 정규화된 reason을 반환하며
 *   원문 오류 메시지나 시크릿은 절대 노출/로깅하지 않는다.
 */
export async function verifyPortOneWebhook({
  rawBody,
  headers,
  secret,
  verify = PortOneWebhook.verify,
}: VerifyPortOneWebhookParams): Promise<VerifyPortOneWebhookResult> {
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    return { ok: false, reason: 'missing_secret' }
  }

  if (typeof rawBody !== 'string' || rawBody.trim().length === 0) {
    return { ok: false, reason: 'missing_raw_body' }
  }

  if (typeof headers !== 'object' || headers === null) {
    return { ok: false, reason: 'missing_headers' }
  }

  const webhookId = findHeaderValue(headers, 'webhook-id')
  if (!webhookId) {
    return { ok: false, reason: 'missing_webhook_id' }
  }

  try {
    const webhook = await verify(secret, rawBody, headers)
    if (!webhook || typeof webhook !== 'object') {
      return { ok: false, reason: 'invalid_webhook_payload' }
    }
    return { ok: true, webhook, webhookId }
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      switch (error.reason) {
        case 'MISSING_REQUIRED_HEADERS':
          return { ok: false, reason: 'missing_required_headers' }
        case 'NO_MATCHING_SIGNATURE':
          return { ok: false, reason: 'no_matching_signature' }
        case 'INVALID_SIGNATURE':
          return { ok: false, reason: 'invalid_signature' }
        case 'TIMESTAMP_TOO_OLD':
          return { ok: false, reason: 'timestamp_too_old' }
        case 'TIMESTAMP_TOO_NEW':
          return { ok: false, reason: 'timestamp_too_new' }
        default:
          return { ok: false, reason: 'verification_failed' }
      }
    }

    if (error instanceof InvalidInputError) {
      return { ok: false, reason: 'invalid_input' }
    }

    return { ok: false, reason: 'verification_failed' }
  }
}

export type WebhookHandlingDecision =
  | { action: 'ignore_duplicate'; eventId: string }
  | { action: 'process'; eventId: string }
  | { action: 'reject'; reason: string }

/**
 * 같은 provider event id가 이미 처리되었는지 판단하는 순수 함수.
 * 중복이면 { action: 'ignore_duplicate', eventId }, 신규면 { action: 'process', eventId }.
 */
export function decideWebhookHandling(
  event: unknown,
  seenIds: Set<string> | readonly string[] | Iterable<string>
): WebhookHandlingDecision {
  const eventId = extractProviderEventId(event)
  if (!eventId) {
    return { action: 'reject', reason: 'missing_event_id' }
  }

  const isDuplicate = seenIds instanceof Set
    ? seenIds.has(eventId)
    : Array.from(seenIds).includes(eventId)

  if (isDuplicate) {
    return { action: 'ignore_duplicate', eventId }
  }

  return { action: 'process', eventId }
}

function findHeaderValue(headers: PortOneWebhookHeaders, targetHeader: string): string | null {
  const targetLower = targetHeader.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === targetLower) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.trim().length > 0) {
            return item.trim()
          }
        }
      }
    }
  }
  return null
}

function extractProviderEventId(event: unknown): string | null {
  if (typeof event === 'string') {
    const trimmed = event.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof event === 'object' && event !== null) {
    const record = event as Record<string, unknown>
    // 1순위: webhook-id 헤더 기반의 webhookId
    if (typeof record.webhookId === 'string' && record.webhookId.trim().length > 0) {
      return record.webhookId.trim()
    }

    // 2순위 (폴백): providerEventId, eventId, id
    const fallbacks = [
      record.providerEventId,
      record.eventId,
      record.id,
    ]

    for (const cand of fallbacks) {
      if (typeof cand === 'string' && cand.trim().length > 0) {
        return cand.trim()
      }
    }
  }

  return null
}

export type OrderTransitionEventType =
  | 'paid'
  | 'cancelled'
  | 'partial_cancelled'
  | 'failed'

export interface OrderTransitionEvent {
  type: OrderTransitionEventType
  paymentId?: string
  storeId?: string
  transactionId?: string
  cancellationId?: string
  timestamp?: string
  rawType: string
}

/**
 * 포트원 웹훅 이벤트(결제완료, 취소, 부분취소, 실패)를
 * 주문 상태 전이 입력({ type: 'paid' | 'cancelled' | 'partial_cancelled' | 'failed' })으로 변환하는 순수 함수.
 * 지원되지 않는 타입의 경우 null을 반환한다.
 */
export function mapWebhookToOrderEvent(eventOrType: unknown): OrderTransitionEvent | null {
  if (!eventOrType) {
    return null
  }

  let rawType = ''
  let timestamp: string | undefined
  let paymentId: string | undefined
  let storeId: string | undefined
  let transactionId: string | undefined
  let cancellationId: string | undefined

  if (typeof eventOrType === 'string') {
    rawType = eventOrType.trim()
  } else if (typeof eventOrType === 'object') {
    const record = eventOrType as Record<string, unknown>
    if (typeof record.type === 'string') {
      rawType = record.type.trim()
    }
    if (typeof record.timestamp === 'string') {
      timestamp = record.timestamp
    }
    if (typeof record.data === 'object' && record.data !== null) {
      const data = record.data as Record<string, unknown>
      if (typeof data.paymentId === 'string') paymentId = data.paymentId
      if (typeof data.storeId === 'string') storeId = data.storeId
      if (typeof data.transactionId === 'string') transactionId = data.transactionId
      if (typeof data.cancellationId === 'string') cancellationId = data.cancellationId
    }
  }

  if (!rawType) {
    return null
  }

  const mappedType = resolveOrderTransitionType(rawType)
  if (!mappedType) {
    return null
  }

  return {
    type: mappedType,
    paymentId,
    storeId,
    transactionId,
    cancellationId,
    timestamp,
    rawType,
  }
}

function resolveOrderTransitionType(rawType: string): OrderTransitionEventType | null {
  const normalized = rawType.toLowerCase()

  switch (normalized) {
    case 'transaction.paid':
    case 'paid':
    case 'payment_paid':
      return 'paid'

    case 'transaction.cancelled':
    case 'cancelled':
    case 'canceled':
      return 'cancelled'

    case 'transaction.partialcancelled':
    case 'partial_cancelled':
    case 'partial_canceled':
    case 'partialcancelled':
      return 'partial_cancelled'

    case 'transaction.failed':
    case 'failed':
      return 'failed'

    default:
      return null
  }
}
