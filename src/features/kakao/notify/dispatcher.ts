/**
 * 알림톡 디스패처 (KAPI-dispatcher)
 *
 * 예약 이벤트(BookingNotificationEvent)를 수신하여:
 * 1. mapBookingEventToNotifications 로 알림톡 및 사장님 알림 페이로드 매핑
 * 2. 원장(LedgerPort)에 멱등키 선점(claim) (phoneLast4만 저장, 전체 번호 저장 금지)
 * 3. 중복 클레이밍 차단, 킬스위치(DRY_RUN) 격리, 동의(consent) 검증
 * 4. 어댑터 발송 위임 및 상태 전이(SENT/FAILED/REJECTED/DRY_RUN)
 * 5. 보안 철칙: 로그/원장/에러에 전화번호 및 토큰 전체 노출 차단
 */

import {
  mapBookingEventToNotifications,
  type BookingNotificationEvent,
  type BookingNotificationMapperDeps,
  type OwnerNotificationPayload,
} from './booking-notification-mapper'
import type { LedgerPort } from './ledger-port'
import type { ConfiguredAlimtalkAdapter } from './solapi-factory'

export type DispatchOutcome = 'SENT' | 'FAILED' | 'REJECTED' | 'DRY_RUN' | 'DUPLICATE'

export interface DispatchBookingNotificationDeps {
  adapter: ConfiguredAlimtalkAdapter
  ledger: LedgerPort
  mapperDeps: BookingNotificationMapperDeps
  now?: () => Date
}

export interface DispatchBookingNotificationResult {
  outcome: DispatchOutcome
  ownerNotification?: OwnerNotificationPayload
  providerMessageId?: string
  error?: string
}

/**
 * 전화번호 및 비밀값 등 민감정보 마스킹 (PII 보호)
 */
export function sanitizeSensitiveText(text: string | undefined): string {
  if (!text) return ''
  let sanitized = text

  // 1. 전화번호 마스킹 (010-1234-5678, +821012345678, 01012345678 등)
  sanitized = sanitized.replace(/(?:\+?82|0)10[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[PHONE_MASKED]')
  sanitized = sanitized.replace(/\b010\d{8}\b/g, '[PHONE_MASKED]')

  // 2. 인증/토큰/비밀키 패턴 마스킹
  sanitized = sanitized.replace(/apiKey=[^,\s&"']+/g, 'apiKey=[MASKED]')
  sanitized = sanitized.replace(/signature=[^,\s&"']+/g, 'signature=[MASKED]')
  sanitized = sanitized.replace(/token=[^,\s&"']+/g, 'token=[MASKED]')
  sanitized = sanitized.replace(/secret[_\w-]*/gi, '[SECRET_MASKED]')
  sanitized = sanitized.replace(/(?:Bearer|HMAC-SHA256)\s+[^\s]+/gi, '[AUTH_MASKED]')

  return sanitized
}

/**
 * 전화번호에서 끝 4자리만 추출
 */
export function extractPhoneLast4(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (digits.length >= 4) {
    return digits.slice(-4)
  }
  return digits.padStart(4, '0')
}

/**
 * 예약 이벤트 알림톡 발송 디스패처
 */
export async function dispatchBookingNotification(
  event: BookingNotificationEvent,
  deps: DispatchBookingNotificationDeps,
): Promise<DispatchBookingNotificationResult> {
  const now = deps.now ? deps.now() : new Date()
  const nowIso = now.toISOString()

  // 1. 이벤트 매핑
  const mapperDeps: BookingNotificationMapperDeps = {
    ...deps.mapperDeps,
    now: deps.mapperDeps.now ?? now,
  }
  const { customerAlimtalk, ownerNotification } = await mapBookingEventToNotifications(
    event,
    mapperDeps,
  )

  // 2. 정보성 알림 수신 동의(consent) 검증 (live claim 전 거부하여 영구 차단 방지)
  if (event.consent !== 'informational' || customerAlimtalk.consent !== 'informational') {
    const errorMsg = '정보성 알림 수신 동의가 없습니다 (consent: none).'
    return {
      outcome: 'REJECTED',
      ownerNotification,
      error: errorMsg,
    }
  }

  // 3. 어댑터 킬스위치 확인 (enabled=false 면 live claim/transition 없이 DRY_RUN 격리)
  if (!deps.adapter.enabled) {
    return {
      outcome: 'DRY_RUN',
      ownerNotification,
    }
  }

  const idempotencyKey = customerAlimtalk.idempotencyKey
  const phoneLast4 = extractPhoneLast4(event.customerPhone)

  // 4. 원장 멱등 선점 (전체 전화번호 절대 저장 금지, phoneLast4만 저장)
  const claimed = await deps.ledger.claim(
    {
      idempotencyKey,
      workspaceId: event.workspaceId,
      bookingId: event.bookingId,
      event: customerAlimtalk.event || event.type,
      templateCode: customerAlimtalk.templateCode,
      phoneLast4,
    },
    nowIso,
  )

  if (!claimed) {
    return {
      outcome: 'DUPLICATE',
      ownerNotification,
    }
  }

  // 5. 실발송 시도 (어댑터 호출)
  try {
    const sendResult = await deps.adapter.send(customerAlimtalk)

    if (sendResult.status === 'SENT') {
      const providerMessageId = (sendResult as { messageId?: string }).messageId
      await deps.ledger.transition(
        idempotencyKey,
        'SENT',
        { providerMessageId },
        nowIso,
      )
      return {
        outcome: 'SENT',
        ownerNotification,
        providerMessageId,
      }
    }

    if (sendResult.status === 'DRY_RUN') {
      await deps.ledger.transition(idempotencyKey, 'DRY_RUN', {}, nowIso)
      return {
        outcome: 'DRY_RUN',
        ownerNotification,
      }
    }

    if (sendResult.status === 'REJECTED') {
      const safeError = sanitizeSensitiveText(sendResult.error || '어댑터 발송 거부')
      await deps.ledger.transition(idempotencyKey, 'REJECTED', { error: safeError }, nowIso)
      return {
        outcome: 'REJECTED',
        ownerNotification,
        error: safeError,
      }
    }

    // sendResult.status === 'FAILED'
    const safeError = sanitizeSensitiveText(sendResult.error || '어댑터 발송 실패')
    await deps.ledger.transition(idempotencyKey, 'FAILED', { error: safeError }, nowIso)
    return {
      outcome: 'FAILED',
      ownerNotification,
      error: safeError,
    }
  } catch (err) {
    // 어댑터가 예외를 throw해도 dispatcher는 throw하지 않고 FAILED 기록
    const rawError = err instanceof Error ? err.message : String(err)
    const safeError = sanitizeSensitiveText(rawError)
    await deps.ledger.transition(idempotencyKey, 'FAILED', { error: safeError }, nowIso)
    return {
      outcome: 'FAILED',
      ownerNotification,
      error: safeError,
    }
  }
}
