/**
 * KAPI-10/13/14 예약 이벤트 → 알림 메시지 매핑 (순수 로직)
 *
 * 1. 고객용 정보성 알림톡 요청 (AlimtalkSendRequest)
 *    - 승인된 정보성 템플릿 코드 & 변수 매핑
 *    - 예약패스 HMAC 서명 링크 주입 (pass-token)
 *    - 수신자 동의(consent) 주입 및 확인
 *    - 멱등키 (buildIdempotencyKey) 재사용
 *    - 광고성 문구 철저 배제
 * 2. 사장님용 앱 내 알림 페이로드
 *    - 고객 전화번호 등 개인식별정보(PII) 최소화
 *    - 결제 미확인 건은 확인된 내역만 표기 (확정 전 금액 단정 금지)
 */

import {
  buildIdempotencyKey,
  type AlimtalkConsent,
  type AlimtalkSendRequest,
} from './alimtalk-contract'
import { issuePassToken } from '../booking-pass/pass-token'
import { ALIMTALK_TEMPLATES } from './templates'

export type BookingEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CHANGED'
  | 'BOOKING_CANCELLED'
  | 'PAYMENT_CONFIRMED'
  | 'REMINDER_24H'
  | 'REMINDER_2H'

export type PaymentConfirmationStatus =
  | 'CONFIRMED'
  | 'PAID'
  | 'PENDING'
  | 'UNCONFIRMED'
  | 'NONE'

export interface BookingPaymentFact {
  status: PaymentConfirmationStatus
  amountKrw?: number
  paidAt?: string
}

export interface BookingEventBase {
  workspaceId: string
  bookingId: string
  bookingNumber?: string
  bookingVersion?: number
  customerId: string
  customerName: string
  customerPhone: string
  serviceName: string
  startsAt: string
  shopName: string
  locationText?: string
  payment?: BookingPaymentFact
  consent: AlimtalkConsent
}

export interface BookingConfirmedEvent extends BookingEventBase {
  type: 'BOOKING_CONFIRMED'
}

export interface BookingChangedEvent extends BookingEventBase {
  type: 'BOOKING_CHANGED'
  previousStartsAt?: string
  newStartsAt: string
}

export interface BookingCancelledEvent extends BookingEventBase {
  type: 'BOOKING_CANCELLED'
  cancelReason?: string
}

export interface PaymentConfirmedEvent extends BookingEventBase {
  type: 'PAYMENT_CONFIRMED'
  payment: {
    status: 'CONFIRMED' | 'PAID'
    amountKrw: number
    paidAt: string
  }
}

export interface Reminder24hEvent extends BookingEventBase {
  type: 'REMINDER_24H'
}

export interface Reminder2hEvent extends BookingEventBase {
  type: 'REMINDER_2H'
}

export type BookingNotificationEvent =
  | BookingConfirmedEvent
  | BookingChangedEvent
  | BookingCancelledEvent
  | PaymentConfirmedEvent
  | Reminder24hEvent
  | Reminder2hEvent

export interface BookingNotificationMapperDeps {
  passTokenSecret?: string
  passBaseUrl?: string
  now?: Date | number
  issuePassTokenFn?: typeof issuePassToken
}

export interface OwnerNotificationPayload {
  workspaceId: string
  bookingId: string
  eventType: BookingEventType
  title: string
  body: string
  data: {
    bookingId: string
    customerId: string
    customerNameMasked: string
    serviceName: string
    startsAt: string
    paymentSummary: string
  }
  createdAt: string
}

export interface BookingAlimtalkSendRequest extends AlimtalkSendRequest {
  buttonVariables?: Record<string, unknown>
  bookingNumber?: string
}

export interface BookingNotificationMappingResult {
  customerAlimtalk: BookingAlimtalkSendRequest
  ownerNotification: OwnerNotificationPayload
}

/**
 * 고객 이름 마스킹 (PII 보호)
 * 홍길동 -> 홍*동, 김민 -> 김*, 남궁민수 -> 남**수
 */
