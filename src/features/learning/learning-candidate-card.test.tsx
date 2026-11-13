import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LearningCandidateCard } from './learning-candidate-card'

describe('LearningCandidateCard', () => {
  it('keeps a candidate inactive until an owner or manager approves it', () => {
    render(<LearningCandidateCard candidate={{ observation: '저장 반응이 늘었어요.', interpretation: '고객 고민이 맞았을 수 있어요.', impact: '첫 문장 규칙', channels: ['인스타그램'], stopCondition: '2주 뒤 효과가 없으면 멈춰요.', status: 'review_required' }} />)
    expect(screen.getByText('승인 전 비활성')).toBeVisible()
    expect(screen.getByText('다음 콘텐츠에 아직 적용되지 않아요.')).toBeVisible()
    expect(screen.getByRole('button', { name: '후보 승인' })).toBeDisabled()
  })
})
