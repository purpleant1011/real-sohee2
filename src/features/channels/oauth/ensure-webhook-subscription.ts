import { subscribeInstagramWebhooks, type SubscribeInstagramWebhooksResult } from './webhook-subscription'

export interface EnsureInstagramWebhookSubscriptionInput {
  connection: {
    id?: string
    webhook_status?: string | null
    [key: string]: unknown
  }
  accessToken: string
  igUserId?: string | null
  now?: Date | number
  subscribe?: (input: { accessToken: string; igUserId?: string | null }) => Promise<SubscribeInstagramWebhooksResult>
}

export interface EnsureInstagramWebhookSubscriptionResult {
  attempted: boolean
  ok?: boolean
  reason?: string
}

/**
 * 인스타그램 웹훅 구독 상태 보장
 * - connection.webhook_status !== 'healthy' 인 경우에만 구독을 호출합니다.
 * - DB 컬럼 없이 Cloudflare Worker 재시작 환경에서도 안전하도록 healthy가 아닌 연결에 대해 크론 호출당 1회 구독을 시도합니다.
 * - console.warn('[webhook-ensure]', {channel:'instagram', ok, reason}) 으로 안전하게 로깅합니다 (토큰/핸들 노출 금지).
 */
export async function ensureInstagramWebhookSubscription({
  connection,
  accessToken,
  igUserId,
  subscribe = subscribeInstagramWebhooks,
}: EnsureInstagramWebhookSubscriptionInput): Promise<EnsureInstagramWebhookSubscriptionResult> {
  if (connection.webhook_status === 'healthy') {
    return { attempted: false }
  }

  // DB 컬럼 없이 Cloudflare Worker 재시작 환경에서도 안전하도록 healthy가 아닌 연결에 대해 크론 호출당 1회 구독을 시도합니다.
  try {
    const result = await subscribe({ accessToken, igUserId })
    console.warn('[webhook-ensure]', {
      channel: 'instagram',
      ok: result.ok,
      reason: result.reason,
    })
    return {
      attempted: true,
      ok: result.ok,
      reason: result.reason,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'UNEXPECTED_ERROR'
    console.warn('[webhook-ensure]', {
      channel: 'instagram',
      ok: false,
      reason,
    })
    return {
      attempted: true,
      ok: false,
      reason,
    }
  }
}
