import { describe, expect, it } from 'vitest'
import {
  evaluateDashboardMetrics,
  formatConversionText,
  formatRevenueText,
  type DashboardMetricsInput,
} from './home-dashboard-summary'

describe('home-dashboard-summary (결정 우선형 홈 근거 기반 집계)', () => {
  it('게시물 목록이나 파이프라인 데이터가 null/오류일 때 가짜 0건이 아닌 null/오류 상태를 반환한다', () => {
    const input: DashboardMetricsInput = {
      posts: null,
      postsError: true,
      pipelineData: null,
      pipelineError: true,
      approvalsSummary: null,
    }

    const result = evaluateDashboardMetrics(input)

    expect(result.published.hasError).toBe(true)
    expect(result.published.value).toBeNull()
    expect(result.published.label).toBe('게시 확인')

    expect(result.confirmedBookings.hasError).toBe(true)
    expect(result.confirmedBookings.value).toBeNull()
    expect(result.confirmedBookings.label).toBe('확인된 예약')
  })

  it('게시물이 정상 조회된 경우 PUBLISHED_VERIFIED 등 실제 확인된 게시물만 집계한다 (가짜 수치 대체 없음)', () => {
    const input: DashboardMetricsInput = {
      posts: [
        { status: 'PUBLISHED_VERIFIED', missionId: '1', createdAt: '2026-10-16' },
        { status: 'PUBLISHED_VERIFIED', missionId: '2', createdAt: '2026-10-15' },
        { status: 'AWAITING_APPROVAL', missionId: '3', createdAt: '2026-10-14' },
        { status: 'DRAFT', missionId: '4', createdAt: '2026-10-13' },
      ],
      postsError: false,
      pipelineData: { inquiryCount: 3, bookedCount: 1 },
      pipelineError: false,
      approvalsSummary: { total: 3, comments: 1, posts: 2, dms: 0, proposals: 0 },
    }

    const result = evaluateDashboardMetrics(input)

    expect(result.published.hasError).toBe(false)
    expect(result.published.value).toBe(2)
    expect(result.published.subtext).toContain('게시 근거 확인됨')

    expect(result.confirmedBookings.hasError).toBe(false)
    expect(result.confirmedBookings.value).toBe(1)
    expect(result.confirmedBookings.subtext).toContain('예약 기록 기준')

    expect(result.activeTasks.hasError).toBe(false)
    // 소희가 하는 일: 대기 중인 승인 3건 기준
    expect(result.activeTasks.value).toBe(3)
  })

  it('문의 및 예약 전환율 텍스트 포맷 검증: 실제 데이터가 있을 때와 없을 때', () => {
    expect(formatConversionText(3, 1)).toBe('3 → 1건')
    expect(formatConversionText(0, 0)).toBe('0 → 0건')
    expect(formatConversionText(null, null)).toBe('기록 확인 중')
  })

  it('확인된 매출은 외부 결제/POS 실연동이 없으면 정직하게 "결제 내역 연결 필요"를 반환한다 (추정치 하드코딩 금지)', () => {
    expect(formatRevenueText({ hasPaymentConnected: false })).toBe('결제 내역 연결 필요')
    expect(formatRevenueText({ hasPaymentConnected: true, verifiedRevenueKrw: 150000 })).toBe('150,000원')
  })
})
