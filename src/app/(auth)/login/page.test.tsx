import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/login',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('../../../features/auth/actions', () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
}))

import LoginPage from './page'

describe('LoginPage', () => {
  it('공개 사이트 메뉴가 없는 전용 작업공간 로그인 셸을 제공한다', async () => {
    const view = await LoginPage({ searchParams: Promise.resolve({}) })

    render(view)

    expect(screen.getAllByRole('link', { name: '소희 홈' })).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '무료 체험하기' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '대화에서 계획하고, 승인하고, 성장해요' })).toBeInTheDocument()
    expect(screen.getByText('철저한 매장 정보 보호')).toBeInTheDocument()
    expect(screen.getByText('사장님이 직접 확인')).toBeInTheDocument()
    expect(screen.getByText('안전한 공식 계정 연동')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: '고객사 로그인' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '관리자 페이지' })).toHaveAttribute('href', '/admin-login')
  })

  it('외부 next 경로를 고객사 앱 홈으로 정규화한다', async () => {
    const view = await LoginPage({
      searchParams: Promise.resolve({ next: 'https://evil.example' }),
    })

    render(view)

    expect(screen.getByRole('form', { name: '고객사 로그인' })).toHaveAttribute(
      'data-next',
      '/app',
    )
  })

  it('운영사 next 경로는 관리자 정식 경로로 정규화한다', async () => {
    const view = await LoginPage({
      searchParams: Promise.resolve({ next: '/operator/system?tab=health' }),
    })

    render(view)

    expect(screen.getByRole('form', { name: '고객사 로그인' })).toHaveAttribute(
      'data-next',
      '/admin/system?tab=health',
    )
  })

  it('인증 콜백 오류를 사용자가 다시 시도할 수 있는 문구로 보여 준다', async () => {
    const view = await LoginPage({ searchParams: Promise.resolve({ error: 'callback' }) })

    render(view)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('로그인 링크를 확인할 수 없어요')
    expect(alert).toHaveTextContent('이메일 로그인을 다시 시도해 주세요')
  })

  // ANI-1761 AC-3: 구글 로그인 창에서 돌아온 결과를 세 가지로 구분해 안내한다.
  describe('구글 로그인 복귀 안내', () => {
    it('복귀 신호가 없으면 배너를 그리지 않는다', async () => {
      const view = await LoginPage({ searchParams: Promise.resolve({}) })

      render(view)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('취소하고 돌아오면 계정에 변화가 없다는 사실과 재시도 경로를 준다', async () => {
      const view = await LoginPage({
        searchParams: Promise.resolve({ oauth: 'cancelled', next: '/app' }),
      })

      render(view)

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('로그인을 취소하셨어요')
      expect(alert).toHaveTextContent('아무 변화가 없어요')
      expect(screen.getByRole('link', { name: '다시 로그인하기' })).toHaveAttribute(
        'href',
        '/login?next=%2Fapp',
      )
    })

    it('세션 교환 실패는 이메일 로그인이라는 대안까지 알려 준다', async () => {
      const view = await LoginPage({
        searchParams: Promise.resolve({ error: 'exchange_failed', next: '/app' }),
      })

      render(view)

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('연결을 마치지 못했어요')
      expect(alert).toHaveTextContent('이메일')
    })

    it('안내 문구에 영문 오류 코드를 노출하지 않는다', async () => {
      const view = await LoginPage({
        searchParams: Promise.resolve({ error: 'callback_exception' }),
      })

      render(view)

      expect(screen.getByRole('alert')).not.toHaveTextContent('callback_exception')
    })
  })
})
