/**
 * 카카오 알림톡 정보성 메시지 템플릿 카탈로그 (KAPI-05 / KAPI-12)
 *
 * 카카오 비즈메시지 / 솔라피(Solapi) 사전 심사용 규격:
 * 1. 정보성 메시지(기본형 BA): 영리 목적 광고, 할인 쿠폰, 프로모션 문구 철저 배제
 * 2. 유니코드 이모지 배제 (■, - 등 시스템 기호만 허용)
 * 3. 본문 글자 수 1,000자 이내 (공백 포함)
 * 4. 버튼 없음 (도메인 고정 심사 대응 및 실존하지 않는 페이지 배제를 위해 본문 전용 구성)
 * 5. booking-notification-mapper 호환성 검증 완료
 */

export type AlimtalkButtonType = 'WL' | 'AL' | 'BK' | 'MD' | 'AC'

export interface AlimtalkButton {
  /** 버튼명 (14자 이내 권장, 카카오 알림톡 표준) */
  name: string
  /** 버튼 타입: WL (웹링크) */
  type: AlimtalkButtonType
  /** 모바일 웹 링크 URL 또는 변수 */
  urlMobile: string
  /** PC 웹 링크 URL 또는 변수 */
  urlPc?: string
}

export type AlimtalkTemplateCodeKey =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CHANGED'
  | 'BOOKING_CANCELLED'
  | 'PAYMENT_CONFIRMED'
  | 'REMINDER_24H'
  | 'REMINDER_2H'

export interface AlimtalkTemplate {
  /** 솔라피/카카오 등록 템플릿 코드 */
  code: string
  /** 템플릿 명 (심사용) */
  name: string
  /** 메시지 유형 (기본형 BA) */
  messageType: 'BA'
  /** 본문 템플릿 (#{변수} 포함, 1,000자 이내, 카카오 승인 본문 정본 - 부가정보 제외) */
  templateBody: string
  /** 본문에 정의된 #{변수} 키 목록 */
  variables: readonly string[]
  /** 알림톡 버튼 목록 (최대 5개, 현재 0개) */
  buttons: readonly AlimtalkButton[]
  /** 템플릿 발송 목적 및 설명 */
  description: string
  /**
   * 카카오 승인 심사 시 하단에 첨부되는 부가정보 문구
   * 본문 sha256 해시는 부가정보를 제외한 templateBody 기준이며 별도 필드로 관리
   */
  extraInfo?: string
}

/**
 * 카카오 승인 심사 시 본문 아래에 첨부되는 부가정보 문구 (BOOKING_CHANGED, BOOKING_CANCELLED 등)
 * 본문 정본은 부가정보를 제외한 부분이며 body sha256은 부가정보를 뺀 본문 기준입니다.
 */
export const ALIMTALK_EXTRA_INFO =
  '예약을 완료한 고객 본인에게만 발송하는 정보성 안내 메시지입니다. 광고·프로모션 내용은 포함하지 않습니다.'

export const extraInfo = ALIMTALK_EXTRA_INFO

export const ALIMTALK_TEMPLATE_CODES = {
  BOOKING_CONFIRMED: 'SOHEE_BOOKING_CONFIRMED_V1',
  BOOKING_CHANGED: 'SOHEE_BOOKING_CHANGED_V1',
  BOOKING_CANCELLED: 'SOHEE_BOOKING_CANCELLED_V1',
  PAYMENT_CONFIRMED: 'SOHEE_PAYMENT_CONFIRMED_V1',
  REMINDER_24H: 'SOHEE_REMINDER_24H_V1',
  REMINDER_2H: 'SOHEE_REMINDER_2H_V1',
} as const

export const SOHEE_BOOKING_CONFIRMED = ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED
export const SOHEE_BOOKING_CHANGED = ALIMTALK_TEMPLATE_CODES.BOOKING_CHANGED
export const SOHEE_BOOKING_CANCELLED = ALIMTALK_TEMPLATE_CODES.BOOKING_CANCELLED
export const SOHEE_PAYMENT_CONFIRMED = ALIMTALK_TEMPLATE_CODES.PAYMENT_CONFIRMED
export const SOHEE_REMINDER_24H = ALIMTALK_TEMPLATE_CODES.REMINDER_24H
export const SOHEE_REMINDER_2H = ALIMTALK_TEMPLATE_CODES.REMINDER_2H

/**
 * 1. 예약 확정 안내 템플릿
 */
const TEMPLATE_BOOKING_CONFIRMED: AlimtalkTemplate = {
  code: ALIMTALK_TEMPLATE_CODES.BOOKING_CONFIRMED,
  name: '예약 확정 안내',
  messageType: 'BA',
  templateBody: `[#{매장명}] 예약 확정 안내

안녕하세요, #{고객명}님!
예약이 정상적으로 확정되었습니다.

■ 예약 상세
- 서비스: #{서비스명}
- 예약일시: #{예약일시}
- 장소: #{매장위치}
- 결제상태: #{결제안내}`,
  variables: ['매장명', '고객명', '서비스명', '예약일시', '매장위치', '결제안내'],
  buttons: [],
  description: '고객의 예약이 정상적으로 확정되었을 때 발송하는 정보성 알림',
}

/**
 * 2. 예약 변경 안내 템플릿
 */
