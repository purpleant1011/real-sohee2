'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarCheck2, CreditCard, MessageCircle, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'
import { StateView, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import type { LoadState } from '@/features/mobile-decision/contracts'
import {
  EXAMPLE_BADGE_LABEL,
  KPI_EXPLANATION,
  KPI_LABEL,
  kpiDisplay,
  nextActions,
  revenueRows,
  samePeriod,
  showsNumbers,
  timeSaved,
  type KpiId,
  type MobileKpi,
  type ResultsDatasetMode,
} from './results-model'
import { RESULTS_PERIOD_OPTIONS, type ResultsPeriod, type ResultsRange } from './results-period'
import { ResultsRangeSheet } from './results-range-sheet'

/** 서버 DTO를 그대로 받는 뷰 모델. 숫자 가공은 전부 results-model 이 담당한다. */
export interface ResultsViewSnapshot {
  loadState: LoadState
  kpis: readonly MobileKpi[]
  /**
   * 화면이 기대하는 데이터셋. ACTUAL 이 아니면 숫자를 보여주지 않는다.
   * `EXAMPLE` 은 `/dev/mobile-r2` 예시 화면만 쓰고, 그때도 카드마다 '예시' 표시가 붙는다.
   */
  datasetMode: ResultsDatasetMode
  estimatedBookedKrw: number | null
  confirmedPaidKrw: number | null
  timeSavedBaselineMinutes: number | null
  timeSavedMeasuredMinutes: number | null
  timeSavedMethod: string | null
  checkedAt: string | null
}

/**
 * M20 성과. 화면은 라우터/데이터 조회를 모르고 DTO만 받는다.
 *
 * `kpiHref` 를 주면 카드가 근거 드릴다운(`/app/results/:id`) 링크가 된다.
 * 예시 화면처럼 실제 근거가 없는 곳은 넘기지 않는다 — 누를 수 없는 근거를 만들지 않는다.
 * `period`·`onPeriodChange` 를 주면 기간 선택이 붙는다(실라우트만 — 예시 화면은 기간을 바꾸지 않는다).
 */
export function MobileResultsView({
  snapshot,
  kpiHref,
  period,
  onPeriodChange,
  range = null,
  onRangeChange,
  rangeRejected = false,
  heading = '성과',
  onRetry,
}: {
  snapshot: ResultsViewSnapshot
  kpiHref?: (id: KpiId) => string
  period?: ResultsPeriod
  onPeriodChange?: (next: ResultsPeriod) => void
  /** 직접 선택 구간. 있으면 '직접 선택'이 켜진 것으로 보인다. */
  range?: ResultsRange | null
  /** 넘기면 '직접 선택' 버튼과 바텀시트가 붙는다. 예시 화면은 넘기지 않는다(2버튼 유지). */
  onRangeChange?: (range: ResultsRange) => void
  /** 서버가 400 으로 닫았을 때. 숫자 대신 사유를 보여준다. */
  rangeRejected?: boolean
  /** 모바일 주간 CEO 보고(/app/reports)는 같은 화면 틀을 '주간 보고' 제목으로 쓴다. */
  heading?: string
  onRetry?: () => void
}) {
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false)
  const kind = stateKind(snapshot.loadState)
  const periodText = describePeriod(snapshot.kpis)
  const savedMinutes = timeSaved(
    snapshot.timeSavedBaselineMinutes,
    snapshot.timeSavedMeasuredMinutes,
    snapshot.timeSavedMethod,
  )
  const rows = revenueRows(snapshot.estimatedBookedKrw, snapshot.confirmedPaidKrw)
  // 숫자는 ACTUAL 화면 + ACTUAL 지표일 때만 그린다(fail-closed). DEMO/TEST 숫자를 실제처럼 보여주지 않는다.
  // EXAMPLE 은 예시 화면 전용이며, 그때도 카드마다 '예시' 표시가 붙는다.
  const numbersVisible = showsNumbers(snapshot.datasetMode)
  const isExample = snapshot.datasetMode === 'EXAMPLE'
  // '다음에 할 일'은 화면에 그린 값과 같은 규칙으로 확인된 사실에서만 만든다. 없으면 카드를 숨긴다.
  const actions = isExample ? [] : nextActions(snapshot.kpis, snapshot.datasetMode)

  return (
    // 셸의 스크롤 영역(`main`) 안에서 키보드로 화면을 내릴 수 있도록 포커스를 받는 영역을 둔다.
    // (axe `scrollable-region-focusable` — 읽기 전용 카드만 있는 화면은 탭으로 도달할 곳이 없었다.)
    // 포커스 표시는 링(box-shadow)으로 그린다. `outline-none` 은 `--tw-outline-style: none` 을 남겨
    // 뒤따르는 `outline-2`(=width 만)를 무효로 만들기 때문에(outline 계열 대신) 링을 쓴다.
    <div
      role="region"
      aria-label={`${heading} 화면 내용`}
      tabIndex={0}
      className="mx-auto w-full max-w-2xl space-y-6 rounded-2xl pb-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">확인된 기록만 보여드려요. 숫자가 없으면 이유를 알려드려요.</p>
      </header>

      {/* 조회가 실패한 기간에서도 다른 기간으로 넘어갈 수 있도록 상태 영역 밖에 둔다. */}
      {period && onPeriodChange ? (
        <div role="group" aria-label="성과 기간" className="flex gap-1 rounded-xl bg-muted p-1">
          {RESULTS_PERIOD_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              // 직접 구간이 켜져 있으면 어느 프리셋도 '지금 보는 기간'이 아니다. 둘 다 눌린 것처럼
              // 보이면 '이번 주' 라벨 아래 9월 숫자를 읽게 된다.
              aria-pressed={range == null && period === option.value}
              onClick={() => onPeriodChange(option.value)}
              className="min-h-11 flex-1 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {option.label}
            </button>
          ))}
          {/* onRangeChange 를 받는 화면(실라우트)에만 세 번째 버튼을 붙인다. 예시 화면은 지금과 같은 2버튼. */}
          {onRangeChange ? (
            <button
              type="button"
              aria-pressed={Boolean(range)}
              onClick={() => setRangeSheetOpen(true)}
              className="min-h-11 flex-1 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              직접 선택
            </button>
          ) : null}
        </div>
      ) : null}

      {rangeRejected ? (
        <p role="alert" className="text-sm leading-relaxed text-destructive">
          이 기간의 기록을 불러오지 못했어요. 다른 기간을 골라 주세요.
        </p>
      ) : null}

      {period && onPeriodChange && onRangeChange ? (
        <ResultsRangeSheet
          open={rangeSheetOpen}
          onOpenChange={setRangeSheetOpen}
          value={range ?? null}
          onConfirm={onRangeChange}
        />
      ) : null}

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="detail"
        action={onRetry && kind === 'error' ? (
          <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-secondary px-4 text-sm font-medium text-secondary-foreground">다시 확인하기</button>
        ) : <span className="text-sm text-muted-foreground">{periodText ?? '기간을 확인하지 못했어요'}</span>}
      >
        {periodText ? <p className="text-sm text-muted-foreground" role="status">{periodText}</p> : null}

        {isExample ? (
          <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm leading-relaxed text-muted-foreground" role="status">
            예시 화면이에요. 실제 기록이 확인되면 진짜 값으로 바뀌어요.
          </p>
        ) : null}

        {numbersVisible ? (
          <>
            {snapshot.kpis.filter(kpi => kpiDisplay(kpi, snapshot.datasetMode).kind === 'value').length > 0 ? (
              <ul aria-label="핵심 지표" className="grid grid-cols-2 gap-3">
                {snapshot.kpis
                  .filter(kpi => kpiDisplay(kpi, snapshot.datasetMode).kind === 'value')
                  .map(kpi => (
                    <KpiCard
                      key={kpi.id}
                      kpi={kpi}
                      mode={snapshot.datasetMode}
                      example={isExample}
                      href={kpiHref?.(kpi.id)}
                    />
                  ))}
              </ul>
            ) : null}

            {snapshot.kpis.filter(kpi => kpiDisplay(kpi, snapshot.datasetMode).kind !== 'value').length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {snapshot.kpis.filter(kpi => kpiDisplay(kpi, snapshot.datasetMode).kind === 'value').length === 0
                    ? '아직 확인되지 않았어요. 확인된 지표가 생기면 숫자를 보여드려요.'
                    : '아직 확인되지 않은 지표는 아래에 접어두었어요.'}
                </p>
                <details className="group space-y-2 rounded-2xl border border-dashed border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    확인되지 않은 지표 {snapshot.kpis.filter(kpi => kpiDisplay(kpi, snapshot.datasetMode).kind !== 'value').length}개 보기
                  </summary>
                  <ul aria-label="확인되지 않은 지표" className="grid grid-cols-2 gap-3 pt-2">
                    {snapshot.kpis
                      .filter(kpi => kpiDisplay(kpi, snapshot.datasetMode).kind !== 'value')
                      .map(kpi => (
                        <KpiCard
                          key={kpi.id}
                          kpi={kpi}
                          mode={snapshot.datasetMode}
                          example={isExample}
                          href={kpiHref?.(kpi.id)}
                        />
                      ))}
                  </ul>
                </details>
              </div>
            ) : null}

            {/* 측정된 사실에서만 만든 제안. 만들 것이 없으면 이 카드는 아예 그리지 않는다. */}
            {actions.length ? (
              <section aria-label="다음에 할 일" className="space-y-3 rounded-2xl border border-border bg-card p-4">
                <h2 className="text-base font-semibold">다음에 할 일</h2>
                <ul className="space-y-2.5">
                  {actions.map(action => (
                    <li key={action.id} className="flex flex-col items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm leading-relaxed">
                      <span>{action.text}</span>
                      {action.href ? (
                        <Link
                          href={action.href}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-muted/60 transition-colors"
                        >
                          {action.actionLabel ?? '게시 확인하러 가기'}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-label="금액" className="space-y-2 rounded-2xl border border-border bg-card p-4">
              <h2 className="text-base font-semibold">금액</h2>
              <ul className="divide-y divide-border">
                {rows.map(row => <li key={row.label} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="text-sm text-muted-foreground">{row.label}</span>
                  <span className="flex items-center gap-2 text-right text-base font-semibold">
                    {isExample ? <ExampleBadge /> : null}
                    {row.isEstimate ? <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium leading-none text-secondary-foreground">예상</span> : null}
                    {formatKrw(row.value)}
                  </span>
                </li>)}
              </ul>
              <p className="text-xs leading-relaxed text-muted-foreground">예상 금액과 입금 확인 금액은 합산하지 않아요.</p>
              <p className="text-xs leading-relaxed text-muted-foreground">입금이 확인된 금액만 실제 매출이에요.</p>
            </section>

            <section aria-label="시간 절감" className="space-y-1 rounded-2xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                시간 절감
                {isExample ? <ExampleBadge /> : null}
              </h2>
              <p className="text-base">
                {savedMinutes === null
                  ? <span className="text-muted-foreground">아직 측정하지 않았어요. 기준과 측정 방법이 확인되면 보여드려요.</span>
                  : `이번 기간에 약 ${savedMinutes.toLocaleString('ko-KR')}분을 아꼈어요.`}
              </p>
            </section>
          </>
        ) : (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground" role="status">
            실제 기록이 아니라서 숫자를 보여드리지 않아요.
          </p>
        )}
      </StateView>
    </div>
  )
}

export function resultsScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '성과' }
}

/** 모바일 주간 CEO 보고(/app/reports, 플래그 뒤). 같은 BROWSE 셸 안의 다른 보고 화면이다. */
export function weeklyReportScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '주간 보고' }
}

const KPI_ICONS: Record<KpiId, { Icon: LucideIcon; colorClass: string }> = {
  published: { Icon: Sparkles, colorClass: 'bg-primary/10 text-primary' },
  inquiries: { Icon: MessageCircle, colorClass: 'bg-state-ok-soft text-state-ok' },
  bookings: { Icon: CalendarCheck2, colorClass: 'bg-state-wait-soft text-state-wait' },
  deposits: { Icon: CreditCard, colorClass: 'bg-muted text-foreground' },
}

function KpiCard({
  kpi,
  mode,
  example,
  href,
}: {
  kpi: MobileKpi
  mode: ResultsDatasetMode
  example: boolean
  href?: string
}) {
  const display = kpiDisplay(kpi, mode)
  const isValue = display.kind === 'value'
  const meta = KPI_ICONS[kpi.id]
  const Icon = meta?.Icon
  const cardClass = 'm-press group flex min-h-36 w-full flex-col justify-between rounded-2xl border border-border/80 bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/40'
  const body = (
    <>
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {Icon ? (
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-md ${meta.colorClass}`}>
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          ) : null}
          <span className="truncate text-xs font-semibold text-muted-foreground">
            {KPI_LABEL[kpi.id]}
          </span>
        </div>
        {example ? <ExampleBadge /> : null}
      </div>
      <div className="my-1.5">
        <span className={`break-words tracking-tight ${display.kind === 'value' ? 'text-2xl font-extrabold leading-tight text-foreground' : 'text-base leading-6 text-muted-foreground font-semibold'}`}>
          {display.text}
        </span>
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {isValue ? (
          example ? (
            <span className="text-[11px] font-medium text-muted-foreground">예시 값이에요</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {KPI_EXPLANATION[kpi.id]}
            </span>
          )
        ) : (
          <span className="text-[11px]">확인되지 않은 값</span>
        )}
      </div>
    </>
  )

  // 근거가 어디서 왔는지 화면이 있는 경우에만 카드 전체를 누를 수 있게 한다.
  return (
    <li className="flex">
      {href ? (
        <Link href={href} aria-label={`${KPI_LABEL[kpi.id]} 어디서 확인했는지 보기`} className={`${cardClass} hover:bg-muted/40`}>
          {body}
        </Link>
      ) : (
        <div className={cardClass}>{body}</div>
      )}
    </li>
  )
}

/** 예시 숫자에 붙는 표시. 영문 데이터셋 코드 대신 한국어만 보여준다. */
function ExampleBadge() {
  return (
    <span
      data-example-badge
      className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium leading-none text-secondary-foreground"
    >
      {EXAMPLE_BADGE_LABEL}
    </span>
  )
}

function stateKind(loadState: LoadState): StateKind {
  if (loadState === 'loading') return 'loading'
  if (loadState === 'stale') return 'stale'
  if (loadState === 'error' || loadState === 'unknown') return 'error'
  return 'ready'
}

function describePeriod(kpis: readonly MobileKpi[]): string | null {
  const periods = kpis.map(kpi => kpi.period).filter((period): period is NonNullable<typeof period> => period !== null)
  if (!periods.length) return null
  if (!samePeriod([...kpis])) return '지표마다 기간이 달라 서로 비교할 수 없어요'
  const first = periods[0]
  return `${periodDay(first.start, 'start')} ~ ${periodDay(first.end, 'end')} 기준`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 기간 라벨의 날짜만 남긴다. 실라우트의 `period` 는 ISO 전체 시각이고 `end` 는 **배타 끝**
 * (종료일 다음 날 0시)이라 그대로 쓰면 하루 뒤 날짜가 보인다. 종료일은 하루 빼서 마지막으로
 * 포함된 날을 보여준다. 이미 날짜만 있는 값(예시 화면)은 그대로 둔다.
 */
function periodDay(value: string, edge: 'start' | 'end'): string {
  if (!value.includes('T')) return value
  const day = value.slice(0, 10)
  if (edge === 'start') return day
  const time = Date.parse(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(time)) return day
  return new Date(time - DAY_MS).toISOString().slice(0, 10)
}

function formatKrw(value: number | null): string {
  if (value === null) return '확인되지 않음'
  return `${value.toLocaleString('ko-KR')}원`
}
