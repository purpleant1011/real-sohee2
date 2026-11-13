import { channelConnectHref, type ChannelId } from './channel-readiness'
import type { SafeMetaOAuthCallbackCode } from '@/features/channels/oauth/meta-oauth'

export type ConnectFlowResult = 'connected' | 'cancelled' | 'invalid' | 'unavailable' | 'forbidden'

export interface ConnectFlow {
  /** 서버 콜백의 authorized 와 connected 는 같은 뜻이다 — '연결 요청이 끝났다'는 신호일 뿐. */
  result: ConnectFlowResult
  channel: ChannelId | null
  safeCode?: SafeMetaOAuthCallbackCode
}

const SAFE_CODES: ReadonlySet<string> = new Set([
  'META_OAUTH_INTERNAL', 'META_OAUTH_TOKEN_EXCHANGE', 'META_OAUTH_ACCOUNT_LOOKUP',
  'META_OAUTH_PERSISTENCE', 'SCOPE_MISSING', 'SCOPE_VERIFICATION_UNAVAILABLE',
  'ACCOUNT_ALREADY_CONNECTED', 'CONNECTION_SAVE_FAILED',
])

/** 서버가 내려주는 connect 결과값. 여기 없는 값은 모른다고 보고 무시한다. */
const RESULT_ALIAS: ReadonlyMap<string, ConnectFlowResult> = new Map([
  ['connected', 'connected'], ['authorized', 'connected'], ['cancelled', 'cancelled'],
  ['invalid', 'invalid'], ['unavailable', 'unavailable'], ['forbidden', 'forbidden'],
])

/**
 * OAuth 복귀 쿼리(`?connect=...&channel=...`)를 읽는다. 아는 값이 아니면 null.
 * 여기서 나온 값은 연결·게시 가능의 근거가 아니다. 상태는 /api/channels readback 이 정한다.
 */
export function parseConnectFlow(search: string): ConnectFlow | null {
  const params = new URLSearchParams(search)
  const rawCode = params.get('connect_error') || params.get('error')
  const safeCode = rawCode && SAFE_CODES.has(rawCode) ? rawCode as SafeMetaOAuthCallbackCode : undefined
  const result = RESULT_ALIAS.get(params.get('connect') ?? '') ?? (safeCode ? 'unavailable' : undefined)
  if (!result) return null
  const channel = params.get('channel')
  return {
    result,
    channel: channel === 'instagram' || channel === 'threads' ? channel : null,
    ...(safeCode ? { safeCode } : {}),
  }
}

/** 취소 후 다시 연결할 주소. 채널을 모르면 링크를 만들지 않는다. */
export function connectRetryHref(flow: ConnectFlow): string | null {
  return flow.channel ? channelConnectHref(flow.channel) : null
}
