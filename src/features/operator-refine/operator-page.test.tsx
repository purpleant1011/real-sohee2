import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OperatorPage, OperatorPageHeader } from './operator-page'

describe('OperatorPage', () => {
  it('renders a consistent CRM page heading and open work surface', () => {
    render(
      <OperatorPage>
        <OperatorPageHeader title="고객사" description="가입 상태와 운영 준비도를 확인합니다." extra={<button>고객사 등록</button>} />
        <section aria-label="고객사 목록">목록</section>
      </OperatorPage>,
    )

    expect(screen.getByRole('heading', { level: 1, name: '고객사' })).toBeInTheDocument()
    expect(screen.getByText('가입 상태와 운영 준비도를 확인합니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '고객사 등록' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '고객사 목록' })).toBeInTheDocument()
    expect(screen.queryByText('CUSTOMER OPERATIONS')).not.toBeInTheDocument()
  })
})
