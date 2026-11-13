import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OperationsBoard } from './operations-board'
import PricingPage from '@/app/(public)/pricing/page'

describe('OperationsBoard', () => {
  it('shows the five approval-aware marketing operations steps as example data', () => {
    render(<OperationsBoard />)

    expect(screen.getAllByText('예시 데이터').length).toBeGreaterThan(0)
    expect(screen.getByText('트렌드 발견')).toBeInTheDocument()
    expect(screen.getByText('콘텐츠 초안')).toBeInTheDocument()
    expect(screen.getByText('사장님 승인')).toBeInTheDocument()
    expect(screen.getByText('채널 게시')).toBeInTheDocument()
    expect(screen.getByText('댓글·성과')).toBeInTheDocument()
  })
})

describe('PricingPage', () => {
  it('discloses tax, advertising costs, and that payments are not connected', () => {
    render(<PricingPage />)

    expect(screen.getByText('광고비 별도')).toBeInTheDocument()
    expect(screen.getByText(/부가가치세를 포함한 최종 결제금액/)).toBeInTheDocument()
    expect(screen.queryByText('VAT 별도')).not.toBeInTheDocument()
    expect(screen.getByText(/결제는 아직 연결되지 않았습니다/)).toBeInTheDocument()
  })
})
