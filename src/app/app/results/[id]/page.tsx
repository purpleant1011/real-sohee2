import { isResultsPeriod, isResultsRange } from '@/features/mobile-results/results-period'
import { ResultsDetailEntry } from './results-detail-entry'

/**
 * M20 근거 드릴다운(`/app/results/:id`) — 셸 라우트 맵이 선언해 둔 경로를 실제 페이지로 만든다.
 * `:id` 는 지표 키(published·inquiries·bookings·deposits)다. 리포트 보고서 id 가 아니다.
 * `?period=previous`·`?start=&end=` 는 성과 화면에서 보던 기간이며, 조회는 기존 주간 리포트 읽기 API 만 쓴다.
 */
export default async function ResultsDetailRoute({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string; start?: string; end?: string }>
}>) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const range = typeof query.start === 'string' && typeof query.end === 'string'
    ? { start: query.start, end: query.end }
    : null
  return (
    <ResultsDetailEntry
      metricId={id}
      period={isResultsPeriod(query.period) ? query.period : undefined}
      range={isResultsRange(range) ? range : null}
    />
  )
}
