import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DaangnBusinessCard } from './daangn-business-card'

describe('Daangn Business Profile boundary', () => {
  it('labels the surface as 비즈프로필 and never 중고거래', () => {
    render(<DaangnBusinessCard profile={{
      accountLabel: '소희 뷰티 성수점', externalProfileId: 'daangn-business-123', region: '성수동',
      introductionState: 'needs_information', recentNewsCount: 0, capability: 'local_connector',
      lastVerifiedAt: null, reauthState: 'user_login_required',
    }} />)

    expect(screen.getByText('당근 비즈프로필')).toBeVisible()
    expect(screen.getByText('소희 Chrome 연결기로 소식 게시 가능')).toBeVisible()
    expect(screen.queryByText('중고거래 등록')).not.toBeInTheDocument()
    expect(screen.queryByText(/CN-07/)).toBeNull()
  })
})
