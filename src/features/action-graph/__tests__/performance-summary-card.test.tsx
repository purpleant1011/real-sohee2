import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PerformanceSummaryCard, type PerformanceSummaryCardData } from '../event-cards'

describe('PerformanceSummaryCard', () => {
  it('renders marketing performance metrics and estimated savings accurately', () => {
    const cardData: PerformanceSummaryCardData = {
      period: '최근 7일 기준',
      postsCount: 4,
      inquiriesCount: 6,
      reservationsCount: 2,
      estimatedSavingsWon: 350000,
      topPostTopic: '가을 제철 신메뉴',
      summaryComment: '소희와 함께 마케팅 대행비 ₩350,000을 절감하셨어요.',
    }

    render(<PerformanceSummaryCard card={cardData} />)

    expect(screen.getByTestId('event-card-performance-summary')).toBeInTheDocument()
    expect(screen.getByText('주간 성과 리포트')).toBeInTheDocument()
    expect(screen.getByText('4건')).toBeInTheDocument()
    expect(screen.getByText('6건')).toBeInTheDocument()
    expect(screen.getByText('2건')).toBeInTheDocument()
    expect(screen.getByText('₩350,000')).toBeInTheDocument()
    expect(screen.getByText('가을 제철 신메뉴')).toBeInTheDocument()
    expect(screen.getByText('자세한 성과 그래프 확인하기')).toBeInTheDocument()

    expect(screen.queryByText('1초 CRM 연동')).not.toBeInTheDocument()
    expect(screen.getByText('CRM 연동')).toBeInTheDocument()
  })
})
