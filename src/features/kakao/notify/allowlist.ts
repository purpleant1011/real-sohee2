/**
 * 시험 발송용 허용목록 (Allowlist) 게이트
 *
 * KAKAO_OUTBOX_TEST_ALLOWLIST 환경변수를 파싱하여 지정된 010 정규화 번호만
 * 발송을 허용하는 게이트를 제공합니다.
 *
 * [보안 철칙]
 * 1. PII 보호: 번호 목록은 내부 Set/클로저에만 은닉되며, toString/toJSON/로그/에러에 절대 노출되지 않습니다.
 * 2. Fail-Closed: 변수가 설정(비어있지 않음)되었으나 파싱 가능한 유효 010 번호가 0개인 경우 전원 차단(모든 번호 불허).
 * 3. 하위 호환: 변수가 미설정(undefined, null, 또는 trim() === '')인 경우 모든 번호 허용 (enabled: false).
 */

import { normalize010Phone } from './outbox-processor'

export interface OutboxAllowlist {
  readonly enabled: boolean
  isAllowed(normalizedPhone: string): boolean
  toString(): string
  toJSON(): Record<string, unknown>
}

/**
 * 시험 발송용 허용목록 게이트 생성 함수
 *
 * @param raw KAKAO_OUTBOX_TEST_ALLOWLIST 원본 환경변수 문자열
 * @returns OutboxAllowlist 게이트 객체
 */
export function createOutboxAllowlist(raw?: string | null): OutboxAllowlist {
  if (raw === undefined || raw === null) {
    return {
      enabled: false,
      isAllowed: () => true,
      toString: () => '[OutboxAllowlist enabled=false]',
      toJSON: () => ({ enabled: false }),
    }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return {
      enabled: false,
      isAllowed: () => true,
      toString: () => '[OutboxAllowlist enabled=false]',
      toJSON: () => ({ enabled: false }),
    }
  }

  const tokens = trimmed.split(',')
  const allowedSet = new Set<string>()

  for (const token of tokens) {
    const normalized = normalize010Phone(token)
    if (normalized) {
      allowedSet.add(normalized)
    }
  }

  return {
    enabled: true,
    isAllowed(phone: string): boolean {
      if (!phone) return false
      const norm = normalize010Phone(phone) ?? phone
      return allowedSet.has(norm)
    },
    toString: () => '[OutboxAllowlist enabled=true]',
    toJSON: () => ({ enabled: true }),
  }
}
