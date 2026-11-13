import { describe, expect, it } from 'vitest'
import type { MobileMetric } from '../mobile-decision/contracts'
import {
  formatPeriodAsiaSeoul,
  formatTodayMetricLabel,
  formatTodayMetricText,
  resolveTodayResultsPresentation,
} from './today-metric-presentation'

describe('today-metric-presentation', () => {
  describe('formatTodayMetricText', () => {
    it('근거 확인 필요를 "아직 확인되지 않았어요"로 변환한다', () => {
      const metric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        state: 'ready',
        value: null,
        unit: '건',
        evidenceRef: null,
        source: null,
        datasetMode: 'ACTUAL',
        period: null,
      }
      expect(formatTodayMetricText(metric)).toBe('아직 확인되지 않았어요')
    })

    it('확인 불가를 "불러오지 못했어요"로 변환한다', () => {
      const metric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        state: 'error',
        value: null,
        unit: '건',
        evidenceRef: null,
        source: null,
        datasetMode: 'ACTUAL',
        period: null,
      }
      expect(formatTodayMetricText(metric)).toBe('불러오지 못했어요')
    })

    it('업데이트 필요를 "다시 확인해 주세요"로 변환한다', () => {
      const metric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        state: 'stale',
        value: 10,
        unit: '건',
        evidenceRef: 'ev-1',
        source: 'Instagram',
        datasetMode: 'ACTUAL',
        period: { start: '2026-11-01', end: '2026-11-06', timeZone: 'Asia/Seoul' },
      }
      expect(formatTodayMetricText(metric)).toBe('다시 확인해 주세요')
    })

    it('확인 중 상태는 그대로 "확인 중"을 유지한다', () => {
      const metric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        state: 'loading',
        value: null,
        unit: '건',
        evidenceRef: null,
        source: null,
        datasetMode: 'ACTUAL',
        period: null,
      }
      expect(formatTodayMetricText(metric)).toBe('확인 중')
    })

    it('검증된 실제 값은 metricText 숫자 및 단위를 그대로 유지한다 (미확인값 숫자 숨김)', () => {
      const validMetric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        state: 'ready',
        value: 12,
        unit: '건',
        evidenceRef: 'ev-1',
        source: 'Instagram Graph API',
        datasetMode: 'ACTUAL',
        period: { start: '2026-11-01', end: '2026-11-06', timeZone: 'Asia/Seoul' },
      }
      expect(formatTodayMetricText(validMetric)).toBe('12건')

      // 0건도 정상 검증된 실제 값이면 0건 유지
      const zeroMetric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        ...validMetric,
        value: 0,
      }
      expect(formatTodayMetricText(zeroMetric)).toBe('0건')

      // 출처가 누락되어 검증되지 않은 값은 숫자를 절대 노출하지 않는다
      const unverifiedMetric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'> = {
        ...validMetric,
        source: '',
      }
      expect(formatTodayMetricText(unverifiedMetric)).toBe('아직 확인되지 않았어요')
    })
  })

  describe('formatPeriodAsiaSeoul', () => {
    it('종료 시각 미포함 원칙에 따라 종료를 "~전까지"로 정확히 표기한다', () => {
      const period = {
        start: '2026-10-31T00:00:00.000Z',
        end: '2026-11-07T00:00:00.000Z',
        timeZone: 'UTC',
      }
      expect(formatPeriodAsiaSeoul(period)).toBe(
        '10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)',
      )
    })

    it('시/분이 0이 아닌 경우도 종료 미포함 한국 시간 기준 정확한 시간으로 변환한다', () => {
      const period = {
        start: '2026-10-31T05:30:00.000Z', // UTC 05:30 -> KST 14:30 (오후 2시 30분)
        end: '2026-11-07T12:00:00.000Z', // UTC 12:00 -> KST 21:00 (오후 9시)
        timeZone: 'UTC',
      }
      expect(formatPeriodAsiaSeoul(period)).toBe(
        '10월31일 오후2시30분부터 11월7일 오후9시 전까지 (한국 시간)',
      )
    })

    it('null 또는 invalid period는 추정하지 않고 null을 반환한다', () => {
      expect(formatPeriodAsiaSeoul(null)).toBeNull()
      expect(formatPeriodAsiaSeoul(undefined)).toBeNull()
      expect(formatPeriodAsiaSeoul({ start: 'invalid', end: '2026-11-07', timeZone: 'UTC' })).toBeNull()
      expect(formatPeriodAsiaSeoul({ start: '2026-11-07', end: '2026-10-31', timeZone: 'UTC' })).toBeNull() // start >= end
    })
  })

  describe('formatTodayMetricLabel', () => {
    it('단일 metric의 UTC suffix를 분리하고 종료 미포함 기간으로 변환한다', () => {
      const metric = {
        label: '게시 확인 · 2026-10-31 ~ 2026-11-07 (UTC)',
        period: {
          start: '2026-10-31T00:00:00.000Z',
          end: '2026-11-07T00:00:00.000Z',
          timeZone: 'UTC',
        },
      }
      expect(formatTodayMetricLabel(metric)).toBe(
        '게시 확인 · 10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)',
      )
    })
  })

  describe('resolveTodayResultsPresentation', () => {
    const periodA = {
      start: '2026-10-31T00:00:00.000Z',
      end: '2026-11-07T00:00:00.000Z',
      timeZone: 'UTC',
    }

    it('모든 표시 metric의 유효 period가 동일하면 칩 라벨을 짧게 유지하고 공통 집계 기간 1회를 도출한다', () => {
      const metrics = [
        { label: '게시 확인 · 2026-10-31 ~ 2026-11-07 (UTC)', period: periodA },
        { label: '현재 확정 예약 · 2026-10-31 ~ 2026-11-07 (UTC)', period: periodA },
        { label: '확인된 매출 · 채널 연결 필요 · 2026-10-31 ~ 2026-11-07 (UTC)', period: periodA },
      ]

      const result = resolveTodayResultsPresentation(metrics)

      // 공통 집계 기간 1회 노출
      expect(result.commonPeriodText).toBe(
        '집계 기간 · 10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)',
      )

      // 칩 라벨은 짧게 유지하면서 채널 연결 필요 문구 보존
      expect(result.items[0].label).toBe('게시 확인')
      expect(result.items[1].label).toBe('현재 확정 예약')
      expect(result.items[2].label).toBe('확인된 매출 · 채널 연결 필요')
    })

    it('서로 다른 period가 섞여있으면 한 기간으로 합치지 않고 해당 칩에만 개별 기간을 표시한다', () => {
      const periodB = {
        start: '2026-10-20T00:00:00.000Z',
        end: '2026-10-27T00:00:00.000Z',
        timeZone: 'UTC',
      }
      const metrics = [
        { label: '게시 확인 · 2026-10-20 ~ 2026-10-27 (UTC)', period: periodB },
        { label: '현재 확정 예약 · 2026-10-31 ~ 2026-11-07 (UTC)', period: periodA },
      ]

      const result = resolveTodayResultsPresentation(metrics)

      expect(result.commonPeriodText).toBeNull()
      expect(result.items[0].label).toBe(
        '게시 확인 · 10월20일 오전9시부터 10월27일 오전9시 전까지 (한국 시간)',
      )
      expect(result.items[1].label).toBe(
        '현재 확정 예약 · 10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)',
      )
    })

    it('일부 period가 null/invalid이면 합치지 않고 해당 칩에는 추정 기간을 표시하지 않는다', () => {
      const metrics = [
        { label: '게시 확인 · 2026-10-31 ~ 2026-11-07 (UTC)', period: periodA },
        { label: '현재 확정 예약 · 2026-10-31 ~ 2026-11-07 (UTC)', period: null },
      ]

      const result = resolveTodayResultsPresentation(metrics)

      expect(result.commonPeriodText).toBeNull()
      expect(result.items[0].label).toBe(
        '게시 확인 · 10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)',
      )
      expect(result.items[1].label).toBe('현재 확정 예약')
    })

    it('기존 커스텀 라벨은 날짜 suffix가 없으면 그대로 보존된다', () => {
      const metrics = [
        { label: '발행한 글', period: periodA },
        { label: '예약 확정', period: periodA },
      ]

      const result = resolveTodayResultsPresentation(metrics)

      expect(result.commonPeriodText).toBe(
        '집계 기간 · 10월31일 오전9시부터 11월7일 오전9시 전까지 (한국 시간)',
      )
      expect(result.items[0].label).toBe('발행한 글')
      expect(result.items[1].label).toBe('예약 확정')
    })
  })
})
