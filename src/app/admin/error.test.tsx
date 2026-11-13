import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import OperatorError from './error'

describe('OperatorError', () => {
  it.each([
    { code: 'PERMISSION_DENIED', message: 'provider permission detail' },
    { code: 'WORKSPACE_SCOPE_DENIED', message: 'workspace scope detail' },
  ])('maps a page permission denial to the safe operator denial screen: %j', (error) => {
    const routeError = Object.assign(new Error(error.message), { code: error.code })
    render(<OperatorError error={routeError} reset={() => undefined} />)

    expect(screen.getByRole('heading', { name: '운영사 관리자 접근이 필요합니다' })).toBeInTheDocument()
    expect(screen.getByText(/추가 인증/)).toBeInTheDocument()
    expect(screen.queryByText(error.message)).not.toBeInTheDocument()
  })

  it('does not expose provider details for an unknown route error', () => {
    render(<OperatorError error={new Error('SUPABASE_SECRET_PROVIDER_DETAIL')} reset={() => undefined} />)

    expect(screen.getByRole('heading', { name: '운영사 관리자 접근이 필요합니다' })).toBeInTheDocument()
    expect(screen.queryByText('SUPABASE_SECRET_PROVIDER_DETAIL')).not.toBeInTheDocument()
  })

  it('links MFA and invited operator denials to administrator setup', () => {
    for (const code of ['MFA_REQUIRED', 'OPERATOR_DISABLED']) {
      const routeError = Object.assign(new Error('provider detail'), { code })
      const { unmount } = render(<OperatorError error={routeError} reset={() => undefined} />)
      expect(screen.getByRole('link', { name: '관리자 추가 인증 설정으로 이동' })).toHaveAttribute('href', '/auth/admin-setup')
      unmount()
    }
  })

  it('links unknown denials to the operator login page with a safe next path', () => {
    render(<OperatorError error={new Error('x')} reset={() => undefined} />)
    expect(screen.getByRole('link', { name: '운영사 로그인으로 이동' })).toHaveAttribute('href', '/admin-login?next=%2Fadmin')
  })
})
