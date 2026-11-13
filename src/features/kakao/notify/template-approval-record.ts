/**
 * 카카오 알림톡 템플릿 심사 승인 원장 레코드 빌더
 *
 * [운영 및 보안 가이드라인]
 * 1. 카카오 승인 확인은 사람이 콘솔에서 직접 수행합니다.
 *    본 모듈은 승인 자동화가 아니며, 운영자가 카카오 비즈메시지 콘솔 및 솔라피 콘솔에서
 *    실제 심사 승인된 사실을 확인한 뒤 kakao_template_approvals 테이블에 안전하게 적재할
 *    데이터 행을 구성하는 순수 함수 빌더입니다.
 * 2. 승인 자동 추정 및 사실 단정 금지:
 *    - APPROVED 상태를 임의로 추정하거나 기본값으로 적용하지 않으며, 운영자가 명시한 state만을 사용합니다.
 *    - 사실 단정 금지: 승인 상태는 카카오 변경(재검수/반려)이 있을 수 있어 주기 재확인이 필요합니다 (기본 유효기간 30일/720시간, KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS로 조정).
 * 3. 무결성 보장:
 *    카탈로그에 등록된 알려진 템플릿 코드만 허용하며, 템플릿 본문의 SHA256 해시를 자동 계산하여 저장합니다.
 * 4. 증거 및 시크릿 노출 방지:
 *    콘솔 스크린샷 ID 또는 확인 메모(evidenceRef)에서 URL 쿼리스트링 및 민감정보(API 키, 토큰, 비밀번호 등)의 유입을 엄격히 차단합니다.
 */

import { createHash } from 'node:crypto'
import { getAlimtalkTemplate } from './templates.ts'

export type TemplateApprovalState = 'APPROVED' | 'REJECTED' | 'PENDING'

export interface BuildTemplateApprovalRecordParams {
  /** 등록된 알림톡 템플릿 코드 (예: SOHEE_BOOKING_CONFIRMED_V1) */
  templateCode: string
  /** 솔라피 콘솔에서 발급된 템플릿 ID */
  templateId: string
  /** 솔라피 카카오 발송 채널 ID */
  channelId: string
  /** 콘솔에서 사람이 확인한 승인 상태 (자동 추정 금지, 필수 지정) */
  state: TemplateApprovalState
  /** 사람이 콘솔에서 승인을 확인한 시각 (ISO 8601 offset 형식, 미래 불가) */
  verifiedAt: string
  /** 사람이 확인한 증거 참조 (스크린샷 ID 또는 운영 메모, 최대 200자, 시크릿·쿼리 불가) */
  evidenceRef: string
  /** 테스트 및 검증용 기준 시각 (선택 주입) */
  now?: Date
}

export interface KakaoTemplateApprovalRow {
  template_code: string
  template_id: string
  channel_id: string
  body_sha256: string
  state: TemplateApprovalState
  verified_at: string
  evidence_ref: string
}

const ALLOWED_STATES: readonly TemplateApprovalState[] = ['APPROVED', 'REJECTED', 'PENDING']

/** ISO 8601 타임존 오프셋 포함 정규식 (Z, +09:00, -05:00 등) */
const ISO_OFFSET_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/

/** URL 쿼리 파라미터 포함 여부 감지 (? 또는 &) */
const URL_QUERY_REGEX = /[?&]/

/** 민감정보 (API 키, 시크릿, 토큰 등) 패턴 감지 */
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passwd|auth|bearer)\s*[:=]/i,
  /\bbearer\s+[^\s]+/i,
  /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/i, // JWT 패턴
  /(?:sk|ghp|xoxb|xoxp)-[a-zA-Z0-9]+/i, // 일반적인 API 토큰 접두사
]

/**
 * 카카오 승인 확인은 사람이 콘솔에서 직접 수행합니다.
 * 사람이 콘솔에서 확인한 승인 사실을 kakao_template_approvals 행 객체로 안전하게 변환하는 순수 함수입니다.
 */
