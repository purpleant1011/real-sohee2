'use client'

import Link from 'next/link'
import { FreshnessLabel, StateChip, StateView, StickyActionBar } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { evidenceRecordOccurredLabel } from './evidence-record-list-state'
import type { ResultsDrilldownLoadKind, ResultsDrilldownMetricState, ResultsDrilldownStateChip } from './results-drilldown-state'
import { KPI_LABEL, type KpiId } from './results-model'

export interface ResultsDrilldownRecord {
  summary: string
  occurredAt?: string | null
  kindLabel?: string | null
}

/**
 * M20 근거 드릴다운 화면 DTO. 화면은 조회를 모르고 여기 담긴 '확인된 사실'만 그린다.
 * 숫자·출처·기간은 서버 관측이 OBSERVED 일 때만 값이 채워진다.
 */
export interface ResultsDrilldownSnapshot {
  loadKind: ResultsDrilldownLoadKind
  /** 없는 주소로 들어오면 null. 그때는 지표 이름을 지어내지 않는다. */
  kpiId: KpiId | null
  chip: ResultsDrilldownStateChip | null
  metricState: ResultsDrilldownMetricState | null
  value: number | null
  /** 이 숫자를 뒷받침하는 기록 수. 기록 id(UUID)는 화면에 내보내지 않는다. */
  evidenceCount: number
  sourceLabel: string | null
  periodLabel: string | null
  /** 리포트가 ACTUAL 데이터셋인지. 아니면 숫자를 보여주지 않는다. */
  datasetVerified: boolean
  /** 지표 원천 자체가 연결되어 있는지(고객 문의는 댓글 수와 다른 값이라 연결하지 않았다). */
  metricConnected: boolean
  checkedAt: string | null
  stale: boolean
  recentRecords?: readonly ResultsDrilldownRecord[]
  recentRecordsState?: 'available' | 'unavailable' | 'error'
  onRetry?: () => void
}

const FALLBACK_TITLE = '성과 자세히'

export function resultsDrilldownScreenConfig(kpiId: KpiId | null): ShellScreenConfig {
  return { mode: 'DETAIL', title: kpiId ? KPI_LABEL[kpiId] : FALLBACK_TITLE }
}

/**
 * M20 드릴다운 본문. 성과 화면의 숫자에서 '어디서 확인했나요?'로 들어왔을 때
 * 출처·기간·확인 시각을 보여주고, 근거가 없으면 0 대신 이유를 말한다.
 */
