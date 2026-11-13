/**
 * 알림톡 Outbox 정책 리더 어댑터 (Outbox Policy Readers)
 *
 * [보안 및 규정 준수 철칙]
 * 1. PII 보호 및 전화번호 격리:
 *    - subject_phone_sha256의 SHA256 해시는 KISA/개인정보보호법상 익명화(anonymization)가 아니며,
 *      원장 조회 시 교차 테넌트 오발송 및 타인 번호 결합을 차단하기 위한 권한 격리 보조(authorization isolation auxiliary) 목적입니다.
 *    - 에러 메시지나 반환 객체에 raw 전화번호, 고객명, 시스템 내부 덤프가 노출되지 않도록 정적 오류로 캡슐화합니다.
 * 2. Fail-Closed 원칙:
 *    - 전화번호 정규화 실패, 해시 불일치, 목적(purpose) 불일치, 미래 타임스탬프, 철회(revoked_at),
 *      증거 참조값(evidence_ref) 부재 시 즉시 거부(null 반환)합니다.
 *    - customer_opt_outs에 행이 없다는 사실(부재)은 동의(grant)의 근거가 될 수 없습니다. 반드시 명시적 evidence가 존재해야 합니다.
 * 3. 템플릿 심사 승인 원칙:
 *    - kakao_template_approvals 테이블에 행이 존재한다는 사실 자체만으로 승인된 것이 아닙니다.
 *    - 카카오/솔라피 콘솔 및 API 증거(evidence_ref)를 운영자가 사전 검증하여 기록해야 합니다.
 *    - 승인 상태는 카카오 변경(재검수/반려)이 있을 수 있어 주기 재확인이 필요합니다.
 *    - 기본 유효기간은 30일(720시간)이며, env.KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS(1~2160시간)로 조정할 수 있습니다.
 *      유효기간 이내의 최신 검증(verified_at) 건에 한해서만 approved: true를 반환합니다.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeKrPhone } from './alimtalk-contract'
import {
  type InformationalEvidence,
  type NotificationEvent,
  type TemplateApproval,
  normalize010Phone,
} from './outbox-processor'
import type {
  InformationalEvidenceQuery,
  InformationalEvidenceReaderFn,
  TemplateApprovalReaderFn,
} from './outbox-repository'
import type { SolapiEnv } from './solapi-factory'
import {
  ALIMTALK_TEMPLATE_CODES,
  ALIMTALK_TEMPLATES,
  type AlimtalkTemplateCodeKey,
} from './templates'

interface EvidenceDbRow {
  workspace_id: string
  reservation_id: string
  subject_phone_sha256: string
  purpose: string
  granted_at: string
  revoked_at: string | null
  evidence_ref: string
}

interface ReservationDbRow {
  id: string
  workspace_id: string
  customer_id?: string | null
}

interface CustomerOptOutDbRow {
  id: string
  workspace_id: string
  customer_id?: string | null
  phone_sha256?: string | null
}

interface TemplateApprovalDbRow {
  template_code: string
  template_id: string
  channel_id: string
  body_sha256: string
  state: string
  verified_at: string
  evidence_ref: string
}

const EVENT_TO_TEMPLATE_KEY: Record<NotificationEvent, AlimtalkTemplateCodeKey> = {
  BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
  BOOKING_CHANGED: 'BOOKING_CHANGED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  REMINDER_24H: 'REMINDER_24H',
  REMINDER_2H: 'REMINDER_2H',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
}

function parseTemplateIdMap(jsonStr?: string): Record<string, string> {
  if (!jsonStr) return {}
  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        Object.prototype.hasOwnProperty.call(parsed, k) &&
        k !== '__proto__' &&
        k !== 'constructor' &&
        k !== 'prototype' &&
        typeof v === 'string' &&
        v.trim()
      ) {
        result[k] = v.trim()
      }
    }
    return result
  } catch {
    return {}
  }
}

function calculateSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

const DEFAULT_TEMPLATE_APPROVAL_MAX_AGE_HOURS = 720 // 기본 30일
const MIN_TEMPLATE_APPROVAL_MAX_AGE_HOURS = 1
const MAX_TEMPLATE_APPROVAL_MAX_AGE_HOURS = 2160 // 최대 90일
const ONE_HOUR_MS = 60 * 60 * 1000

function parseTemplateApprovalMaxAgeHours(rawVal?: string): number {
  if (rawVal === undefined || rawVal === null) {
    return DEFAULT_TEMPLATE_APPROVAL_MAX_AGE_HOURS
  }
  const trimmed = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal).trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return DEFAULT_TEMPLATE_APPROVAL_MAX_AGE_HOURS
  }
  const num = Number(trimmed)
  if (!Number.isSafeInteger(num) || num < MIN_TEMPLATE_APPROVAL_MAX_AGE_HOURS || num > MAX_TEMPLATE_APPROVAL_MAX_AGE_HOURS) {
    return DEFAULT_TEMPLATE_APPROVAL_MAX_AGE_HOURS
  }
  return num
}

export interface OutboxPolicyReaders {
  evidenceReader: InformationalEvidenceReaderFn
  templateApprovalReader: TemplateApprovalReaderFn
}

/**
 * 알림톡 Outbox 정책 리더 팩토리 함수
 *
 * @param client Supabase 클라이언트 ({ from } 최소 인터페이스)
 * @param env Solapi 환경변수
 * @param now 현재 시각 공급 함수 (테스트 주입용)
 */
