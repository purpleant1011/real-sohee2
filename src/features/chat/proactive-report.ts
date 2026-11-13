import type { ReportMetrics, ReportSampleState, ReportSnapshot } from '@/features/reports/types'

const sourceStateLabels: Readonly<Record<ReportSampleState, string>> = {
  sufficient: '표본 확인됨',
  limited: '표본 제한',
  collecting: '자료 수집 중',
  unavailable: '연결 확인 필요',
}

const metricDefinitions: readonly Readonly<{
  key: keyof Pick<ReportMetrics, 'engagements' | 'visits' | 'inquiries' | 'reservations'>
  label: string
}>[] = [
  { key: 'engagements', label: '관심 반응' },
  { key: 'visits', label: '유입' },
  { key: 'inquiries', label: '문의' },
  { key: 'reservations', label: '예약' },
]

export type M01ProactiveReport = Readonly<{
  checkedAt: string | null
  conversationCount: number | null
  headline: string
  insight: string
  metrics: readonly Readonly<{
    key: 'engagements' | 'visits' | 'inquiries' | 'reservations'
    label: string
    value: number | null
  }>[]
  periodLabel: string
  screenId: 'M-01'
  sourceMessage: string
  sourceState: string
}>

function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return `${year}. ${month}. ${day}.`
}

export function createM01ProactiveReport({
  conversationCount,
  snapshot,
}: Readonly<{
  conversationCount: number | null
  snapshot: ReportSnapshot
}>): M01ProactiveReport | null {
  const hasPeriod = snapshot.periodStart !== null && snapshot.periodEnd !== null
  const hasMetric = Object.values(snapshot.metrics).some((value) => value !== null)
  if (!hasPeriod && !hasMetric) return null

  const periodLabel = hasPeriod
    ? `${formatDate(snapshot.periodStart!)} – ${formatDate(snapshot.periodEnd!)}`
    : '확인된 기간을 준비하고 있어요.'

  return Object.freeze({
    checkedAt: snapshot.checkedAt,
    conversationCount,
    headline: '최근 콘텐츠 반응을 정리했어요.',
    insight: conversationCount === null
      ? '고객 대화 수는 아직 확인하지 못했어요. 연결 상태를 확인한 뒤 리포트에 표시할게요.'
      : conversationCount > 0
        ? `확인된 고객 대화 ${conversationCount}건이 있어요. 고객의 질문과 예약 연결은 리포트에서 확인할 수 있어요.`
        : '확인된 고객 대화는 아직 없어요. 실제 대화가 저장되면 리포트에서 연결해 보여 드려요.',
    metrics: Object.freeze(metricDefinitions.map(({ key, label }) => Object.freeze({
      key,
      label,
      value: snapshot.metrics[key],
    }))),
    periodLabel,
    screenId: 'M-01',
    sourceMessage: snapshot.message,
    sourceState: sourceStateLabels[snapshot.sampleState],
  })
}