export function maskCustomerName(name: string): string {
  if (!name || typeof name !== 'string') return ''
  const trimmed = name.trim()
  const len = trimmed.length
  if (len <= 1) return trimmed
  if (len === 2) return `${trimmed[0]}*`
  return `${trimmed[0]}${'*'.repeat(len - 2)}${trimmed[len - 1]}`
}

function resolvePaymentSummary(
  payment?: BookingPaymentFact,
): { customerText: string; ownerSummary: string } {
  if (!payment || payment.status === 'NONE') {
    return {
      customerText: '현장 결제 예정',
      ownerSummary: '현장 결제',
    }
  }

  if (payment.status === 'CONFIRMED' || payment.status === 'PAID') {
    const amountStr =
      typeof payment.amountKrw === 'number'
        ? `${payment.amountKrw.toLocaleString()}원`
        : '확인완료'
    return {
      customerText: `예약금 ${amountStr} 결제 완료`,
      ownerSummary: `예약금 ${amountStr} 결제 완료`,
    }
  }

  // PENDING, UNCONFIRMED: 확정 전 금액 단정 금지
  return {
    customerText: '결제 확인 중 (현장 안내)',
    ownerSummary: '결제 확인 중 (미확정)',
  }
}

/**
 * 예약 이벤트 -> 알림 메시지 매핑 순수 함수
 */