export function createOutboxPolicyReaders(
  client: Pick<SupabaseClient, 'from'>,
  env: SolapiEnv,
  now?: () => Date,
): OutboxPolicyReaders {
  const getNow = now ?? (() => new Date())

  // 1. 정보성 메시지 수신 근거 리더 (InformationalEvidenceReaderFn)
  const evidenceReader: InformationalEvidenceReaderFn = async (
    query: InformationalEvidenceQuery,
  ): Promise<InformationalEvidence | null> => {
    const wsId = (query.workspaceId || '').trim()
    const resId = (query.reservationId || '').trim()
    const rawPhone = (query.phone || '').trim()

    if (!wsId || !resId || !rawPhone) {
      return null
    }

    // 010 국내 휴대폰 번호 정규화 (+8210...)
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeKrPhone(rawPhone)
    } catch {
      return null
    }

    // 주의: SHA256은 익명화(anonymization)가 아니고 권한 격리 보조(authorization isolation auxiliary) 목적입니다.
    const phoneSha256 = calculateSha256(normalizedPhone)
    const currentTime = getNow()
    const currentTimeMs = currentTime.getTime()

    try {
      type EvidenceFilterBuilder = {
        eq(col: string, val: unknown): EvidenceFilterBuilder
        is(col: string, val: unknown): EvidenceFilterBuilder
        maybeSingle(): PromiseLike<{ data: EvidenceDbRow | null; error: unknown }>
      }
      type EvidenceQueryBuilder = {
        select(cols: string): EvidenceFilterBuilder
      }

      const evidenceQb = client.from('kakao_notification_evidence') as unknown as EvidenceQueryBuilder
      const evidenceRes = await evidenceQb
        .select('workspace_id, reservation_id, subject_phone_sha256, purpose, granted_at, revoked_at, evidence_ref')
        .eq('workspace_id', wsId)
        .eq('reservation_id', resId)
        .eq('subject_phone_sha256', phoneSha256)
        .eq('purpose', 'INFO')
        .is('revoked_at', null)
        .maybeSingle()

      if (evidenceRes.error) {
        throw new Error('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
      }

      const evidenceRow = evidenceRes.data
      if (!evidenceRow) {
        return null
      }

      // 무결성 및 엄격 조건 검증
      if (evidenceRow.purpose !== 'INFO') {
        return null
      }

      if (evidenceRow.subject_phone_sha256 !== phoneSha256) {
        return null
      }

      if (evidenceRow.revoked_at !== null) {
        return null
      }

      if (!evidenceRow.evidence_ref || !evidenceRow.evidence_ref.trim()) {
        return null
      }

      const grantedAtMs = new Date(evidenceRow.granted_at).getTime()
      if (Number.isNaN(grantedAtMs) || grantedAtMs > currentTimeMs) {
        // 미래 타임스탬프 거부
        return null
      }

      // 예약 존재 및 고객 ID 조회
      type ReservationQueryBuilder = {
        select(cols: string): {
          eq(col1: string, val1: unknown): {
            eq(col2: string, val2: unknown): {
              maybeSingle(): PromiseLike<{ data: ReservationDbRow | null; error: unknown }>
            }
          }
        }
      }

      const resQb = client.from('reservations') as unknown as ReservationQueryBuilder
      const reservationRes = await resQb
        .select('id, workspace_id, customer_id')
        .eq('workspace_id', wsId)
        .eq('id', resId)
        .maybeSingle()

      if (reservationRes.error) {
        throw new Error('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
      }

      const reservationRow = reservationRes.data
      if (!reservationRow) {
        return null
      }

      // customer_opt_outs 조회: 수신 거부(opt-out) 확인
      // [주의] customer_opt_outs에 없음은 grant 근거 아님 (증거가 존재해야 하고, opt-out 행이 있으면 override 거부)
      // 1) customer_id 기준 조회
      if (reservationRow.customer_id) {
        type OptOutQueryBuilder = {
          select(cols: string): {
            eq(col1: string, val1: unknown): {
              eq(col2: string, val2: unknown): {
                maybeSingle(): PromiseLike<{ data: CustomerOptOutDbRow | null; error: unknown }>
              }
            }
          }
        }

        const optOutQb = client.from('customer_opt_outs') as unknown as OptOutQueryBuilder
        const optOutRes = await optOutQb
          .select('id, workspace_id, customer_id')
          .eq('workspace_id', wsId)
          .eq('customer_id', reservationRow.customer_id)
          .maybeSingle()

        if (optOutRes.error) {
          throw new Error('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
        }

        if (optOutRes.data) {
          // 수신 거부 행 존재 -> 거부
          return null
        }
      }

      // 2) phone_sha256 기준 조회 (둘 중 하나라도 거부면 거부, 조회 오류 시 fail-closed)
      type PhoneOptOutQueryBuilder = {
        select(cols: string): {
          eq(col1: string, val1: unknown): {
            eq(col2: string, val2: unknown): {
              maybeSingle(): PromiseLike<{ data: CustomerOptOutDbRow | null; error: unknown }>
            }
          }
        }
      }

      const phoneOptOutQb = client.from('customer_opt_outs') as unknown as PhoneOptOutQueryBuilder
      const phoneOptOutRes = await phoneOptOutQb
        .select('id, workspace_id, phone_sha256')
        .eq('workspace_id', wsId)
        .eq('phone_sha256', phoneSha256)
        .maybeSingle()

      if (phoneOptOutRes.error) {
        throw new Error('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
      }

      if (phoneOptOutRes.data) {
        // 전화번호 해시 기준 수신 거부 행 존재 -> 거부
        return null
      }

      // query.phone 원문 대신 정규화된 010 형태(11자리) 반환 (processor normalize010Phone 호환 및 원문 번호 노출 차단)
      const subjectPhone = normalize010Phone(rawPhone) ?? (
        normalizedPhone.startsWith('+8210')
          ? `010${normalizedPhone.slice(5)}`
          : normalizedPhone.replace(/^\+82/, '0')
      )

      return {
        granted: true,
        subjectPhone,
        workspaceId: wsId,
        reservationId: resId,
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'FAILED_TO_READ_INFORMATIONAL_EVIDENCE') {
        throw err
      }
      throw new Error('FAILED_TO_READ_INFORMATIONAL_EVIDENCE')
    }
  }

  // 2. 템플릿 사전 심사 승인 리더 (TemplateApprovalReaderFn)
  const templateApprovalReader: TemplateApprovalReaderFn = async (
    event: NotificationEvent,
  ): Promise<TemplateApproval | null> => {
    // known outbox event 명시적 매핑 및 검증 (임의 캐스팅 차단)
    const templateCodeKey = Object.prototype.hasOwnProperty.call(EVENT_TO_TEMPLATE_KEY, event)
      ? EVENT_TO_TEMPLATE_KEY[event]
      : undefined
    if (!templateCodeKey) {
      return null
    }

    const templateCode = ALIMTALK_TEMPLATE_CODES[templateCodeKey]
    if (!templateCode) {
      return null
    }

    const localTemplate = ALIMTALK_TEMPLATES[templateCodeKey]
    if (!localTemplate || !localTemplate.templateBody) {
      return null
    }

    const localBodySha256 = calculateSha256(localTemplate.templateBody)

    // env 환경변수 매핑 검증
    const channelId = (env.SOLAPI_PF_ID || '').trim()
    if (!channelId) {
      return null
    }

    // templateIdMap 안전 파싱 (배열/null/비문자열/공백/프로토타입 키 제외)
    const templateIdMap = parseTemplateIdMap(env.SOLAPI_TEMPLATE_IDS)
    const expectedTemplateId = (templateIdMap[templateCode] || '').trim()
    if (!expectedTemplateId) {
      return null
    }

    const currentTime = getNow()
    const currentTimeMs = currentTime.getTime()

    try {
      // 주의: 콘솔/API 증거를 나중에 검증 후 저장해야 함; 테이블 존재 = 승인 아님
      type ApprovalQueryBuilder = {
        select(cols: string): {
          eq(col1: string, val1: unknown): {
            maybeSingle(): PromiseLike<{ data: TemplateApprovalDbRow | null; error: unknown }>
          }
        }
      }

      const approvalQb = client.from('kakao_template_approvals') as unknown as ApprovalQueryBuilder
      const approvalRes = await approvalQb
        .select('template_code, template_id, channel_id, body_sha256, state, verified_at, evidence_ref')
        .eq('template_code', templateCode)
        .maybeSingle()

      if (approvalRes.error) {
        throw new Error('FAILED_TO_READ_TEMPLATE_APPROVAL')
      }

      const approvalRow = approvalRes.data
      if (!approvalRow) {
        return null
      }

      // 무결성 및 엄격 승인 조건 검증
      if (approvalRow.state !== 'APPROVED') {
        return null
      }

      if (approvalRow.template_id !== expectedTemplateId) {
        return null
      }

      if (approvalRow.channel_id !== channelId) {
        return null
      }

      if (approvalRow.body_sha256 !== localBodySha256) {
        return null
      }

      if (!approvalRow.evidence_ref || !approvalRow.evidence_ref.trim()) {
        return null
      }

      const verifiedAtMs = new Date(approvalRow.verified_at).getTime()
      if (Number.isNaN(verifiedAtMs) || verifiedAtMs > currentTimeMs) {
        // 미래 타임스탬프 거부
        return null
      }

      // 사실 단정 금지: 승인 상태는 카카오 변경(재검수/반려)이 있을 수 있어 주기 재확인 필요.
      // 기본 유효기간 30일(720시간), env.KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS(1~2160시간)로 조정
      const maxAgeHours = parseTemplateApprovalMaxAgeHours(env.KAKAO_TEMPLATE_APPROVAL_MAX_AGE_HOURS)
      const maxAgeMs = maxAgeHours * ONE_HOUR_MS
      if (currentTimeMs - verifiedAtMs > maxAgeMs) {
        return null
      }

      return {
        approved: true,
        templateId: approvalRow.template_id,
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'FAILED_TO_READ_TEMPLATE_APPROVAL') {
        throw err
      }
      throw new Error('FAILED_TO_READ_TEMPLATE_APPROVAL')
    }
  }

  return {
    evidenceReader,
    templateApprovalReader,
  }
}
