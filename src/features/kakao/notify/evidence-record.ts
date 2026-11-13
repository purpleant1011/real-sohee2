/**
 * 알림톡 정보성 알림 수신 근거 원장 적재 빌더 (Owner Attested Evidence Record)
 *
 * [보안 및 규정 준수 철칙]
 * 1. PII 보호 및 전화번호 격리:
 *    - 원장 조회 시 교차 테넌트 오발송 및 타인 번호 결합을 차단하기 위한 권한 격리 보조 목적입니다.
 *    - 원문 전화번호, 고객명, 식별자는 row 필드나 evidence_ref 내부에 절대 포함되지 않습니다.
 * 2. Fail-Closed 원칙:
 *    - 체크박스 미동의(attested !== true), 전화번호 부재/정규화 실패, 빈 식별자, 유효하지 않은 시각,
 *      증거 참조값 길이 초과 시 즉시 null을 반환합니다.
 */

import { createHash } from 'node:crypto'
import { normalizeKrPhone } from './alimtalk-contract'

export interface OwnerAttestedEvidenceRow {
  workspace_id: string
  reservation_id: string
  subject_phone_sha256: string
  purpose: 'INFO'
  granted_at: string
  evidence_ref: string
}

export interface BuildOwnerAttestedEvidenceRowInput {
  workspaceId: string
  reservationId: string
  phone: string | null | undefined
  actorUserId: string
  attested: boolean
  recordedAt: Date
}

const MAX_EVIDENCE_REF_LENGTH = 500

/**
 * 점주 확인/동의 기반의 정보성 알림 발송 근거 DB Row 생성
 *
 * @param input 점주 확인 근거 입력값
 * @returns kakao_notification_evidence 적재용 객체 또는 검증 실패 시 null
 */
export function buildOwnerAttestedEvidenceRow(input: {
  workspaceId: string
  reservationId: string
  phone: string | null | undefined
  actorUserId: string
  attested: boolean
  recordedAt: Date
}): OwnerAttestedEvidenceRow | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  // 1. 점주 확인 동의 여부 엄격 검증
  if (input.attested !== true) {
    return null
  }

  // 2. 식별자 blank 검증
  const wsId = typeof input.workspaceId === 'string' ? input.workspaceId.trim() : ''
  const resId = typeof input.reservationId === 'string' ? input.reservationId.trim() : ''
  const actorId = typeof input.actorUserId === 'string' ? input.actorUserId.trim() : ''

  if (!wsId || !resId || !actorId) {
    return null
  }

  // 3. 기록 시각 검증
  if (!(input.recordedAt instanceof Date) || Number.isNaN(input.recordedAt.getTime())) {
    return null
  }

  // 4. 전화번호 유효성 및 010 국내 E.164 정규화 검증
  const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : ''
  if (!rawPhone) {
    return null
  }

  let normalizedPhone: string
  try {
    normalizedPhone = normalizeKrPhone(rawPhone)
  } catch {
    return null
  }

  // 5. SHA256 해시 생성 (outbox-policy-readers.ts calculateSha256 규격과 완전 동일)
  const subject_phone_sha256 = createHash('sha256').update(normalizedPhone).digest('hex')
  const granted_at = input.recordedAt.toISOString()

  // 6. 증거 참조값(evidence_ref) 직렬화 및 길이 상한(500자) 검증 (원문 번호/이름 제외)
  const evidence_ref = JSON.stringify({
    kind: 'OWNER_RECORDED_EVIDENCE',
    source: 'OWNER_ATTESTED_CHECKBOX',
    version: 'v1',
    workspace_id: wsId,
    reservation_id: resId,
    actor_id: actorId,
    recorded_at: granted_at,
  })

  if (evidence_ref.length > MAX_EVIDENCE_REF_LENGTH) {
    return null
  }

  return {
    workspace_id: wsId,
    reservation_id: resId,
    subject_phone_sha256,
    purpose: 'INFO' as const,
    granted_at,
    evidence_ref,
  }
}