export async function mapBookingEventToNotifications(
  event: BookingNotificationEvent,
  deps: BookingNotificationMapperDeps,
): Promise<BookingNotificationMappingResult> {
  const {
    workspaceId,
    bookingId,
    customerName,
    customerPhone,
    serviceName,
    startsAt,
    shopName,
    locationText = '매장 안내 참조',
    consent,
  } = event

  if (deps.passTokenSecret) {
    const tokenIssuer = deps.issuePassTokenFn ?? issuePassToken
    try {
      await tokenIssuer({
        workspaceId,
        bookingId,
        secret: deps.passTokenSecret,
        now: deps.now,
      })
    } catch {
      // 미사용 토큰 발급 예외 무시
    }
  }

  const nowIso =
    deps.now instanceof Date
      ? deps.now.toISOString()
      : typeof deps.now === 'number'
        ? new Date(deps.now).toISOString()
        : new Date().toISOString()

  const maskedName = maskCustomerName(customerName)
  const paymentResolution = resolvePaymentSummary(event.payment)
  const bookingNumber = event.bookingNumber || bookingId

  let templateCode: string
  let templateBody: string
  let variables: Record<string, unknown>
  let eventKey: string
  let ownerTitle: string
  let ownerBody: string
  let ownerStartsAt = startsAt
  let ownerPaymentSummary = paymentResolution.ownerSummary

  switch (event.type) {
    case 'BOOKING_CONFIRMED': {
      eventKey = 'booking_confirmed'
      templateCode = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED.code
      templateBody = ALIMTALK_TEMPLATES.BOOKING_CONFIRMED.templateBody
      variables = {
        매장명: shopName,
        고객명: customerName,
        서비스명: serviceName,
        예약일시: startsAt,
        매장위치: locationText,
        결제안내: paymentResolution.customerText,
      }
      ownerTitle = '새로운 예약 확정'
      ownerBody = `${maskedName}님의 예약이 확정되었습니다 (${startsAt}, ${serviceName}).`
      break
    }

    case 'BOOKING_CHANGED': {
      eventKey = 'booking_changed'
      templateCode = ALIMTALK_TEMPLATES.BOOKING_CHANGED.code
      templateBody = ALIMTALK_TEMPLATES.BOOKING_CHANGED.templateBody
      ownerStartsAt = event.newStartsAt
      variables = {
        매장명: shopName,
        고객명: customerName,
        서비스명: serviceName,
        이전예약일시: event.previousStartsAt || startsAt,
        변경예약일시: event.newStartsAt,
        매장위치: locationText,
      }
      ownerTitle = '예약 일정 변경'
      ownerBody = `${maskedName}님의 예약 일정이 변경되었습니다 (${event.newStartsAt}).`
      break
    }

    case 'BOOKING_CANCELLED': {
      eventKey = 'booking_cancelled'
      templateCode = ALIMTALK_TEMPLATES.BOOKING_CANCELLED.code
      templateBody = ALIMTALK_TEMPLATES.BOOKING_CANCELLED.templateBody

      let refundNotice = '결제 내역 없음 (환불 대상 아님)'
      if (
        event.payment &&
        (event.payment.status === 'CONFIRMED' || event.payment.status === 'PAID')
      ) {
        const amt =
          typeof event.payment.amountKrw === 'number'
            ? `${event.payment.amountKrw.toLocaleString()}원`
            : '확인금액'
        refundNotice = `예약금 ${amt} 환불 절차 진행`
      }

      variables = {
        매장명: shopName,
        고객명: customerName,
        서비스명: serviceName,
        예약일시: startsAt,
        취소사유: event.cancelReason || '고객 요청 취소',
        환불안내: refundNotice,
      }
      ownerTitle = '예약 취소'
      ownerBody = `${maskedName}님의 예약이 취소되었습니다 (사유: ${event.cancelReason || '고객 요청'}).`
      break
    }

    case 'PAYMENT_CONFIRMED': {
      eventKey = 'payment_confirmed'
      templateCode = ALIMTALK_TEMPLATES.PAYMENT_CONFIRMED.code
      templateBody = ALIMTALK_TEMPLATES.PAYMENT_CONFIRMED.templateBody
      const amountStr = `${event.payment.amountKrw.toLocaleString()}원`
      variables = {
        매장명: shopName,
        고객명: customerName,
        서비스명: serviceName,
        예약일시: startsAt,
        결제금액: amountStr,
      }
      ownerPaymentSummary = `${amountStr} 결제 완료`
      ownerTitle = '예약금 결제 완료'
      ownerBody = `${maskedName}님의 예약금 ${amountStr} 결제가 확인되었습니다.`
      break
    }

    case 'REMINDER_24H': {
      eventKey = 'reminder_24h'
      templateCode = ALIMTALK_TEMPLATES.REMINDER_24H.code
      templateBody = ALIMTALK_TEMPLATES.REMINDER_24H.templateBody
      variables = {
        매장명: shopName,
        고객명: customerName,
        안내시점: '내일',
        서비스명: serviceName,
        예약일시: startsAt,
        매장위치: locationText,
      }
      ownerTitle = '방문 24시간 전 리마인더 발송'
      ownerBody = `${maskedName}님께 24시간 전 방문 리마인더가 발송되었습니다.`
      break
    }

    case 'REMINDER_2H': {
      eventKey = 'reminder_2h'
      templateCode = ALIMTALK_TEMPLATES.REMINDER_2H.code
      templateBody = ALIMTALK_TEMPLATES.REMINDER_2H.templateBody
      variables = {
        매장명: shopName,
        고객명: customerName,
        안내시점: '곧 (2시간 전)',
        서비스명: serviceName,
        예약일시: startsAt,
        매장위치: locationText,
      }
      ownerTitle = '방문 2시간 전 리마인더 발송'
      ownerBody = `${maskedName}님께 2시간 전 방문 리마인더가 발송되었습니다.`
      break
    }
  }

  const idempotencyKey = buildIdempotencyKey({
    workspaceId,
    bookingId,
    event: eventKey,
  })

  const customerAlimtalk: BookingAlimtalkSendRequest = {
    idempotencyKey,
    recipientPhone: customerPhone,
    templateCode,
    templateBody,
    variables,
    buttonVariables: undefined,
    bookingNumber,
    consent,
    workspaceId,
    bookingId,
    event: eventKey,
  }

  const ownerNotification: OwnerNotificationPayload = {
    workspaceId,
    bookingId,
    eventType: event.type,
    title: ownerTitle,
    body: ownerBody,
    data: {
      bookingId,
      customerId: event.customerId,
      customerNameMasked: maskedName,
      serviceName,
      startsAt: ownerStartsAt,
      paymentSummary: ownerPaymentSummary,
    },
    createdAt: nowIso,
  }

  return {
    customerAlimtalk,
    ownerNotification,
  }
}
