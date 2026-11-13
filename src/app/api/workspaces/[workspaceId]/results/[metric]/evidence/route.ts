import { NextResponse } from 'next/server'
import { isEvidenceListR2Enabled } from '@/features/mobile-results/evidence-list-flag'
import { DEFAULT_RESULTS_PERIOD, isResultsPeriod, resultsPeriodBaseDate } from '@/features/mobile-results/results-period'
import { EVIDENCE_RECORD_CACHE_CONTROL } from '@/features/mobile-results/server/evidence-record-boundary'
import { isEvidenceRecordMetric, toEvidenceRecordList } from '@/features/mobile-results/server/evidence-record-dto'
import { readEvidenceRecords } from '@/features/mobile-results/server/evidence-record-read'
import { KPI_METRIC } from '@/features/mobile-results/server/results-snapshot'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': EVIDENCE_RECORD_CACHE_CONTROL }

function notFound(): NextResponse {
  return NextResponse.json({ error: '기록을 찾을 수 없어요.' }, { status: 404 })
}

/**
 * M20 근거 기록 목록(ANI-1783 2단계). 플래그 `NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST` 뒤에 있다.
 *
 * - 플래그 OFF 면 이 경로는 없는 것이다(PC·기존 주간 응답 불변).
 * - 근거는 주간 리포트가 이미 고른 기록 id 다. 목록이 근거를 다시 판정하지 않는다.
 * - 읽기 전용 GET 이며 provider 호출·외부 쓰기가 없다.
 * - 조회 실패는 0건이 아니다: DTO 의 `state=ERROR` + `totalCount=null` 로 내려간다.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; metric: string }> },
) {
  try {
    if (!isEvidenceListR2Enabled()) return notFound()

    const { workspaceId, metric } = await params
    if (!isEvidenceRecordMetric(metric)) return notFound()

    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    if (auth.workspaceId !== workspaceId) return notFound()

    const requested = new URL(request.url).searchParams.get('period')
    const period = isResultsPeriod(requested) ? requested : DEFAULT_RESULTS_PERIOD
    const report = await new WeeklyCeoReportService(auth.admin).generateReport(
      auth.workspaceId,
      resultsPeriodBaseDate(period),
    )

    const key = KPI_METRIC[metric]
    const observation = key ? report.metrics[key] ?? null : null
    const ids = Array.isArray(observation?.evidenceIds) ? observation.evidenceIds : []
    // 원천이 연결되지 않은 지표는 읽을 곳이 없다(빈 목록으로 위장하지 않는다).
    const read = key === null
      ? { rows: null, complete: false }
      : await readEvidenceRecords(auth.admin, auth.workspaceId, metric, ids)

    const dto = toEvidenceRecordList({
      workspaceId: auth.workspaceId,
      metric,
      datasetMode: report.datasetMode,
      observation,
      period: report.period,
      checkedAt: report.generatedAt,
      rows: read.rows,
      complete: read.complete,
    })
    return NextResponse.json(dto, { headers: NO_STORE })
  } catch {
    return NextResponse.json(
      { error: '근거 기록을 불러오지 못했어요.' },
      { status: 500, headers: NO_STORE },
    )
  }
}
