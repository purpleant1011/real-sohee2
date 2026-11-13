/**
 * 푸시 구독 토큰 수명 표시 계약 (ANI-1724, partial).
 *
 * 이 모듈은 **표시만** 한다. 토큰 발급·등록·회전·폐기는 서버가 소유하며,
 * 여기서는 서버가 준 값을 해석해 사용자에게 정직하게 보여 주는 것까지만 한다.
 * 따라서 이 파일은 DB 쓰기·푸시 발송·서비스 워커 구독 등록을 하지 않는다.
 *
 * 정직성 규칙(fail-closed):
 * - 조회 실패는 '등록 없음'이 아니다. `unknown` 으로 남기고 '받고 있다'로 읽히는 문구를 쓰지 않는다.
 * - 만료 시각이 없거나 해석할 수 없으면 `active` 가 아니라 `unknown` 이다.
 * - 서버가 폐기/만료라고 하면 로컬 계산보다 서버 판정을 먼저 믿는다.
 * - `active` 는 '서버에 유효한 구독이 등록되어 있음'이지 '알림이 실제로 도착했다'가 아니다.
 */

/** 만료 전 미리 알려 주는 기간. 이 안에 들어오면 재등록을 안내한다. */
export const PUSH_TOKEN_EXPIRING_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export type PushTokenStatus =
  | 'unknown'
  | 'not_registered'
  | 'active'
  | 'expiring'
  | 'expired'
  | 'revoked'

/** 서버가 내려주는 구독 행의 표시용 부분집합. 알 수 없는 필드는 무시한다. */
export interface PushTokenRecord {
  status?: unknown
  expiresAt?: unknown
  revokedAt?: unknown
}

/**
 * 조회 결과. `ok: false`(조회 실패)와 `record: null`(서버가 '없음'을 확인)은
 * 화면에서 완전히 다른 뜻이므로 반드시 구분해 넘긴다.
 */
export type PushTokenLookup = { ok: false } | { ok: true; record: PushTokenRecord | null }

const SERVER_STATUS = new Set(['active', 'expired', 'revoked'])

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function resolvePushTokenStatus(input: { lookup: PushTokenLookup; now: number }): PushTokenStatus {
  const { lookup, now } = input
  if (!lookup.ok) return 'unknown'
  const record = lookup.record
  if (record === null) return 'not_registered'

  // 서버가 폐기 시각을 줬다면 만료보다 폐기가 우선한다.
  if (record.revokedAt !== undefined && record.revokedAt !== null) {
    return parseTimestamp(record.revokedAt) === null ? 'unknown' : 'revoked'
  }

  if (record.status !== undefined && record.status !== null) {
    if (typeof record.status !== 'string' || !SERVER_STATUS.has(record.status)) return 'unknown'
    if (record.status === 'revoked') return 'revoked'
    if (record.status === 'expired') return 'expired'
  }

  const expiresAt = parseTimestamp(record.expiresAt)
  // 만료 시각을 확인할 수 없으면 유효하다고 단정하지 않는다.
  if (expiresAt === null) return 'unknown'
  if (expiresAt <= now) return 'expired'
  if (expiresAt - now <= PUSH_TOKEN_EXPIRING_WINDOW_DAYS * DAY_MS) return 'expiring'
  return 'active'
}

export type PushTokenAction = 'renew' | 'retry' | 'enable' | 'none'

export interface PushTokenStatusCopy {
  label: string
  description: string
  action: PushTokenAction
  actionLabel: string | null
}

/**
 * 사용자 문구. 내부 코드·토큰 값·지문은 절대 넣지 않는다.
 * '알림을 받고 있어요' 같은 수신 단정 문구도 쓰지 않는다 — 근거는 서버 등록 상태뿐이다.
 */
export const PUSH_TOKEN_STATUS_COPY: Readonly<Record<PushTokenStatus, PushTokenStatusCopy>> = {
  unknown: {
    label: '확인하지 못했어요',
    description: '알림 발송 준비 상태를 확인하지 못했어요. 알림이 없다는 뜻은 아니에요.',
    action: 'retry',
    actionLabel: '다시 확인',
  },
  not_registered: {
    label: '아직 켜지 않았어요',
    description: '잠금 화면 알림을 받으려면 알림을 켜 주세요.',
    action: 'enable',
    actionLabel: '알림 켜기',
  },
  active: {
    label: '준비됨',
    description: '알림을 보낼 준비가 서버에 등록되어 있어요. 승인·일정 소식만 보내 드려요.',
    action: 'none',
    actionLabel: null,
  },
  expiring: {
    label: '곧 만료돼요',
    description: '알림 연결이 곧 만료돼요. 만료되면 잠금 화면 알림이 오지 않아요.',
    action: 'renew',
    actionLabel: '알림 다시 연결',
  },
  expired: {
    label: '만료됐어요',
    description: '알림 연결이 만료되어 잠금 화면 알림이 오지 않아요.',
    action: 'renew',
    actionLabel: '알림 다시 연결',
  },
  revoked: {
    label: '꺼져 있어요',
    description: '알림 연결이 해제되어 잠금 화면 알림이 오지 않아요.',
    action: 'renew',
    actionLabel: '알림 다시 연결',
  },
}

export function pushTokenStatusCopy(status: PushTokenStatus): PushTokenStatusCopy {
  return PUSH_TOKEN_STATUS_COPY[status]
}
