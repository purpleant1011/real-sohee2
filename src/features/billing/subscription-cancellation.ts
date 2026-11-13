import type { SubscriptionServicePeriod } from './subscription-period'

export type SubscriptionCancellationPlan = Readonly<{
  status: 'scheduled' | 'period_already_ended'
  requestedAt: string
  effectiveAt: string
  blockNextRenewal: true
}>

function isCanonicalIsoString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const d = new Date(value)
  return Number.isFinite(d.getTime()) && d.toISOString() === value
}

/**
 * 기간말 해지 순수 계획을 계산한다.
 * 실제 구독 상태, DB, 권한, 자동청구, 환불에는 일절 관여하지 않는다.
 */
export function planSubscriptionCancellation(
  period: SubscriptionServicePeriod,
  requestedAt: Date
): SubscriptionCancellationPlan {
  if (!(requestedAt instanceof Date) || !Number.isFinite(requestedAt.getTime())) {
    throw new RangeError('유효한 해지 요청 시각이 필요합니다.')
  }

  if (typeof period !== 'object' || period === null) {
    throw new RangeError('유효한 구독 제공기간 객체가 필요합니다.')
  }

  if (period.timeZone !== 'Asia/Seoul' || period.endExclusive !== true) {
    throw new RangeError('구독 제공기간의 timeZone 또는 endExclusive 정책이 유효하지 않습니다.')
  }

  if (!isCanonicalIsoString(period.startsAt) || !isCanonicalIsoString(period.endsAt)) {
    throw new RangeError('구독 제공기간의 시작·종료 시각은 표준 ISO-8601 canonical 문자열이어야 합니다.')
  }

  const startsAtMs = new Date(period.startsAt).getTime()
  const endsAtMs = new Date(period.endsAt).getTime()

  if (startsAtMs >= endsAtMs) {
    throw new RangeError('구독 제공기간의 시작 시각은 종료 시각보다 앞서야 합니다.')
  }

  const requestedAtMs = requestedAt.getTime()

  if (requestedAtMs < startsAtMs) {
    throw new RangeError('구독 시작 전에는 해지를 요청할 수 없습니다.')
  }

  const status: SubscriptionCancellationPlan['status'] =
    requestedAtMs >= endsAtMs ? 'period_already_ended' : 'scheduled'

  return Object.freeze({
    status,
    requestedAt: requestedAt.toISOString(),
    effectiveAt: period.endsAt,
    blockNextRenewal: true,
  })
}
