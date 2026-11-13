import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BusinessInfoPage from './page'

describe('사업자 정보 페이지', () => {
  it('사업자등록증 기준의 실제 운영 주체 정보를 보여 준다', () => {
    render(<BusinessInfoPage />)
    expect(screen.getByRole('heading', { level: 1, name: '사업자 정보' })).toBeInTheDocument()
    expect(screen.getByText('예시회사')).toBeInTheDocument()
    expect(screen.getByText('홍길동')).toBeInTheDocument()
    expect(screen.getByText('000-00-00000')).toBeInTheDocument()
    expect(screen.getByText('제 0000-지역-0000 호')).toBeInTheDocument()
    expect(screen.getByText(/서울특별시 예시구 예시로 1/)).toBeInTheDocument()
    expect(screen.getAllByText('010-0000-0000').length).toBe(2)
    expect(screen.getByRole('link', { name: '010-0000-0000' })).toHaveAttribute('href', 'tel:010-0000-0000')
    expect(screen.getByRole('link', { name: 'support@example.com' })).toHaveAttribute('href', 'mailto:support@example.com')
  })

  it('"확인된 정보 없음" 초안 문구를 더 이상 쓰지 않는다', () => {
    render(<BusinessInfoPage />)
    expect(screen.queryByText(/기재하지 않습니다/)).not.toBeInTheDocument()
    expect(screen.queryByText(/MVP 안내 초안/)).not.toBeInTheDocument()
  })
})
