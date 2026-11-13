/**
 * 채팅 전송 결과 계약.
 *
 * 전송 실패는 조용히 사라지면 안 된다. 실패 문구가 비어 있으면 실패로 치지 않고,
 * 호출부는 반환값을 그대로 사용자 문구로 쓴다.
 */

export const CHAT_SEND_FAILED_NOTICE =
  '메시지를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.'

export type ChatSendResult = { ok: true } | { ok: false; message: string }

export interface FailedSendResult {
  ok: false
  message: string
}

/** 실패 결과인지 판정한다. `ok === false` 이고 사용자 문구가 있어야만 인정한다. */
export function isFailedSendResult(value: unknown): value is FailedSendResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  if (record.ok !== false) return false

  const message = record.message
  return typeof message === 'string' && message.trim() !== ''
}

/** 실패 결과에서 사용자에게 보여줄 문구를 꺼낸다. 실패가 아니면 null. */
export function failedSendNotice(value: unknown): string | null {
  return isFailedSendResult(value) ? value.message : null
}

/** 전송 응답에서 실제로 읽은 값. fetch 결과를 그대로 넘기지 않고 status/본문만 넘긴다. */
export interface ChatSendResponse {
  status: number
  /** `response.json()` 결과. 파싱에 실패했으면 null. */
  body: unknown
}

function readFailureNotice(body: unknown): string | null {
  const contractNotice = failedSendNotice(body)
  if (contractNotice !== null) return contractNotice

  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null

  // 서버가 내려주는 사용자용 문구만 쓴다. error/errorCode 같은 내부 값은 화면에 올리지 않는다.
  // 인증·권한 실패는 `{ success: false, error, message }` 로 오므로 content 와 같은 급으로
  // message 도 읽는다. 여기서 빠뜨리면 로그인/권한 안내가 일반 재시도 문구로 덮인다.
  const record = body as Record<string, unknown>

  for (const key of ['content', 'message'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }

  return null
}

function hasServerFailureMarker(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false

  const record = body as Record<string, unknown>
  if (record.status === 'FAILED' || record.step === 'ERROR') return true

  const errorCode = record.errorCode
  return typeof errorCode === 'string' && errorCode.trim() !== ''
}

/**
 * 에이전트 채팅 응답을 전송 결과로 정규화한다.
 *
 * 서버는 실패를 500 + `{ status: 'FAILED', errorCode, content }` 로 내려주고,
 * 성공 계약(`{ ok: true }`)을 직접 반환하지 않는다. 2xx 만 보고 성공으로 치면
 * 실패가 조용히 사라지므로 확인할 수 없는 응답은 전부 실패로 닫는다(fail-closed).
 */
export function chatSendResultFromResponse({
  status,
  body,
}: ChatSendResponse): ChatSendResult {
  if (isFailedSendResult(body)) {
    return { ok: false, message: body.message }
  }

  const httpOk = Number.isFinite(status) && status >= 200 && status < 300
  const bodyReadable =
    typeof body === 'object' && body !== null && !Array.isArray(body)

  if (!httpOk || !bodyReadable || hasServerFailureMarker(body)) {
    return { ok: false, message: readFailureNotice(body) ?? CHAT_SEND_FAILED_NOTICE }
  }

  return { ok: true }
}