export function ResultsDrilldownView({
  snapshot,
  /** 확인된 숫자의 근거 기록 목록 주소. 플래그 OFF 이거나 확인된 숫자가 없으면 null 이다. */
  evidenceHref,
}: {
  snapshot: ResultsDrilldownSnapshot
  evidenceHref?: string | null
}) {
  const label = snapshot.kpiId ? KPI_LABEL[snapshot.kpiId] : FALLBACK_TITLE
  const ready = snapshot.loadKind === 'ready'
  const retry = snapshot.onRetry ? (
    <button
      type="button"
      onClick={snapshot.onRetry}
      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-muted px-4 text-sm font-medium text-foreground"
    >
      다시 확인하기
    </button>
  ) : null

  const backAction = (
    <Link
      href="/app/results"
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
    >
      목록으로 돌아가기
    </Link>
  )

  const errorAction = (
    <div className="flex w-full flex-col gap-2">
      {retry}
      {backAction}
    </div>
  )

  return (
    // 셸의 스크롤 영역 안에서 키보드로 내려갈 수 있게 포커스를 받는 영역을 둔다
    // (axe `scrollable-region-focusable`). 확인된 상태는 누를 것이 없어 탭 도달 지점이 없었다.
    <div
      role="region"
      aria-label="근거 상세 내용"
      tabIndex={0}
      className="mx-auto w-full max-w-2xl space-y-4 rounded-2xl pb-24 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
        <p className="text-base leading-6 text-muted-foreground">이 숫자를 어디서 확인했는지 보여드려요.</p>
        {snapshot.chip ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StateChip kind={snapshot.chip.kind} label={snapshot.chip.label} />
          </div>
        ) : null}
      </header>

      {snapshot.loadKind === 'loading' ? (
        <StateView kind="loading" skeleton="detail" skeletonRows={3} />
      ) : snapshot.loadKind === 'missing' ? (
        <StateView
          kind="confirmed_empty"
          title="그런 성과 항목을 찾지 못했어요"
          description="주소가 바뀌었거나 없는 항목이에요."
          action={backAction}
        />
      ) : snapshot.loadKind === 'unauthorized' ? (
        <StateView kind="unauthorized" action={backAction} />
      ) : snapshot.loadKind === 'offline' ? (
        <StateView kind="offline" action={errorAction} />
      ) : snapshot.loadKind === 'error' ? (
        <StateView kind="error" action={errorAction} />
      ) : snapshot.chip?.kind === 'error' ? (
        // 지표 원천 조회만 실패한 경우. 0건으로 바꾸지 않고 숫자 없이 실패를 알린다.
        <StateView kind="error" action={errorAction} />
      ) : (
        <div className="space-y-4">
          <p className="text-base leading-7" role="status">
            {bodyText(snapshot)}
          </p>

          {snapshot.metricState === 'ERROR' ? (
            <div className="pt-2">{backAction}</div>
          ) : null}

          {ready && snapshot.datasetVerified && snapshot.metricState === 'OBSERVED' && !snapshot.stale && snapshot.value !== null ? (
            <p className="text-3xl font-semibold tracking-tight">
              {snapshot.value.toLocaleString('ko-KR')}건
            </p>
          ) : null}

          {ready && snapshot.datasetVerified && snapshot.sourceLabel ? (
            <dl className="divide-y divide-border rounded-2xl border border-border text-sm">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2">
                <dt className="text-muted-foreground">확인한 곳</dt>
                <dd className="text-right font-medium">{snapshot.sourceLabel}</dd>
              </div>
              {snapshot.periodLabel ? (
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <dt className="text-muted-foreground">집계 기간</dt>
                  <dd className="text-right font-medium">{snapshot.periodLabel}</dd>
                </div>
              ) : null}
              {snapshot.metricState === 'OBSERVED' ? (
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <dt className="text-muted-foreground">연결된 기록</dt>
                  <dd className="text-right font-medium">{snapshot.evidenceCount.toLocaleString('ko-KR')}건</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {/* 최근 기록 3~5건 목록 */}
          {snapshot.recentRecords && snapshot.recentRecords.length > 0 ? (
            <section aria-label="최근 기록" className="space-y-2">
              <h2 className="text-base font-semibold">최근 기록</h2>
              <ul aria-label="최근 기록 목록" className="divide-y divide-border rounded-2xl border border-border bg-card">
                {snapshot.recentRecords.slice(0, 5).map((record, index) => {
                  const occurred = record.occurredAt ? evidenceRecordOccurredLabel(record.occurredAt) : null
                  return (
                    <li key={index} className="flex flex-col justify-center gap-0.5 px-3.5 py-2.5">
                      <span className="break-words text-sm font-medium">{record.summary}</span>
                      <span className="break-words text-xs text-muted-foreground">
                        {record.kindLabel ? `${record.kindLabel}` : ''}
                        {occurred ? ` · ${occurred}` : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : ready && snapshot.datasetVerified && snapshot.metricConnected && snapshot.metricState === 'OBSERVED' ? (
            <section aria-label="최근 기록" className="rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center">
              {snapshot.recentRecordsState === 'unavailable' ? (
                <p className="text-sm text-muted-foreground">상세 기록 목록은 아직 제공되지 않아요. 관련 업무 화면에서 결과를 확인해 주세요.</p>
              ) : snapshot.recentRecordsState === 'error' ? (
                <p className="text-sm text-muted-foreground">상세 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p>
              ) : (
                <p className="text-sm text-muted-foreground">확인된 최근 기록이 없어요.</p>
              )}
            </section>
          ) : null}

          {evidenceHref ? (
            // 숫자를 확인한 뒤에만 연다. 기록이 없거나 실패한 상태에서는 목록 대신 위 문구가 이유를 말한다.
            <a
              href={evidenceHref}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-foreground"
            >
              근거 기록 보기
            </a>
          ) : null}

          {snapshot.stale ? <div>{retry}</div> : null}
          <FreshnessLabel checkedAt={snapshot.checkedAt} prefix="서버 확인" />
        </div>
      )}

      <StickyActionBar>
        {drilldownAction(snapshot.kpiId)}
      </StickyActionBar>
    </div>
  )
}

function drilldownAction(kpiId: KpiId | null) {
  switch (kpiId) {
    case 'published':
      return (
        <Link
          href="/app/content"
          className="flex min-h-[var(--m-cta-h)] w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-xs active:bg-primary/90"
        >
          게시 확인하러 가기
        </Link>
      )
    case 'inquiries':
      return (
        <Link
          href="/app/engagement"
          className="flex min-h-[var(--m-cta-h)] w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-xs active:bg-primary/90"
        >
          소통함 확인하러 가기
        </Link>
      )
    case 'bookings':
      return (
        <Link
          href="/app/schedule"
          className="flex min-h-[var(--m-cta-h)] w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-xs active:bg-primary/90"
        >
          예약 일정 확인하러 가기
        </Link>
      )
    case 'deposits':
      return (
        <Link
          href="/app/schedule"
          className="flex min-h-[var(--m-cta-h)] w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-xs active:bg-primary/90"
        >
          예약 장부 확인하러 가기
        </Link>
      )
    default:
      return (
        <Link
          href="/app/results"
          className="flex min-h-[var(--m-cta-h)] w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-xs active:bg-primary/90"
        >
          성과 목록으로 돌아가기
        </Link>
      )
  }
}

/** 근거가 없을 때 0 대신 이유를 말한다. 어떤 경우에도 숫자를 지어내지 않는다. */
function bodyText(s: ResultsDrilldownSnapshot): string {
  if (!s.datasetVerified) return '실제 기록이 아니라서 숫자를 보여드리지 않아요.'
  if (!s.metricConnected) return '고객 문의 집계 준비 중이에요. 새 문의는 소통함에서 볼 수 있어요.'
  if (s.metricState === 'ERROR') return '아직 확인 중이에요. 없는 것이 아니라 확인에 실패한 상태예요.'
  if (s.metricState === 'CONNECTION_REQUIRED') return '지표를 확인하려면 채널 연결이 필요해요.'
  if (s.metricState !== 'OBSERVED') return '근거 기록 연결 중이에요. 연결되면 보여드릴게요.'
  if (s.stale) return '마지막 확인이 오래돼서 숫자를 보여드리지 않아요. 다시 확인해 주세요.'
  return '아래 기록에서 확인한 숫자예요. 확인되지 않은 값은 더하지 않았어요.'
}
