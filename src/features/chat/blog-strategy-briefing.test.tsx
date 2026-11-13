import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BlogStrategyBriefing } from './blog-strategy-briefing'
import type { BlogStrategyProposal } from './blog-strategy-proposal'

const proposal: BlogStrategyProposal = {
  id: '10000000-0000-4000-8000-000000000001', revision: 2, status: 'proposed',
  goal: { description: '서비스 상담 문의' }, selectedIndex: 1,
  audience: '처음 이용하는 분', constraints: '할인 안내 제외',
  topics: ['첫 이용 안내', '상담 준비 안내', '선택 확인 사항'].map(title => ({
    title, evidence: ['사장님이 승인한 상담 가능 시간'], questionSource: 'inferred',
  })), unknowns: ['검색 수요를 측정하지 않았어요.'],
}

describe('blog strategy growth briefing', () => {
  it('keeps the saved recommendation distinct from an unsaved choice and exposes its evidence on demand', () => {
    render(<BlogStrategyBriefing proposal={proposal} dirty />)
    expect(within(screen.getByRole('region', { name: '현재 상황' })).getByText('서비스 상담 문의')).toBeInTheDocument()
    const opportunity = screen.getByRole('region', { name: '제안 기회' })
    expect(within(opportunity).getByText('상담 준비 안내')).toBeInTheDocument()
    expect(within(opportunity).getByText(/실제 고객 질문이나 검색 수요를 관측한 결과는 아니에요/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('바꾼 선택·조건을 먼저 저장해 주세요.')
    const disclosure = screen.getByText('근거와 아직 모르는 점')
    expect(disclosure.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(disclosure)
    expect(disclosure.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('사장님이 승인한 상담 가능 시간')).toBeVisible()
    expect(screen.getByText('검색 수요를 측정하지 않았어요.')).toBeVisible()
  })

  it('never recommends execution when a previously approved strategy is blocked', () => {
    const { rerender } = render(<BlogStrategyBriefing proposal={{ ...proposal, status: 'approved' }} />)
    expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('비용')
    rerender(<BlogStrategyBriefing proposal={{ ...proposal, status: 'approved' }} blocked />)
    const next = screen.getByRole('region', { name: '다음 행동' })
    expect(next).toHaveTextContent('최신 정보로 다시 확인해 주세요.')
    expect(next).not.toHaveTextContent('원고 준비를 요청')
    expect(screen.getByRole('status')).toHaveTextContent('최신 내용으로 확인되지 않았어요')
  })

  it('does not invent an opportunity before a topic is selected', () => {
    render(<BlogStrategyBriefing proposal={{ ...proposal, selectedIndex: null }} />)
    expect(screen.getByRole('region', { name: '제안 기회' })).toHaveTextContent('아래에서 주제를 하나 골라 주세요.')
    expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('주제와 안내할 대상을 정해 주세요.')
  })
})
