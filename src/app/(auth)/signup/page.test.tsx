import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/features/auth/actions', () => ({ signUpAction: vi.fn() }))
import SignupPage from './page'

describe('SignupPage', () => {
  it('회원가입 전용 화면과 로그인 이동을 제공한다', async () => {
    const view = await SignupPage({ searchParams: Promise.resolve({}) })

    render(view)
    expect(screen.getByRole('heading', { name: '소희와 내 매장 마케팅을 시작하세요.' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: '고객 회원가입' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '이미 계정이 있나요? 로그인' })).toHaveAttribute('href', '/login?next=%2Fapp')
  })

  it('가입 후 진행할 4단계 여정을 미리 보여준다', async () => {
    const view = await SignupPage({ searchParams: Promise.resolve({}) })

    render(view)
    const journey = screen.getByRole('list', { name: '가입 후 진행 순서' })
    expect(journey).toHaveTextContent('계정 만들기')
    expect(journey).toHaveTextContent('우리 가게 알려주기')
    expect(journey).not.toHaveTextContent('자동 입력')
    expect(journey).toHaveTextContent('인스타·스레드 연결')
    expect(journey).toHaveTextContent('첫 글 확인하고 발행')
  })

  it('next 쿼리를 안전하게 정규화해 로그인 링크로 넘긴다', async () => {
    const view = await SignupPage({ searchParams: Promise.resolve({ next: '/start' }) })

    render(view)
    expect(screen.getByRole('link', { name: '이미 계정이 있나요? 로그인' })).toHaveAttribute('href', '/login?next=%2Fstart')
  })
})
