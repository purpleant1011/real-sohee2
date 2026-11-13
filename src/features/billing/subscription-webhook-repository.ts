import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canTransitionOrder,
  transitionOrder,
  type SubscriptionOrderStatus,
} from './subscription-order'

// SupabaseClient 또는 호환 가능한 쿼리 빌더 클라이언트 인터페이스
export type WebhookRepositoryDatabaseClient = {
  from(table: string): any
} | SupabaseClient<any>

export type RecordWebhookEventParams = {
  providerEventId: string
  orderId?: string | null
  receivedAt?: Date
}

export type RecordWebhookEventResult =
  | { duplicate: true; eventId: string }
  | { duplicate: false; eventId: string }

export type ApplyOrderTransitionParams = {
  orderId: string
  event: 'paid' | 'cancelled' | 'failed'
  providerEventId?: string
}

export type ApplyOrderTransitionResult =
  | {
      ok: true
      previousStatus: SubscriptionOrderStatus
      newStatus: SubscriptionOrderStatus
    }
  | {
      ok: false
      reason: 'ORDER_NOT_FOUND'
    }
  | {
      ok: false
      reason: 'INVALID_TRANSITION'
      currentStatus: SubscriptionOrderStatus
    }

/**
 * 웹훅 수신 이벤트를 기록하여 멱등성 및 중복 처리를 보장한다.
 * provider_event_id 충돌 시 duplicate: true와 기존 eventId를 반환한다.
 */
export async function recordWebhookEvent(
  client: WebhookRepositoryDatabaseClient,
  params: RecordWebhookEventParams
): Promise<RecordWebhookEventResult> {
  const table = client.from('subscription_webhook_events')

  // 1. 사전 중복 체크 (Durable 조회)
  const { data: existing } = await table
    .select('id')
    .eq('provider_event_id', params.providerEventId)
    .maybeSingle()

  if (existing?.id) {
    return { duplicate: true, eventId: existing.id }
  }

  const receivedAtIso = (params.receivedAt ?? new Date()).toISOString()

  // 2. 신규 이벤트 삽입 시도
  const { data: inserted, error } = await table
    .insert({
      provider_event_id: params.providerEventId,
      order_id: params.orderId ?? null,
      received_at: receivedAtIso,
    })
    .select('id')
    .single()

  if (error) {
    // Unique constraint violation (Postgres 23505) 또는 중복 키 충돌
    const isDuplicate =
      error.code === '23505' ||
      error.message?.includes('duplicate key') ||
      error.message?.includes('unique constraint')

    if (isDuplicate) {
      const { data: fallback } = await table
        .select('id')
        .eq('provider_event_id', params.providerEventId)
        .single()

      return {
        duplicate: true,
        eventId: fallback?.id ?? '',
      }
    }

    throw error
  }

  return {
    duplicate: false,
    eventId: inserted.id,
  }
}

/**
 * 웹훅 이벤트에 따라 구독 주문 상태를 전이하고 DB에 갱신한다.
 * - 주문이 없을 경우 ORDER_NOT_FOUND 반환
 * - 전이 규칙 위반 시 INVALID_TRANSITION 반환
 * - 정상 전이 시 update 실행 후 성공 결과 반환
 */
export async function applyOrderTransitionFromWebhook(
  client: WebhookRepositoryDatabaseClient,
  params: ApplyOrderTransitionParams
): Promise<ApplyOrderTransitionResult> {
  const table = client.from('subscription_orders')

  // 1. 대상 주문의 현재 상태 조회
  const { data: order, error: fetchError } = await table
    .select('status')
    .eq('id', params.orderId)
    .maybeSingle()

  if (fetchError || !order?.status) {
    return { ok: false, reason: 'ORDER_NOT_FOUND' }
  }

  const currentStatus = order.status as SubscriptionOrderStatus

  // 2. 도메인 규칙 기반 전이 가능 여부 확인
  if (!canTransitionOrder(currentStatus, params.event)) {
    return {
      ok: false,
      reason: 'INVALID_TRANSITION',
      currentStatus,
    }
  }

  // 3. 신규 상태 계산
  const newStatus = transitionOrder(currentStatus, params.event)

  // 4. 주문 상태 갱신
  const { error: updateError } = await table
    .update({ status: newStatus })
    .eq('id', params.orderId)

  if (updateError) {
    throw updateError
  }

  return {
    ok: true,
    previousStatus: currentStatus,
    newStatus,
  }
}
