import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishingView } from './operator-admin-configs'
import { OperatorAdminView } from './operator-admin-view'

describe('OperatorAdminView', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })

  it('uses the shared Pro table and CRM page hierarchy', () => {
    const { container } = render(<OperatorAdminView config={publishingView} liveRows={[['바이름', '콘텐츠 A', 'Instagram', 'v2', '승인 일치', '확인 전', '오늘 18:00', 'success', '1', '결과 확인', '없음', '운영 담당']]} />)
    expect(screen.getByRole('heading', { level: 1, name: '게시 운영' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '게시 운영 목록' })).toBeInTheDocument()
    expect(container.querySelector('.ant-pro-table')).toBeInTheDocument()
    expect(screen.getByText('바이름')).toBeInTheDocument()
  }, 15_000)
})
