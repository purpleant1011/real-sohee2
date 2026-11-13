import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'
import {
  DEFAULT_RESULTS_PERIOD,
  RESULTS_RANGE_ERROR,
  isResultsPeriod,
  parseResultsRange,
  resultsPeriodBaseDate,
  resultsRangePeriod,
  resultsRangeProblem,
} from '@/features/mobile-results/results-period'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) { auth.headers.set('Cache-Control', 'no-store'); return auth }
    if (auth.workspaceId !== workspaceId) return NextResponse.json({ error: '기록을 찾을 수 없어요.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    // 기간은 읽기 전용 파라미터다. 쓰기 경로가 아니다.
    // 직접 구간(`?start=&end=`)은 짝으로 와야 하고 프리셋(`period`)과 섞이면 의도가 모호하므로 400 으로 닫는다.
    // 어긋난 구간을 다른 기간으로 줄이지 않는다 — 숫자와 기간 라벨이 어긋나는 것을 막는다.
    const search = new URL(request.url).searchParams
    const service = new WeeklyCeoReportService(auth.supabase, auth.admin)
    if (search.has('start') || search.has('end')) {
      const range = parseResultsRange(search)
      if (!range || search.has('period') || resultsRangeProblem(range) !== null) {
        return NextResponse.json({ error: RESULTS_RANGE_ERROR }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      const report = await service.generateRangeReport(auth.workspaceId, resultsRangePeriod(range))
      return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
    }
    // 프리셋은 모르는 값을 이번 주로 돌린다 — 응답이 자기 기간을 스스로 말하므로 다른 기간을 이번 주로 표시하지 않는다.
    const requested = search.get('period')
    const period = isResultsPeriod(requested) ? requested : DEFAULT_RESULTS_PERIOD
    const report = await service.generateReport(auth.workspaceId, resultsPeriodBaseDate(period))
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: '주간 기록을 불러오지 못했어요.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
