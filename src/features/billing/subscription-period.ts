export const subscriptionServicePeriodPolicy = Object.freeze({
  label: '결제일부터 1개월',
  startTrigger: 'server_verified_payment',
  months: 1,
  timeZone: 'Asia/Seoul',
  missingDay: 'last_day_of_month',
  boundaryNotice: '한국시간 기준 서버에서 확인한 결제 승인 시각부터 다음 달 같은 날짜·시각 전까지 제공합니다. 다음 달에 같은 날짜가 없으면 말일로 맞춥니다. 자동갱신 조건은 별도로 확정합니다.',
} as const)

export type SubscriptionServicePeriod = Readonly<{
  startsAt: string
  endsAt: string
  timeZone: 'Asia/Seoul'
  endExclusive: true
}>

/** 최초 승인된 결제 1회의 제공기간만 산정한다. 주문 승인·자동갱신·청구·권한 부여를 하지 않는다. */
export function calculateSubscriptionServicePeriod(approvedAt: Date): SubscriptionServicePeriod {
  if (!(approvedAt instanceof Date) || !Number.isFinite(approvedAt.getTime())) {
    throw new RangeError('유효한 결제 승인 시각이 필요합니다.')
  }
  const kstOffset = 9 * 60 * 60 * 1000
  const local = new Date(approvedAt.getTime() + kstOffset)
  const day = local.getUTCDate()
  const next = new Date(local.getTime())
  // 31일에서 바로 월을 더하면 다다음 달로 넘칠 수 있어 먼저 1일로 고정한다.
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const lastDay = new Date(next.getTime())
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0)
  next.setUTCDate(Math.min(day, lastDay.getUTCDate()))
  const end = new Date(next.getTime() - kstOffset)
  if (!Number.isFinite(end.getTime())) throw new RangeError('제공기간을 계산할 수 없는 결제 시각입니다.')
  return Object.freeze({
    startsAt: approvedAt.toISOString(), endsAt: end.toISOString(),
    timeZone: subscriptionServicePeriodPolicy.timeZone, endExclusive: true,
  })
}
