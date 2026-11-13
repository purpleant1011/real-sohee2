import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./admin-approval-list', () => ({ AdminApprovalList: () => null }))
vi.mock('./admin-approval-form', () => ({ AdminApprovalForm: () => null }))

import { OperatorAdminAccounts } from './operator-admin-accounts'

describe('OperatorAdminAccounts', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })
  it('offers a first-party MFA registration entry without exposing factor secrets', () => {
    render(<OperatorAdminAccounts
      result={{ data: { items: [], nextCursor: null }, error: null }}
      approvals={{ data: [], error: null }}
      selectors={{ data: [], error: null }}
    />)

    expect(screen.getByRole('link', { name: '내 추가 인증 등록' })).toHaveAttribute(
      'href',
      '/auth/admin-setup',
    )
  }, 15_000)
})
