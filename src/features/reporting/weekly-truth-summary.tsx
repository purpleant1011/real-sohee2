'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatObservation } from './observation'
import type { WeeklyCeoReportData } from './weekly-ceo-report-service'

/**
 * 홈에서 접었을 때 먼저 보여 주는 지표 수. 나머지는 '더 보기'로 펼친다(정보 삭제 없음).
 * 사장님이 홈에서 먼저 봐야 할 4개(확정 예약·게시 확인·확인된 매출·예약금 수납)를 앞에 둔다.
 */
const COLLAPSED_METRIC_COUNT = 4

export function WeeklyTruthSummary({ workspaceId, collapsible = false }: { workspaceId: string; collapsible?: boolean }) {
  const [result, setResult] = useState<{ workspaceId: string; report: WeeklyCeoReportData } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [showAllMetrics, setShowAllMetrics] = useState(false)
  const report = result?.workspaceId === workspaceId ? result.report : null

  useEffect(() => {
    let active = true
    setResult(null)
    setFailure(null)
    if (!workspaceId || workspaceId === 'ws-default') {
      setFailure(workspaceId)
      return
    }
    const load = async () => {
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports/weekly`, { cache: 'no-store' })
        if (!response.ok) throw new Error('조회 실패')
        const next: WeeklyCeoReportData = await response.json()
        if (next.workspaceId !== workspaceId || !next.metrics || !next.period) throw new Error('조회 결과 불일치')
        if (active) setResult({ workspaceId, report: next })
      } catch {
        if (active) setFailure(workspaceId)
      }
    }
    void load()
    return () => { active = false }
  }, [workspaceId, revision])

  const retry = <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>다시 조회</Button>
  if (failure === workspaceId) return <section className="rounded-2xl border border-border bg-card p-5 space-y-3"><p role="alert">주간 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>{retry}</section>
  if (!report) return <p role="status" className="text-sm text-muted-foreground">주간 기록을 확인하고 있어요.</p>

  const rows = [
    ['현재 확정 예약', report.metrics.bookingConfirmed, '기간 내 생성된 예약의 현재 상태'],
    ['게시 확인', report.metrics.verifiedPublishedPosts, '외부 게시 결과가 확인된 기록'],
    ['확인된 매출', report.metrics.revenue, '예약금·예약 금액으로 추정하지 않아요'],
    ['확인된 예약금 수납', report.metrics.paymentCapturedVerified, '예약 금액과 실제 수납은 달라요'],
    ['취소 예약', report.metrics.bookingCanceled, '기간 내 생성된 예약의 현재 상태'],
    ['게시 확인 대기', report.metrics.publicationPending, '게시 요청과 실제 게시 확인은 달라요'],
    ['저장된 댓글', report.metrics.storedComments, '문의·고객 수와는 다른 기록'],
    ['확인된 방문 완료', report.metrics.visitCompletedVerified, '예약 완료와 방문 완료는 달라요'],
    ['절감 시간', report.metrics.hoursSaved, '실제 작업 시간 비교 근거가 필요해요'],
    ['절감 비용', report.metrics.costSavedWon, '실제 비용 비교 근거가 필요해요'],
  ] as const
  const hasError = rows.some(([, metric]) => metric.state === 'ERROR')
  const visibleRows = collapsible && !showAllMetrics ? rows.slice(0, COLLAPSED_METRIC_COUNT) : rows
  const hiddenRowCount = rows.length - visibleRows.length

  return <section aria-label="주간 실제 기록" className="rounded-2xl border border-border bg-card text-card-foreground p-5 sm:p-7 space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h2 className="text-lg font-bold">이번 주 실제 기록</h2><p className="text-xs text-muted-foreground">{report.periodLabel} · 종료 시각 미포함</p></div>
      {retry}
    </header>
    {report.datasetMode !== 'ACTUAL' && <p className="text-sm text-muted-foreground">실제 운영 자료로 확인되지 않아 성과 집계에서 제외했어요.</p>}
    {hasError && <p role="alert" className="text-sm">일부 기록을 조회하지 못했어요. 오류 항목은 0건으로 계산하지 않았어요.</p>}
    <p className="text-sm leading-relaxed whitespace-pre-line">{report.executiveSummary}</p>
    <dl id="home-weekly-metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {visibleRows.map(([label, metric, explanation]) => <div key={label} className="rounded-xl border border-border p-4 space-y-2">
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="text-lg font-bold break-words">{formatObservation(metric)}</dd>
        <dd className="text-xs text-muted-foreground leading-relaxed">{explanation}</dd>
        {metric.state === 'OBSERVED' && <dd className="text-xs text-muted-foreground">기록 {metric.evidenceIds.length}건 확인</dd>}
        {metric.state === 'OBSERVED' && metric.evidenceIds.length > 0 && (metric === report.metrics.bookingConfirmed || metric === report.metrics.bookingCanceled) && <dd>
          <details className="text-xs">
            <summary className="cursor-pointer underline underline-offset-4">예약 근거 보기</summary>
            <ul className="mt-2 space-y-2">{metric.evidenceIds.map((id, index) => <li key={id}><Link className="underline underline-offset-4" href={`/app/customers#reservation-${encodeURIComponent(id)}`}>예약 기록 {index + 1} 보기</Link></li>)}</ul>
          </details>
        </dd>}
      </div>)}
    </dl>
    {collapsible && (hiddenRowCount > 0 || showAllMetrics) && (
      <button
        type="button"
        onClick={() => setShowAllMetrics((prev) => !prev)}
        aria-expanded={showAllMetrics}
        aria-controls="home-weekly-metrics"
        className="flex w-full min-h-11 items-center justify-center gap-1 rounded-xl border border-border bg-background/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {showAllMetrics ? (
          <>
            <ChevronUp className="w-4 h-4 shrink-0" aria-hidden="true" />
            지표 접기
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
            나머지 {hiddenRowCount}개 지표 더 보기
          </>
        )}
      </button>
    )}
    <footer className="flex flex-wrap gap-4 text-sm">
      <Link href="/app/customers#reservation-ledger" className="underline underline-offset-4">고객·예약 기록 보기</Link>
      <Link href="/app/content" className="underline underline-offset-4">게시물 확인하기</Link>
      <Link href="/app/settings/channels" className="underline underline-offset-4">채널 연결 확인</Link>
    </footer>
    <p className="text-xs text-muted-foreground">사업장에 저장된 기록만 집계합니다. 수집되지 않은 외부 활동은 포함하지 않아요. 조회 시각: {report.generatedAt}</p>
  </section>
}
