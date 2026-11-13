/**
 * 솔라피 알림톡 Outbox 발송기 (Solapi Outbox Sender Port Implementation)
 *
 * [보안 및 규약 원칙]
 * 1. PII 및 시크릿 은닉: 반환 객체 및 에러에 전화번호, 템플릿 본문, 프로바이더 에러 원문, 시크릿 키 노출 영구 차단.
 * 2. Fail-Closed 원칙: adapter disabled 또는 필수 키/승인 불일치/누락 변수 시 발송을 안전하게 차단(send 0).
 * 3. 멱등키 규약: 'kakao-outbox:' + job.id (UUID 정규식 검증 필수).
 * 4. 템플릿 매핑: templates.ts 카탈로그 기반 한글 변수 엄격 매핑.
 *    - 고객명은 '고객님' 가짜 default 배제하고 payload.customerName 필수 검증.
 *    - 결제안내는 금액 여부와 무관하게 PAID 추정 금지, 미확정 시 '결제 확인 전' 명시.
 *    - 예약 변경 시 이전일시/변경일시 필수 검증(부재 시 block).
 *    - 예약 취소 시 환불안내 부재 시 '매장에 확인해 주세요'로 불확실성 표현 (완료 단정 금지).
 */

import {
  ALIMTALK_TEMPLATE_CODES,
  getAlimtalkTemplate,
} from './templates'
import { formatKstDateTime } from './format-kst'
import {
  createAlimtalkAdapterFromEnv,
  type SolapiEnv,
  type SolapiFactoryDeps,
} from './solapi-factory'
import type { SolapiSendResult } from './solapi-adapter'
import type {
  Job,
  NotificationEvent,
  ReservationSnapshot,
  SendFn,
} from './outbox-processor'
import type { AlimtalkSendRequest } from './alimtalk-contract'

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EVENT_TEMPLATE_CODE_MAP: Record<NotificationEvent, string> = {
  BOOKING_CONFIRMED: ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED,
  BOOKING_CHANGED: ALIMTALK_TEMPLATE_CODES.BOOKING_CHANGED,
  BOOKING_CANCELLED: ALIMTALK_TEMPLATE_CODES.BOOKING_CANCELLED,
  REMINDER_24H: ALIMTALK_TEMPLATE_CODES.REMINDER_24H,
  REMINDER_2H: ALIMTALK_TEMPLATE_CODES.REMINDER_2H,
  PAYMENT_CONFIRMED: ALIMTALK_TEMPLATE_CODES.PAYMENT_CONFIRMED,
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
      if (typeof v === 'string' && v.trim()) {
        result[k] = v.trim()
      }
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 환경변수 및 주입 종속성을 기반으로 Outbox Processor에 주입할 SendFn 생성
 */
export function createSolapiOutboxSender(
  env: SolapiEnv,
  deps?: SolapiFactoryDeps,
): SendFn {
  const adapter = createAlimtalkAdapterFromEnv(env, deps)
  const templateIdMap = parseTemplateIdMap(env?.SOLAPI_TEMPLATE_IDS)

  return async (
    snapshot: ReservationSnapshot,
    job: Job,
    templateId: string,
  ): Promise<{ accepted: boolean; notSent?: boolean; failureCode?: string }> => {
    // 1. Adapter 킬스위치 및 비활성화 여부 검증 (외부 호출 0건)
    if (!adapter.enabled) {
      return { accepted: false, notSent: true }
    }

    // 2. Job ID UUID 정규식 검증 (DLR 규약 동일 준수)
    if (!job.id || !UUID_REGEX.test(job.id.trim())) {
      return { accepted: false, notSent: true }
    }

    // 3. Workspace 및 Reservation 식별자 일치 검증
    if (
      snapshot.workspaceId !== job.workspaceId ||
      snapshot.reservationId !== job.reservationId
    ) {
      return { accepted: false, notSent: true }
    }

    // 4. 이벤트 템플릿 코드 매핑 검증
    const templateCode = EVENT_TEMPLATE_CODE_MAP[job.event]
    if (!templateCode) {
      return { accepted: false, notSent: true }
    }

    // 5. Approved templateId 및 env 매핑 값 일치 검증
    const configuredTemplateId = Object.prototype.hasOwnProperty.call(
      templateIdMap,
      templateCode,
    )
      ? templateIdMap[templateCode]
      : undefined

    if (!configuredTemplateId || configuredTemplateId !== templateId) {
      return { accepted: false, notSent: true }
    }

    const template = getAlimtalkTemplate(templateCode)
    if (!template) {
      return { accepted: false, notSent: true }
    }

    // 6. 변수 빌드 및 필수값 엄격 검증
    const payload = snapshot.payload ?? {}

    const customerName =
      typeof payload.customerName === 'string' ? payload.customerName.trim() : ''
    if (!customerName) {
      // 가짜 default ('고객님') 절대 배제
      return { accepted: false, notSent: true }
    }

    const shopName =
      typeof payload.shopName === 'string' ? payload.shopName.trim() : ''
    if (!shopName) {
      return { accepted: false, notSent: true }
    }

    const serviceName =
      typeof payload.serviceName === 'string' ? payload.serviceName.trim() : ''
    if (!serviceName) {
      return { accepted: false, notSent: true }
    }

    const locationText =
      typeof payload.locationText === 'string' ? payload.locationText.trim() : ''

    const variables: Record<string, string> = {
      매장명: shopName,
      고객명: customerName,
      서비스명: serviceName,
    }

    if (job.event === 'BOOKING_CONFIRMED') {
      const bookingStartsAt =
        typeof payload.bookingStartsAt === 'string'
          ? payload.bookingStartsAt.trim()
          : ''
      if (!bookingStartsAt || !locationText) {
        return { accepted: false, notSent: true }
      }

      const formattedStartsAt = formatKstDateTime(bookingStartsAt)
      if (!formattedStartsAt) {
        return { accepted: false, notSent: true }
      }

      // 결제안내: 금액이 있어도 PAID 추정 금지, 미확정이면 '결제 확인 전' 명시
      const paymentInfo =
        typeof payload.paymentInfo === 'string' && payload.paymentInfo.trim()
          ? payload.paymentInfo.trim()
          : '결제 확인 전'

      variables.예약일시 = formattedStartsAt
      variables.매장위치 = locationText
      variables.결제안내 = paymentInfo
    } else if (job.event === 'BOOKING_CHANGED') {
      const previousStartsAt =
        typeof payload.previousStartsAt === 'string'
          ? payload.previousStartsAt.trim()
          : ''
      const bookingStartsAt =
        typeof payload.bookingStartsAt === 'string'
          ? payload.bookingStartsAt.trim()
          : ''

      // 변경 시 이전일시와 변경일시 둘 다 없으면 block
      if (!previousStartsAt || !bookingStartsAt || !locationText) {
        return { accepted: false, notSent: true }
      }

      // 이전일시와 변경일시가 동일하면(slot_id만 변경 등) 고객에게 이전=변경 오해 안내 방지를 위해 사전 차단
      if (previousStartsAt.trim() === bookingStartsAt.trim()) {
        return { accepted: false, notSent: true }
      }

      const formattedPreviousStartsAt = formatKstDateTime(previousStartsAt)
      const formattedBookingStartsAt = formatKstDateTime(bookingStartsAt)
      if (!formattedPreviousStartsAt || !formattedBookingStartsAt) {
        return { accepted: false, notSent: true }
      }

      variables.이전예약일시 = formattedPreviousStartsAt
      variables.변경예약일시 = formattedBookingStartsAt
      variables.매장위치 = locationText
    } else if (job.event === 'BOOKING_CANCELLED') {
      // 거절된 예약 신청은 신청 단계였으므로 고객에게 취소 안내 알림톡을 발송하지 않고 안전하게 차단
      if (payload.requestDeclined === true) {
        return { accepted: false, notSent: true }
      }

      const bookingStartsAt =
        typeof payload.bookingStartsAt === 'string'
          ? payload.bookingStartsAt.trim()
          : ''
      const cancelReason =
        typeof payload.cancelReason === 'string'
          ? payload.cancelReason.trim()
          : ''

      if (!bookingStartsAt || !cancelReason) {
        return { accepted: false, notSent: true }
      }

      const formattedStartsAt = formatKstDateTime(bookingStartsAt)
      if (!formattedStartsAt) {
        return { accepted: false, notSent: true }
      }

      // 취소 환불 안내 없으면 '매장에 확인해 주세요'로 불확실성 표현 (완료 단정 금지)
      const refundInfo =
        typeof payload.refundInfo === 'string' && payload.refundInfo.trim()
          ? payload.refundInfo.trim()
          : '매장에 확인해 주세요'

      variables.예약일시 = formattedStartsAt
      variables.취소사유 = cancelReason
      variables.환불안내 = refundInfo
    } else if (job.event === 'REMINDER_24H' || job.event === 'REMINDER_2H') {
      const bookingStartsAt =
        typeof payload.bookingStartsAt === 'string'
          ? payload.bookingStartsAt.trim()
          : ''
      if (!bookingStartsAt || !locationText) {
        return { accepted: false, notSent: true }
      }

      const formattedStartsAt = formatKstDateTime(bookingStartsAt)
      if (!formattedStartsAt) {
        return { accepted: false, notSent: true }
      }

      const noticePoint = job.event === 'REMINDER_24H' ? '내일' : '2시간 뒤'

      variables.안내시점 = noticePoint
      variables.예약일시 = formattedStartsAt
      variables.매장위치 = locationText
    } else if (job.event === 'PAYMENT_CONFIRMED') {
      const bookingStartsAt =
        typeof payload.bookingStartsAt === 'string'
          ? payload.bookingStartsAt.trim()
          : ''
      if (!bookingStartsAt) {
        return { accepted: false, notSent: true }
      }

      const formattedStartsAt = formatKstDateTime(bookingStartsAt)
      if (!formattedStartsAt) {
        return { accepted: false, notSent: true }
      }

      // 결제금액: payment_captures 에서 읽어온 payload.paymentAmountKrw 검증
      // 금액이 없거나 0 이하이면 notSent: true (deposit_krw 만 보고 절대 발송 금지)
      const rawAmount = payload.paymentAmountKrw
      if (
        typeof rawAmount !== 'number' ||
        !Number.isFinite(rawAmount) ||
        rawAmount <= 0
      ) {
        return { accepted: false, notSent: true }
      }

      const formattedAmount = `${Math.floor(rawAmount).toLocaleString('ko-KR')}원`

      variables.예약일시 = formattedStartsAt
      variables.결제금액 = formattedAmount
    }

    // 7. 멱등키 생성 및 어댑터 발송 위임
    const idempotencyKey = `kakao-outbox:${job.id.trim()}`

    const sendRequest: AlimtalkSendRequest = {
      idempotencyKey,
      recipientPhone: snapshot.phone,
      templateCode,
      templateBody: template.templateBody,
      variables,
      consent: 'informational',
      workspaceId: job.workspaceId,
      bookingId: job.reservationId,
      event: job.event,
    }

    try {
      const sendResult = (await adapter.send(sendRequest)) as SolapiSendResult

      // accepted=true iff status === 'SENT' && success === true
      if (sendResult.success === true && sendResult.status === 'SENT') {
        return { accepted: true }
      }

      return {
        accepted: false,
        failureCode: sendResult.errorCode,
      }
    } catch {
      // PII 및 프로바이더 텍스트 노출 차단
      return { accepted: false, failureCode: 'NETWORK_EXCEPTION' }
    }
  }
}
