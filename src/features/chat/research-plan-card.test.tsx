import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResearchPlanCard } from './research-plan-card'
import type { ResearchPlan } from './research-flow-model'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

describe('ResearchPlanCard', () => {
  const samplePlan: ResearchPlan = {
    summary: '인천 청라 30대 타깃 네이버 블로그 및 인스타그램 홍보 계획',
    direction: [
      '자연스러운 상담 전후 스토리 중심 전개',
      '네이버 블로그 1건 + 인스타그램 카드뉴스 1건 발행',
    ],
    tasks: [
      { id: 't1', title: '블로그 키워드 분석 및 제목 선정', channel: 'naver_blog', estimatedCredits: 2 },
      { id: 't2', title: '블로그 원고 본문 작성', detail: '전문성 강조 및 상담 CTA', channel: 'naver_blog', estimatedCredits: 5 },
      { id: 't3', title: '인스타그램 카드뉴스 이미지 생성', detail: '30대 타깃 밝은 톤앤매너', channel: 'instagram', estimatedCredits: 3 },
    ],
    totalCredits: 10,
  }

  it('renders title, summary, direction bullets, and numbered tasks', () => {
    render(<ResearchPlanCard plan={samplePlan} />)

    expect(screen.getByText('이 방향으로 진행할게요')).toBeInTheDocument()
    expect(screen.getByText(samplePlan.summary)).toBeInTheDocument()
    expect(screen.getByText('자연스러운 상담 전후 스토리 중심 전개')).toBeInTheDocument()
    expect(screen.getByText('네이버 블로그 1건 + 인스타그램 카드뉴스 1건 발행')).toBeInTheDocument()

    // Tasks preview
    expect(screen.getByText('블로그 키워드 분석 및 제목 선정')).toBeInTheDocument()
    expect(screen.getByText('블로그 원고 본문 작성')).toBeInTheDocument()
    expect(screen.getByText('전문성 강조 및 상담 CTA')).toBeInTheDocument()
    expect(screen.getByText('인스타그램 카드뉴스 이미지 생성')).toBeInTheDocument()
  })

  it('hides credits line and task estimatedCredits even when totalCredits is provided on desktop', () => {
    const { container } = render(<ResearchPlanCard plan={samplePlan} />)
    expect(screen.queryByText('예상 필요 크레딧')).not.toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('SC')
    expect(container.textContent).not.toContain('차감')
  })

  it('hides all credit amounts when mobile R2 is active', () => {
    const { container } = render(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <ResearchPlanCard plan={samplePlan} />
      </MobileR2Provider>,
    )
    expect(screen.queryByText('예상 필요 크레딧')).not.toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('크레딧')
    expect(container.textContent).not.toContain('SC')
    expect(container.textContent).not.toContain('차감')
  })

  it('does NOT show credits line when totalCredits is undefined', () => {
    const planWithoutCredits: ResearchPlan = {
      ...samplePlan,
      totalCredits: undefined,
    }
    render(<ResearchPlanCard plan={planWithoutCredits} />)
    expect(screen.queryByText('예상 필요 크레딧')).not.toBeInTheDocument()
  })

  it('renders primary button "이대로 시작" and secondary "수정할래요" with min-h-12', () => {
    render(<ResearchPlanCard plan={samplePlan} />)

    const approveBtn = screen.getByRole('button', { name: '이대로 시작' })
    const changeBtn = screen.getByRole('button', { name: '수정할래요' })

    expect(approveBtn).toBeInTheDocument()
    expect(changeBtn).toBeInTheDocument()
    expect(approveBtn.className).toContain('min-h-12')
    expect(changeBtn.className).toContain('min-h-12')
  })

  it('calls onApprove and onRequestChange when clicked', () => {
    const handleApprove = vi.fn()
    const handleRequestChange = vi.fn()

    render(
      <ResearchPlanCard
        plan={samplePlan}
        onApprove={handleApprove}
        onRequestChange={handleRequestChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '이대로 시작' }))
    expect(handleApprove).toHaveBeenCalledTimes(1)
    expect(handleRequestChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '수정할래요' }))
    expect(handleRequestChange).toHaveBeenCalledTimes(1)
  })

  it('never auto-approves on mount or rerender', () => {
    const handleApprove = vi.fn()
    const { rerender } = render(<ResearchPlanCard plan={samplePlan} onApprove={handleApprove} />)
    expect(handleApprove).not.toHaveBeenCalled()

    rerender(<ResearchPlanCard plan={samplePlan} onApprove={handleApprove} />)
    expect(handleApprove).not.toHaveBeenCalled()
  })

  it('disables buttons when disabled=true', () => {
    const handleApprove = vi.fn()
    const handleRequestChange = vi.fn()

    render(
      <ResearchPlanCard
        plan={samplePlan}
        disabled={true}
        onApprove={handleApprove}
        onRequestChange={handleRequestChange}
      />,
    )

    const approveBtn = screen.getByRole('button', { name: '이대로 시작' })
    const changeBtn = screen.getByRole('button', { name: '수정할래요' })

    expect(approveBtn).toBeDisabled()
    expect(changeBtn).toBeDisabled()

    fireEvent.click(approveBtn)
    expect(handleApprove).not.toHaveBeenCalled()
  })

  it('shows quiet "승인했어요" state and hides action buttons when approved=true', () => {
    render(<ResearchPlanCard plan={samplePlan} approved={true} />)

    expect(screen.getByText('승인했어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이대로 시작' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정할래요' })).not.toBeInTheDocument()
  })
})
