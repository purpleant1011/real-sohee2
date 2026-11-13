export const INSTAGRAM_GRAPH_VERSION = 'v23.0'
export const INSTAGRAM_SUBSCRIBED_FIELDS = 'comments,messages,mentions'

export interface SubscribeInstagramWebhooksInput {
  accessToken: string
  igUserId?: string | null
  fetchImpl?: typeof fetch
}

export interface SubscribeInstagramWebhooksResult {
  ok: boolean
  reason?: string
}

function extractMetaErrorCode(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'object' && error !== null) {
      const code = (error as { code?: unknown }).code
      const subcode = (error as { error_subcode?: unknown }).error_subcode
      if (typeof code === 'number' || typeof code === 'string') {
        return typeof subcode === 'number' || typeof subcode === 'string'
          ? `META_ERROR_${code}_${subcode}`
          : `META_ERROR_${code}`
      }
    }
  }

  if (typeof payload === 'object' && payload !== null && 'success' in payload) {
    if ((payload as { success?: unknown }).success === false) {
      return 'SUBSCRIPTION_UNSUCCESSFUL'
    }
  }

  return `HTTP_${status}`
}

/**
 * Instagram Webhook 자동 구독 등록
 * - Instagram Graph API: POST https://graph.instagram.com/v23.0/{igUserId or me}/subscribed_apps
 * - subscribed_fields: comments,messages,mentions
 * - 실패해도 예외를 던지지 않고 {ok:false, reason} 반환 (연결 성공 차단 방지)
 * - 토큰 및 응답 본문 전체 노출 금지 (console.warn 에 reason 코드만 기록)
 */
export async function subscribeInstagramWebhooks({
  accessToken,
  igUserId,
  fetchImpl,
}: SubscribeInstagramWebhooksInput): Promise<SubscribeInstagramWebhooksResult> {
  const token = typeof accessToken === 'string' ? accessToken.trim() : ''
  if (!token) {
    console.warn('[webhook-subscribe] failed: MISSING_ACCESS_TOKEN')
    return { ok: false, reason: 'MISSING_ACCESS_TOKEN' }
  }

  const effectiveFetch = fetchImpl ?? fetch
  const target = igUserId && typeof igUserId === 'string' && igUserId.trim()
    ? encodeURIComponent(igUserId.trim())
    : 'me'
  const endpoint = `https://graph.instagram.com/${INSTAGRAM_GRAPH_VERSION}/${target}/subscribed_apps`

  try {
    const body = new URLSearchParams({
      subscribed_fields: INSTAGRAM_SUBSCRIBED_FIELDS,
    })

    const response = await effectiveFetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      const reason = `HTTP_${response.status}`
      console.warn('[webhook-subscribe] instagram subscription response parse failed:', { reason })
      return { ok: false, reason }
    }

    if (response.ok && typeof payload === 'object' && payload !== null && (payload as { success?: unknown }).success === true) {
      return { ok: true }
    }

    const reason = extractMetaErrorCode(payload, response.status)
    console.warn('[webhook-subscribe] instagram subscription unsuccessful:', { reason })
    return { ok: false, reason }
  } catch {
    console.warn('[webhook-subscribe] instagram subscription network failure: NETWORK_ERROR')
    return { ok: false, reason: 'NETWORK_ERROR' }
  }
}
