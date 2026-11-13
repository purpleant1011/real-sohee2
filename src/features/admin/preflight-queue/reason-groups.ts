import type { PreflightCode } from '@/features/vault/preflight'

/** 재검사 항목 id -> 운영자 큐 사유 그룹. 매핑에 없는 항목은 UNCLASSIFIED로 남겨 누락을 막는다(fail-closed). */
export const REASON_GROUP_IDS = [
  'FINGERPRINT_MISMATCH', 'CONTENT_EXPIRED', 'HOLD_OVER_14D', 'RIGHTS_QC_EXPIRED',
  'CONNECTION_LOST', 'ACCOUNT_CHANGED', 'POLICY_CHANGED',
] as const
export type ReasonGroupId = typeof REASON_GROUP_IDS[number] | 'UNCLASSIFIED'

export const CHECK_TO_REASON_GROUP: Readonly<Record<PreflightCode, ReasonGroupId>> = {
  FINGERPRINT: 'FINGERPRINT_MISMATCH',
  CONTENT_EXPIRY: 'CONTENT_EXPIRED',
  HOLD_AGE: 'HOLD_OVER_14D',
  IMAGE_RIGHTS: 'RIGHTS_QC_EXPIRED',
  IMAGE_QC: 'RIGHTS_QC_EXPIRED',
  CONNECTION: 'CONNECTION_LOST',
  ACCOUNT: 'ACCOUNT_CHANGED',
  POLICY: 'POLICY_CHANGED',
}

export const REASON_GROUP_LABEL: Readonly<Record<ReasonGroupId, string>> = {
  FINGERPRINT_MISMATCH: '승인한 내용과 달라짐',
  CONTENT_EXPIRED: '문구 유효기간 만료',
  HOLD_OVER_14D: '보관 14일 초과',
  RIGHTS_QC_EXPIRED: '이미지 권리·품질 확인 만료',
  CONNECTION_LOST: '채널 연결 끊김',
  ACCOUNT_CHANGED: '연결 계정 변경',
  POLICY_CHANGED: '정책 변경',
  UNCLASSIFIED: '분류되지 않은 사유',
}

export function reasonGroupOf(code: unknown): ReasonGroupId {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CHECK_TO_REASON_GROUP, code)
    ? CHECK_TO_REASON_GROUP[code as PreflightCode] : 'UNCLASSIFIED'
}
