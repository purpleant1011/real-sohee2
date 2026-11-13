import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProfileDiffCard } from './profile-diff-card'

describe('ProfileDiffCard', () => {
  it('requires field selection before approving the profile diff', () => {
    render(<ProfileDiffCard proposal={{
      targetLabel: '소희 뷰티 성수점', targetAddress: '서울 성동구 성수동',
      lastVerifiedAt: '2026-08-19T01:00:00.000Z', purpose: '방문 전 정보 혼란을 줄이기', estimatedCredits: 0,
      fields: [{
        id: 'hours', label: '영업시간', before: '월-금 10:00-19:00', after: '월-금 10:00-20:00',
        reason: '고객 혼란 방지', capability: 'manual_assist_only', state: 'provider_review',
      }],
    }} />)

    expect(screen.getByRole('button', { name: '선택한 변경 승인' })).toBeDisabled()
    expect(screen.getByText('자동 제출되지 않으며, 승인 뒤에도 수동 마무리가 필요할 수 있어요.')).toBeVisible()
  })
})
