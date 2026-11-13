'use client'

import { useEffect, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { observationTruth, type ReportingObservation } from '@/features/reporting/observation'
import { isEvidenceListR2Enabled } from './evidence-list-flag'
import {
  isResultsDrilldownKey,
  isResultsDrilldownStale,
  resultsDrilldownPeriodLabel,
  resultsDrilldownSourceLabel,
  resultsDrilldownStateChip,
  type ResultsDrilldownLoadKind,
  type ResultsDrilldownMetricState,
} from './results-drilldown-state'
import { ResultsDrilldownView, resultsDrilldownScreenConfig, type ResultsDrilldownSnapshot } from './results-drilldown-view'
import type { KpiId } from './results-model'
import { DEFAULT_RESULTS_PERIOD, resultsPeriodSearch, type ResultsPeriod, type ResultsRange } from './results-period'
import { isEvidenceRecordMetric } from './server/evidence-record-dto'
import { KPI_METRIC, isWeeklyReport } from './server/results-snapshot'

/** 기기가 네트워크에 붙어 있는지. 판정할 수 없는 환경(SSR·구형 브라우저)은 오프라인으로 단정하지 않는다. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

type DrilldownState = Omit<ResultsDrilldownSnapshot, 'chip'>

const EMPTY: Omit<DrilldownState, 'loadKind' | 'kpiId'> = {
  metricState: null,
  value: null,
  evidenceCount: 0,
  sourceLabel: null,
  periodLabel: null,
  datasetVerified: true,
  metricConnected: true,
  checkedAt: null,
  stale: false,
  recentRecords: [],
  recentRecordsState: 'unavailable',
}

/**
 * M20 근거 드릴다운 — R2 셸 배선(플래그 뒤).
 * 기존 `GET /api/workspaces/:id/reports/weekly` 읽기만 재사용하며 새 API·쓰기 경로를 만들지 않는다.
 * `:id` 는 지표 키이고, 리포트 조회 응답에 저장된 보고서 id 가 없으므로 기간 id 를 지어내지 않는다.
 */
export function R2ResultsDrilldown({
  workspaceId,
  metricId,
  period = DEFAULT_RESULTS_PERIOD,
  range = null,
}: {
  workspaceId: string
  metricId: string
  /** 성과 화면에서 보던 기간. 같은 읽기 API 의 `?period=previous` 로만 전달한다. */
  period?: ResultsPeriod
  /** 성과 화면에서 보던 직접 선택 구간. 있으면 구간 쿼리만 쓴다(period 와 함께 보내지 않는다). */
  range?: ResultsRange | null
}) {
  // 없는 주소는 지표 이름을 지어내지 않는다.
  const kpiId: KpiId | null = isResultsDrilldownKey(metricId) ? metricId : null
  const [state, setState] = useState<DrilldownState>(() => ({
    ...EMPTY,
    loadKind: 'loading',
    kpiId,
  }))
  const [reloadToken, setReloadToken] = useState(0)
  // effect 의존성은 객체가 아니라 문자열 두 개로 둔다.
  const rangeStart = range?.start ?? null
  const rangeEnd = range?.end ?? null

  useEffect(() => {
    let cancelled = false
    const apply = (next: DrilldownState) => {
      if (!cancelled) setState(next)
    }
    // 없는 지표 주소는 조회할 것도 없다. 서버 판정이 아니라 '그런 항목 없음'이다.
    if (!kpiId) {
      apply({ ...EMPTY, loadKind: 'missing', kpiId: null })
      return () => { cancelled = true }
    }
    const key = KPI_METRIC[kpiId]
    const rangeQuery = rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null
    const load = async () => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/reports/weekly${resultsPeriodSearch(period, rangeQuery)}`,
        { cache: 'no-store' },
      )
      if (res.status === 401 || res.status === 403) return apply({ ...EMPTY, loadKind: 'unauthorized', kpiId })
      if (!res.ok) return apply({ ...EMPTY, loadKind: 'error', kpiId })
      const payload: unknown = await res.json().catch(() => null)
      // 다른 가게 응답이거나 모양이 깨졌으면 숫자를 하나도 그리지 않는다.
      if (!isWeeklyReport(payload) || payload.workspaceId !== workspaceId) {
        return apply({ ...EMPTY, loadKind: 'error', kpiId })
      }
      const observation: ReportingObservation | undefined = key ? payload.metrics?.[key] : undefined
      // 성과 요약과 같은 게이트를 여기에도 건다. 출처까지 확인된 관측만 숫자가 되고,
      // 출처 없는 OBSERVED 값은 근거 미연결로 내려 숫자를 하나도 그리지 않는다.
      const truth = observationTruth(observation)
      const confirmed = truth.value !== null
      const metricState: ResultsDrilldownMetricState | null = confirmed
        ? 'OBSERVED'
        : observation?.state === 'OBSERVED'
          ? 'NOT_OBSERVED'
          : ((observation?.state ?? null) as ResultsDrilldownMetricState | null)
      let recentRecords: readonly { summary: string; occurredAt?: string | null; kindLabel?: string | null }[] = []
      let recentRecordsState: 'available' | 'unavailable' | 'error' = 'unavailable'
      if (kpiId && isEvidenceRecordMetric(kpiId)) {
        if (!isEvidenceListR2Enabled()) {
          recentRecordsState = 'unavailable'
        } else {
          try {
            const evidenceRes = await fetch(
              `/api/workspaces/${encodeURIComponent(workspaceId)}/results/${encodeURIComponent(kpiId)}/evidence${resultsPeriodSearch(period, rangeQuery)}`,
              { cache: 'no-store' },
            )
            if (evidenceRes.ok) {
              const evData = await evidenceRes.json().catch(() => null)
              if (evData && Array.isArray(evData.records) && evData.state === 'OBSERVED') {
                recentRecordsState = 'available'
                recentRecords = evData.records.map((r: { summary: string; occurredAt?: string; kindLabel?: string }) => ({
                  summary: r.summary,
                  occurredAt: r.occurredAt ?? null,
                  kindLabel: r.kindLabel ?? null,
                }))
              } else {
                recentRecordsState = 'error'
              }
            } else {
              recentRecordsState = 'error'
            }
          } catch {
            recentRecordsState = 'error'
          }
        }
      }

      apply({
        ...EMPTY,
        loadKind: 'ready',
        kpiId,
        metricState,
        value: truth.value,
        evidenceCount: confirmed && Array.isArray(observation?.evidenceIds) ? observation.evidenceIds.length : 0,
        sourceLabel: confirmed && truth.source ? resultsDrilldownSourceLabel(truth.source) : null,
        // 지표가 없는 KPI(고객 문의)도 '언제 집계했는지'는 말할 수 있다.
        periodLabel: resultsDrilldownPeriodLabel(observation?.period ?? payload.period),
        datasetVerified: payload.datasetMode === 'ACTUAL',
        metricConnected: key !== null,
        checkedAt: payload.generatedAt,
        stale: isResultsDrilldownStale(payload.generatedAt, Date.now()),
        recentRecords,
        recentRecordsState,
      })
    }
    // 네트워크가 끊긴 실패는 '확인 실패'와 다르다.
    load().catch(() => apply({ ...EMPTY, loadKind: isOffline() ? 'offline' : 'error', kpiId }))
    return () => { cancelled = true }
  }, [workspaceId, metricId, kpiId, reloadToken, period, rangeStart, rangeEnd])

  const retry = () => {
    setState({ ...EMPTY, loadKind: 'loading', kpiId })
    setReloadToken((token) => token + 1)
  }

  // 칩은 '조회가 어디까지 확인됐는지'만 말한다. 확인된 전체일 때만 칩이 없다.
  const chip = resultsDrilldownStateChip({
    loadKind: state.loadKind as ResultsDrilldownLoadKind,
    metricState: state.metricState,
    metricConnected: state.metricConnected,
    datasetVerified: state.datasetVerified,
    generatedAt: state.checkedAt,
  })

  // 근거 기록 목록은 플래그 뒤의 페이지다. 플래그 OFF 면 없는 주소로 보내지 않는다.
  // 확인된 숫자(출처·기간·확인 시각이 맞는 OBSERVED)와 연결된 기록이 있을 때만 연다.
  const evidenceHref = isEvidenceListR2Enabled()
    && kpiId
    && state.loadKind === 'ready'
    && state.datasetVerified
    && state.metricState === 'OBSERVED'
    && !state.stale
    && state.value !== null
    && state.evidenceCount > 0
    ? `/app/results/${encodeURIComponent(kpiId)}/evidence${resultsPeriodSearch(period)}`
    : null

  const { mode, title } = resultsDrilldownScreenConfig(kpiId)
  const backSearch = resultsPeriodSearch(period, rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null)
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title} backHref={`/app/results${backSearch}`}>
        <ResultsDrilldownView snapshot={{ ...state, chip, onRetry: retry }} evidenceHref={evidenceHref} />
      </ShellScreen>
    </MobileAppShell>
  )
}