const TEMPLATE_BOOKING_CHANGED: AlimtalkTemplate = {
  code: ALIMTALK_TEMPLATE_CODES.BOOKING_CHANGED,
  name: '예약 변경 안내',
  messageType: 'BA',
  templateBody: `[#{매장명}] 예약 변경 안내

안녕하세요, #{고객명}님!
예약 일정이 아래와 같이 변경되었습니다.

■ 변경 상세
- 서비스: #{서비스명}
- 이전일시: #{이전예약일시}
- 변경일시: #{변경예약일시}
- 장소: #{매장위치}`,
  variables: [
    '매장명',
    '고객명',
    '서비스명',
    '이전예약일시',
    '변경예약일시',
    '매장위치',
  ],
  buttons: [],
  description: '기존 예약 일정이 고객 또는 매장에 의해 변경되었을 때 발송하는 정보성 알림',
  extraInfo: ALIMTALK_EXTRA_INFO,
}

/**
 * 3. 예약 취소 안내 템플릿
 */
const TEMPLATE_BOOKING_CANCELLED: AlimtalkTemplate = {
  code: ALIMTALK_TEMPLATE_CODES.BOOKING_CANCELLED,
  name: '예약 취소 안내',
  messageType: 'BA',
  templateBody: `[#{매장명}] 예약 취소 안내

안녕하세요, #{고객명}님!
예약이 정상적으로 취소 처리되었습니다.

■ 취소 상세
- 서비스: #{서비스명}
- 기존일시: #{예약일시}
- 취소사유: #{취소사유}
- 환불안내: #{환불안내}

이용해 주셔서 감사합니다.`,
  variables: ['매장명', '고객명', '서비스명', '예약일시', '취소사유', '환불안내'],
  buttons: [],
  description: '예약이 취소 처리되었을 때 사유 및 환불 안내를 전달하는 정보성 알림',
  extraInfo: ALIMTALK_EXTRA_INFO,
}

/**
 * 4. 결제 완료 안내 템플릿
 */
const TEMPLATE_PAYMENT_CONFIRMED: AlimtalkTemplate = {
  code: ALIMTALK_TEMPLATE_CODES.PAYMENT_CONFIRMED,
  name: '결제 완료 안내',
  messageType: 'BA',
  templateBody: `[#{매장명}] 결제 완료 안내

안녕하세요, #{고객명}님!
예약금 결제가 정상적으로 확인되었습니다.

■ 결제 상세
- 서비스: #{서비스명}
- 예약일시: #{예약일시}
- 결제금액: #{결제금액}`,
  variables: ['매장명', '고객명', '서비스명', '예약일시', '결제금액'],
  buttons: [],
  description: '예약금 등 결제가 정상 확인되었을 때 발송하는 영수/결제 확인 정보성 알림',
}

/**
 * 5. 방문 24시간 전 리마인더 템플릿
 */
const TEMPLATE_REMINDER_24H: AlimtalkTemplate = {
  code: ALIMTALK_TEMPLATE_CODES.REMINDER_24H,
  name: '방문 24시간 전 리마인더',
  messageType: 'BA',
  templateBody: `[#{매장명}] 방문 일정 리마인더

안녕하세요, #{고객명}님!
#{안내시점} 방문 예정인 예약 일정을 안내해 드립니다.

■ 예약 상세
- 서비스: #{서비스명}
- 방문일시: #{예약일시}
- 장소: #{매장위치}`,
  variables: ['매장명', '고객명', '안내시점', '서비스명', '예약일시', '매장위치'],
  buttons: [],
  description: '방문 24시간 전 고객에게 일정 재확인을 위해 발송하는 리마인더 알림',
}

/**
 * 6. 방문 2시간 전 리마인더 템플릿
 */
const TEMPLATE_REMINDER_2H: AlimtalkTemplate = {
  code: ALIMTALK_TEMPLATE_CODES.REMINDER_2H,
  name: '방문 2시간 전 리마인더',
  messageType: 'BA',
  templateBody: `[#{매장명}] 방문 일정 리마인더

안녕하세요, #{고객명}님!
#{안내시점} 방문 예정인 예약 일정을 안내해 드립니다.

■ 예약 상세
- 서비스: #{서비스명}
- 방문일시: #{예약일시}
- 장소: #{매장위치}`,
  variables: ['매장명', '고객명', '안내시점', '서비스명', '예약일시', '매장위치'],
  buttons: [],
  description: '방문 2시간 전 노쇼 방지 및 이동 안내를 위해 발송하는 직전 리마인더 알림',
}

export const ALIMTALK_TEMPLATES: Record<AlimtalkTemplateCodeKey, AlimtalkTemplate> = {
  BOOKING_CONFIRMED: TEMPLATE_BOOKING_CONFIRMED,
  BOOKING_CHANGED: TEMPLATE_BOOKING_CHANGED,
  BOOKING_CANCELLED: TEMPLATE_BOOKING_CANCELLED,
  PAYMENT_CONFIRMED: TEMPLATE_PAYMENT_CONFIRMED,
  REMINDER_24H: TEMPLATE_REMINDER_24H,
  REMINDER_2H: TEMPLATE_REMINDER_2H,
}

export const ALIMTALK_TEMPLATE_LIST: readonly AlimtalkTemplate[] = [
  TEMPLATE_BOOKING_CONFIRMED,
  TEMPLATE_BOOKING_CHANGED,
  TEMPLATE_BOOKING_CANCELLED,
  TEMPLATE_PAYMENT_CONFIRMED,
  TEMPLATE_REMINDER_24H,
  TEMPLATE_REMINDER_2H,
]

export function getAlimtalkTemplate(code: string): AlimtalkTemplate | undefined {
  return ALIMTALK_TEMPLATE_LIST.find((t) => t.code === code)
}
