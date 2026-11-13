import type { MobileMetric } from '../mobile-decision/contracts'
import { metricText } from '../mobile-decision/selectors'

/**
 * 모바일 오늘 화면 전용 metricText wrapper.
 * selectors.ts를 변경하지 않고 쉬운 한국어로 치환하며,
 * 유효한 숫자와 evidence 검증은 그대로 metricText에 위임한다.
 */
export function formatTodayMetricText(
  metric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'>,
): string {
  const text = metricText(metric)
  if (text === '근거 확인 필요') return '아직 확인되지 않았어요'
  if (text === '확인 불가') return '불러오지 못했어요'
  if (text === '업데이트 필요') return '다시 확인해 주세요'
  return text
}

const seoulDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
})

function formatSeoulTimePoint(date: Date): string {
  const parts = Object.fromEntries(
    seoulDateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  const month = parts.month ?? ''
  const day = parts.day ?? ''
  const hourNum = parseInt(parts.hour ?? '0', 10)
  const minuteNum = parseInt(parts.minute ?? '0', 10)

  const ampm = hourNum < 12 ? '오전' : '오후'
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12
  const timeStr = minuteNum === 0 ? `${ampm}${hour12}시` : `${ampm}${hour12}시${minuteNum}분`

  return `${month}월${day}일 ${timeStr}`
}

/**
 * metric.period의 실제 구간을 Asia/Seoul 기준으로 정확하게 변환한다.
 * 서버 period.end는 종료 시각 미포함(반개구간 [start, end))이므로,
 * 닫힌구간 오해를 방지하기 위해 종료를 '~전까지'로 정확히 표기한다.
 * invalid/null period인 경우 임의 추정 기간을 생성하지 않고 null을 반환한다.
 */
export function formatPeriodAsiaSeoul(
  period: { start?: string | null; end?: string | null; timeZone?: string | null } | null | undefined,
): string | null {
  if (!period || typeof period.start !== 'string' || typeof period.end !== 'string') {
    return null
  }

  const startMs = Date.parse(period.start)
  const endMs = Date.parse(period.end)

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return null
  }

  const startStr = formatSeoulTimePoint(new Date(startMs))
  const endStr = formatSeoulTimePoint(new Date(endMs))

  return `${startStr}부터 ${endStr} 전까지 (한국 시간)`
}

const UTC_SUFFIX_REGEX = /\s*·\s*([^·]*\(UTC\))\s*$/

export function stripUtcPeriodSuffix(label: string): { baseLabel: string; hasUtcSuffix: boolean } {
  const match = label.match(UTC_SUFFIX_REGEX)
  if (match && typeof match.index === 'number') {
    return {
      baseLabel: label.slice(0, match.index).trim(),
      hasUtcSuffix: true,
    }
  }
  return {
    baseLabel: label,
    hasUtcSuffix: false,
  }
}

/**
 * 모바일 오늘 화면 전용 metric.label wrapper.
 * 단일 metric 기준으로 날짜 UTC suffix만 분리하고 metric.period의 실제 구간을 한국어로 명시한다.
 */
export function formatTodayMetricLabel(
  metric: Pick<MobileMetric, 'label' | 'period'>,
): string {
  const { baseLabel, hasUtcSuffix } = stripUtcPeriodSuffix(metric.label)
  if (hasUtcSuffix) {
    const periodText = formatPeriodAsiaSeoul(metric.period)
    if (periodText) {
      return `${baseLabel} · ${periodText}`
    }
  }
  return baseLabel
}

export interface TodayResultsPresentationItem {
  id?: string
  label: string
}

export interface TodayResultsPresentation {
  commonPeriodText: string | null
  items: TodayResultsPresentationItem[]
}

/**
 * 표시 대상 metric들의 기간 표시 및 라벨 정리를 일괄 결정한다.
 * - 모든 표시 metric의 유효 period가 동일하면 칩 라벨은 짧게 유지하고 하단에 공통 기간 1회만 표시.
 * - 기간이 서로 다르거나 일부 invalid/null이면 합치지 않고 해당 칩에만 개별 기간 또는 미표시(추정 금지).
 */
export function resolveTodayResultsPresentation<T extends Pick<MobileMetric, 'label' | 'period'> & { id?: string }>(
  metrics: readonly T[],
): {
  commonPeriodText: string | null
  items: Array<{ metric: T; label: string }>
} {
  if (metrics.length === 0) {
    return { commonPeriodText: null, items: [] }
  }

  const prepared = metrics.map((metric) => {
    const { baseLabel, hasUtcSuffix } = stripUtcPeriodSuffix(metric.label)
    const periodText = formatPeriodAsiaSeoul(metric.period)
    return { metric, baseLabel, hasUtcSuffix, periodText }
  })

  const allValidAndSame =
    prepared.length > 0 &&
    prepared.every((item) => item.periodText !== null && item.periodText === prepared[0].periodText)

  if (allValidAndSame && prepared[0].periodText) {
    return {
      commonPeriodText: `집계 기간 · ${prepared[0].periodText}`,
      items: prepared.map((item) => ({
        metric: item.metric,
        label: item.baseLabel,
      })),
    }
  }

  return {
    commonPeriodText: null,
    items: prepared.map((item) => {
      let label = item.baseLabel
      if (item.hasUtcSuffix && item.periodText) {
        label = `${item.baseLabel} · ${item.periodText}`
      }
      return {
        metric: item.metric,
        label,
      }
    }),
  }
}
