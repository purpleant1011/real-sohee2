import {
  approvalFingerprint,
  bookingApprovalFingerprint,
  type ApprovalBindingInput,
  type BookingApprovalBindingInput,
} from '@/features/booking-recovery/approval-binding'
import { computeApprovalFingerprint as computeCommentApprovalFingerprint } from '@/features/engagement/draft'
import { computeDmApprovalFingerprint } from '@/features/engagement/dm/options-generator'
import { calculateApprovalFingerprint, type CanonicalApprovalInput } from '@/lib/evidence/approval-fingerprint'

/**
 * 승인 지문 디스패처 (ANI-1704 · W6).
 *
 * 승인 항목 하나에는 지문 하나만 존재한다. 종류별 계산은 이미 있는 정본 함수에
 * 그대로 위임하며, 이 파일은 새 해시 알고리즘·정규화 규칙을 만들지 않는다.
 * 시각·랜덤·클라이언트 값은 입력이 될 수 없다.
 *
 * `mobileApprovalKeySchema`가 허용하는 종류 중 `proposal`은 아직 승인된 지문
 * 정본이 없다(설계 §3.3의 다섯 종류에 포함되지 않음). 따라서 지원 목록에 넣지
 * 않고, 어댑터는 `isMobileApprovalFingerprintKind`로 fail-closed 거절해야 한다.
 */
export const MOBILE_APPROVAL_FINGERPRINT_KINDS = [
  'dm',
  'comment',
  'booking_send',
  'booking_confirm',
  'post',
] as const

export type MobileApprovalFingerprintKind = (typeof MOBILE_APPROVAL_FINGERPRINT_KINDS)[number]

/** 키 스키마에는 존재하지만 승인된 지문 공식이 없는 종류. 추가하지 말 것. */
export const UNSUPPORTED_MOBILE_APPROVAL_FINGERPRINT_KINDS = ['proposal'] as const

export type MobileApprovalFingerprintInput =
  | { kind: 'dm'; workspaceId: string; threadId: string; draftText: string }
  | { kind: 'comment'; workspaceId: string; commentId: string; draftText: string }
  | { kind: 'booking_send'; binding: ApprovalBindingInput }
  | { kind: 'booking_confirm'; binding: BookingApprovalBindingInput }
  | { kind: 'post'; payload: CanonicalApprovalInput }

/**
 * raw `key.kind` 문자열이 지원 종류인지 확인한다.
 * 대소문자를 정규화하지 않는다. 알 수 없는 값은 지원하지 않는 것으로 취급한다(fail-closed).
 */
export function isMobileApprovalFingerprintKind(
  kind: string
): kind is MobileApprovalFingerprintKind {
  return (MOBILE_APPROVAL_FINGERPRINT_KINDS as readonly string[]).includes(kind)
}

/**
 * `key.kind → 기존 지문 함수` 단일 디스패치.
 * 지원하지 않는 종류는 계산하지 않고 실패한다.
 */
export function computeMobileApprovalFingerprint(input: MobileApprovalFingerprintInput): string {
  switch (input.kind) {
    case 'dm':
      return computeDmApprovalFingerprint(input.workspaceId, input.threadId, input.draftText)
    case 'comment':
      return computeCommentApprovalFingerprint(input.workspaceId, input.commentId, input.draftText)
    case 'booking_send':
      return approvalFingerprint(input.binding)
    case 'booking_confirm':
      return bookingApprovalFingerprint(input.binding)
    case 'post':
      return calculateApprovalFingerprint(input.payload)
    default: {
      // 타입으로는 도달할 수 없다. 런타임에서 잘못된 kind가 들어오면
      // 지문을 만들어 내지 않고 즉시 실패한다.
      const unreachable: never = input
      const kind = (unreachable as { kind?: unknown }).kind
      throw new Error(`Unsupported approval fingerprint kind: ${String(kind)}`)
    }
  }
}
