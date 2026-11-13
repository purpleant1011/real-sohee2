import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NaverConnectionCard } from './naver-connection-card'
import { createNaverConnectionSummary } from './naver-connection'

describe('Naver connection boundary', () => {
  it('keeps blog and Place capabilities separate and directs login only to the official surface', () => {
    const summary = createNaverConnectionSummary({
      accountLabel: '소희 운영 계정', placeCapability: 'manual_assist_only', blogCapability: 'local_connector',
      lastVerifiedAt: null, reauthRequired: true,
    })
    render(<NaverConnectionCard summary={summary} />)

    expect(screen.getByRole('heading', { name: '네이버 채널 연결' })).toBeVisible()
    expect(screen.getByText('게시 보조만 가능')).toBeVisible()
    expect(screen.getByText('네이버 블로그 · 소희 Chrome 연결기로 게시 가능')).toBeVisible()
    expect(screen.getByRole('link', { name: '네이버 공식 로그인 열기' })).toHaveAttribute('href', 'https://nid.naver.com/nidlogin.login')
    expect(screen.queryByLabelText(/비밀번호/u)).not.toBeInTheDocument()
  })
})