export function buildTemplateApprovalRecord(
  params: BuildTemplateApprovalRecordParams,
): KakaoTemplateApprovalRow {
  // 1. templateCode 검증 (알려진 템플릿 코드만 허용)
  if (!params.templateCode || typeof params.templateCode !== 'string') {
    throw new Error('templateCode is required and must be a string')
  }

  const template = getAlimtalkTemplate(params.templateCode)
  if (!template || !template.templateBody) {
    throw new Error(
      `Unknown template code: "${params.templateCode}". Only known template codes from the catalog are allowed.`,
    )
  }

  // 2. templateId 검증 (nonblank)
  if (
    !params.templateId ||
    typeof params.templateId !== 'string' ||
    params.templateId.trim().length === 0
  ) {
    throw new Error('templateId is required and must be a non-blank string')
  }
  const cleanTemplateId = params.templateId.trim()

  // 3. channelId 검증 (nonblank)
  if (
    !params.channelId ||
    typeof params.channelId !== 'string' ||
    params.channelId.trim().length === 0
  ) {
    throw new Error('channelId is required and must be a non-blank string')
  }
  const cleanChannelId = params.channelId.trim()

  // 4. state 검증 (APPROVED, REJECTED, PENDING 만 허용; 자동 추정 금지)
  if (!ALLOWED_STATES.includes(params.state)) {
    throw new Error(
      `Invalid state: "${params.state}". State must be one of: ${ALLOWED_STATES.join(', ')}.`,
    )
  }

  // 5. verifiedAt 검증 (ISO 8601 offset 필수, 유효한 날짜, 미래 시각 금지)
  if (
    !params.verifiedAt ||
    typeof params.verifiedAt !== 'string' ||
    !ISO_OFFSET_REGEX.test(params.verifiedAt)
  ) {
    throw new Error(
      'verifiedAt must be a valid ISO 8601 string with a timezone offset (e.g. 2026-11-06T10:00:00Z or +09:00).',
    )
  }

  const verifiedDate = new Date(params.verifiedAt)
  const verifiedTimestamp = verifiedDate.getTime()
  if (Number.isNaN(verifiedTimestamp)) {
    throw new Error(`verifiedAt "${params.verifiedAt}" is not a valid date timestamp.`)
  }

  const currentNow = params.now ?? new Date()
  if (verifiedTimestamp > currentNow.getTime()) {
    throw new Error(
      `verifiedAt "${params.verifiedAt}" cannot be in the future (current time: ${currentNow.toISOString()}).`,
    )
  }

  // 6. evidenceRef 검증 (nonblank, 길이 <= 200, URL 쿼리 거부, 시크릿 패턴 거부)
  if (
    !params.evidenceRef ||
    typeof params.evidenceRef !== 'string' ||
    params.evidenceRef.trim().length === 0
  ) {
    throw new Error('evidenceRef is required and must be a non-blank string.')
  }

  const cleanEvidenceRef = params.evidenceRef.trim()
  if (cleanEvidenceRef.length > 200) {
    throw new Error(
      `evidenceRef exceeds maximum allowed length of 200 characters (actual: ${cleanEvidenceRef.length}).`,
    )
  }

  if (URL_QUERY_REGEX.test(cleanEvidenceRef)) {
    throw new Error(
      'evidenceRef must not contain URL query strings ("?" or "&") to prevent accidental token exposure.',
    )
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(cleanEvidenceRef)) {
      throw new Error(
        'evidenceRef must not contain sensitive patterns such as API keys, tokens, or passwords.',
      )
    }
  }

  // 7. templateBody sha256 계산
  const bodySha256 = createHash('sha256')
    .update(template.templateBody)
    .digest('hex')

  return {
    template_code: template.code,
    template_id: cleanTemplateId,
    channel_id: cleanChannelId,
    body_sha256: bodySha256,
    state: params.state,
    verified_at: params.verifiedAt,
    evidence_ref: cleanEvidenceRef,
  }
}
