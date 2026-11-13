import { isResultsPeriod, isResultsRange } from '@/features/mobile-results/results-period'
import { ResultsEntry } from './results-entry'

/**
 * M20 성과 목록. `?period=previous` 는 드릴다운에서 '뒤로'로 돌아올 때 보던 기간이며,
 * `?start=&end=` 는 직접 선택 구간이다. 둘 다 기간 선택 상태를 잃지 않도록 진입점에 그대로 넘긴다.
 */
export default async function ResultsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ period?: string; start?: string; end?: string }> }>) {
  const { period, start, end } = await searchParams
  // 중복 키(?start=a&start=b)는 Next 가 배열로 주므로 string 검사에서 자연히 무효가 된다.
  // 형식이 깨진 구간은 조용히 무시하고 프리셋으로 그린다(서버 400 을 유도하지 않는다).
  const range = typeof start === 'string' && typeof end === 'string' ? { start, end } : null
  return (
    <ResultsEntry
      initialPeriod={isResultsPeriod(period) ? period : undefined}
      initialRange={isResultsRange(range) ? range : null}
    />
  )
}
