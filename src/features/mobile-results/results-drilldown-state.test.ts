import { describe, expect, it } from 'vitest'
import {
  RESULTS_DRILLDOWN_KEYS,
  RESULTS_DRILLDOWN_STALE_AFTER_MINUTES,
  isResultsDrilldownKey,
  isResultsDrilldownStale,
  resultsDrilldownPeriodLabel,
  resultsDrilldownSourceLabel,
  resultsDrilldownStateChip,
} from './results-drilldown-state'

const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const MINUTE = 60_000

describe('M20 근거 드릴다운 판정', () => {
  it('드릴다운은 지표 키 4개만 있다', () => {
    expect([...RESULTS_DRILLDOWN_KEYS]).toEqual(['published', 'inquiries', 'bookings', 'deposits'])
    for (const key of RESULTS_DRILLDOWN_KEYS) expect(isResultsDrilldownKey(key)).toBe(true)
    for (const other of ['', 'revenue', 'weekly-1', 'PUBLISHED']) expect(isResultsDrilldownKey(other)).toBe(false)
  })

  it('생성 시각이 기준을 넘으면 stale 이고, 없거나 읽을 수 없으면 단정하지 않는다', () => {
    const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString()
    expect(isResultsDrilldownStale(at(RESULTS_DRILLDOWN_STALE_AFTER_MINUTES), NOW)).toBe(false)
    expect(isResultsDrilldownStale(at(RESULTS_DRILLDOWN_STALE_AFTER_MINUTES + 1), NOW)).toBe(true)
    expect(isResultsDrilldownStale(null, NOW)).toBe(false)
    expect(isResultsDrilldownStale(undefined, NOW)).toBe(false)
    expect(isResultsDrilldownStale('어제', NOW)).toBe(false)
  })

  it('관측 출처는 내부 경로 대신 사장님이 읽는 이름으로 옮긴다', () => {
    expect(resultsDrilldownSourceLabel('reservations.created_at/current_status')).toBe('예약 장부')
    expect(resultsDrilldownSourceLabel('external_action_receipts.independent_publish_readback')).toBe('게시 확인 근거 기록')
    expect(resultsDrilldownSourceLabel('external_action_receipts.transport')).toBe('게시 확인 대기 기록')
    expect(resultsDrilldownSourceLabel('publish_attempts.finished_at/permalink_readback')).toBe('공식 게시 링크 확인 기록')
    expect(resultsDrilldownSourceLabel('external_action_receipts.recorded_at+publish_attempts.finished_at/independent_publish_readback')).toBe('외부 확인 영수증 및 공식 게시 링크 기록')
    expect(resultsDrilldownSourceLabel('social_comments.thread_key')).toBe('저장된 댓글 기록')
    expect(resultsDrilldownSourceLabel('unknown.table')).toBe('확인 근거 기록')
    expect(resultsDrilldownSourceLabel('reservations.created_at/current_status')).not.toContain('reservations')
  })

  it('기간은 날짜와 기준 시간대를 함께 밝힌다', () => {
    expect(resultsDrilldownPeriodLabel({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-10-08T00:00:00.000Z',
    })).toBe('2026.10.01 ~ 2026.10.08 (한국 시간 기준)')
  })

  describe('5상태 칩', () => {
    const ready = { loadKind: 'ready' as const, metricState: 'OBSERVED' as const, generatedAt: '2026-10-24T11:59:00.000Z', now: NOW }

    it('조회 중·실패·오프라인은 각각의 칩이다', () => {
      expect(resultsDrilldownStateChip({ loadKind: 'loading' })).toEqual({ kind: 'loading' })
      expect(resultsDrilldownStateChip({ loadKind: 'error' })).toEqual({ kind: 'error' })
      expect(resultsDrilldownStateChip({ loadKind: 'offline' })).toEqual({ kind: 'offline' })
    })

    it('없는 주소·권한 없음은 칩이 아니라 화면이 판정한다', () => {
      expect(resultsDrilldownStateChip({ loadKind: 'missing' })).toBeNull()
      expect(resultsDrilldownStateChip({ loadKind: 'unauthorized' })).toBeNull()
    })

    it('실제 기록이 아니면 숫자보다 먼저 그 사실을 말한다', () => {
      expect(resultsDrilldownStateChip({ ...ready, datasetVerified: false })).toEqual({ kind: 'partial', label: '실제 기록이 아니에요' })
      // 데이터셋이 아니라는 사실이 조회 실패보다 우선한다(숫자를 만들 수 없는 이유가 더 근본적).
      expect(resultsDrilldownStateChip({ ...ready, datasetVerified: false, metricState: 'ERROR' })).toEqual({ kind: 'partial', label: '실제 기록이 아니에요' })
    })

    it('집계하지 않는 지표는 근거 없음과 다르게 말한다', () => {
      expect(resultsDrilldownStateChip({ ...ready, metricConnected: false, metricState: null })).toEqual({ kind: 'partial', label: '이 숫자는 집계하지 않아요' })
    })

    it('조회 실패는 0건이 아니라 실패다', () => {
      expect(resultsDrilldownStateChip({ ...ready, metricState: 'ERROR' })).toEqual({ kind: 'error' })
    })

    it('원천 미연결은 조회 실패가 아니라 근거 없음이다', () => {
      expect(resultsDrilldownStateChip({ ...ready, metricState: 'CONNECTION_REQUIRED' })).toEqual({ kind: 'partial', label: '채널 연결 후 확인할 수 있어요' })
      expect(resultsDrilldownStateChip({ ...ready, metricState: 'NOT_OBSERVED' })).toEqual({ kind: 'partial', label: '근거가 연결되지 않았어요' })
    })

    it('확인된 관측이 오래되면 stale 이고, 최신이면 칩이 없다', () => {
      expect(resultsDrilldownStateChip(ready)).toBeNull()
      expect(resultsDrilldownStateChip({
        ...ready,
        generatedAt: new Date(NOW - (RESULTS_DRILLDOWN_STALE_AFTER_MINUTES + 5) * MINUTE).toISOString(),
      })).toEqual({ kind: 'stale' })
    })

    it('연결 여부를 모르면(undefined) 연결 끊김으로 단정하지 않는다', () => {
      expect(resultsDrilldownStateChip({ ...ready, metricConnected: undefined })).toBeNull()
    })
  })
})
