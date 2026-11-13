import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const callOrder: string[] = []
  return {
    push: vi.fn(),
    refresh: vi.fn(),
    signInAction: vi.fn(),
    signInWithOAuth: vi.fn(),
    clearSupabaseAuthCookies: vi.fn(),
    searchParams: new URLSearchParams(),
    callOrder,
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: vi.fn(() => {
    mocks.callOrder.push('createBrowserSupabaseClient')
    return {
      auth: {
        signInWithOAuth: mocks.signInWithOAuth.mockImplementation(async () => {
          mocks.callOrder.push('signInWithOAuth')
          return { error: null }
        }),
      },
    }
  }),
}))

vi.mock('@/lib/supabase/clear-stale-auth-cookies', () => ({
  clearSupabaseAuthCookies: mocks.clearSupabaseAuthCookies.mockImplementation(() => {
    mocks.callOrder.push('clearSupabaseAuthCookies')
    return []
  }),
}))

vi.mock('../../../features/auth/actions', () => ({
  signInAction: mocks.signInAction,
  signUpAction: vi.fn(),
}))

import { LoginForm } from './login-form'

describe('LoginForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.callOrder.length = 0
    mocks.searchParams = new URLSearchParams()
    mocks.signInWithOAuth.mockImplementation(async () => {
      mocks.callOrder.push('signInWithOAuth')
      return { error: null }
    })
    mocks.clearSupabaseAuthCookies.mockImplementation(() => {
      mocks.callOrder.push('clearSupabaseAuthCookies')
      return []
    })
  })

  it('이메일 로그인이 성공하면 요청한 고객사 경로로 이동한다', async () => {
    mocks.signInAction.mockResolvedValue({ data: { next: '/app/work' } })
    render(<LoginForm next="/app/work" />)

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'customer@example.com' },
    })
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'safe-password' },
    })
    fireEvent.submit(screen.getByRole('form', { name: '고객사 로그인' }))

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith('/app/work')
    })
    expect(mocks.signInAction).toHaveBeenCalledWith({
      email: 'customer@example.com',
      password: 'safe-password',
      next: '/app/work',
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('관리자 전용 문구와 목적 경로로 로그인한다', async () => {
    mocks.signInAction.mockResolvedValue({ data: { next: '/admin' } })
    render(<LoginForm next="/admin" variant="admin" />)

    fireEvent.change(screen.getByLabelText('관리자 이메일'), {
      target: { value: 'operator@example.com' },
    })
    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), {
      target: { value: 'safe-password' },
    })
    fireEvent.submit(screen.getByRole('form', { name: '관리자 로그인' }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin'))
    expect(mocks.signInAction).toHaveBeenCalledWith({
      email: 'operator@example.com',
      password: 'safe-password',
      next: '/admin',
    })
    expect(screen.getByRole('button', { name: '관리자 페이지로 로그인' })).toBeInTheDocument()
  })

  it('인증 실패를 안전한 경고로 표시하고 화면을 이동하지 않는다', async () => {
    mocks.signInAction.mockResolvedValue({
      error: { message: '이메일 또는 비밀번호를 확인해 주세요.', requestId: 'auth' },
    })
    render(<LoginForm next="/app" />)

    fireEvent.change(screen.getByLabelText('이메일'), {
      target: { value: 'customer@example.com' },
    })
    fireEvent.change(screen.getByLabelText('비밀번호'), {
      target: { value: 'wrong-password' },
    })
    fireEvent.submit(screen.getByRole('form', { name: '고객사 로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호를 확인해 주세요.',
    )
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('사용자 로그인 화면에 Google 소셜 로그인 버튼만 노출되고 Kakao, Apple은 노출되지 않는다', () => {
    render(<LoginForm next="/app" />)

    expect(screen.getByRole('button', { name: 'Google 계정으로 시작' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '카카오톡 계정으로 시작' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apple 계정으로 시작' })).not.toBeInTheDocument()
    expect(screen.getByText(/1곳 이상 연결하면/)).toBeInTheDocument()
    expect(screen.getByText(/첫 포스팅 무료 체험 혜택/)).toBeInTheDocument()
    expect(screen.queryByText(/600 크레딧/)).not.toBeInTheDocument()
  })

  it('Google 로고 SVG 는 장식으로 표시해 이름 없는 이미지로 노출되지 않는다(4.1.2)', () => {
    render(<LoginForm next="/app" />)

    const svg = screen.getByRole('button', { name: 'Google 계정으로 시작' }).querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it('빈 입력을 각 필드 오류와 연결하고 인증 요청을 보내지 않는다', async () => {
    render(<LoginForm next="/app" />)

    fireEvent.submit(screen.getByRole('form', { name: '고객사 로그인' }))

    expect(await screen.findByText('이메일을 입력해 주세요.')).toHaveAttribute('id', 'email-error')
    expect(screen.getByText('비밀번호를 입력해 주세요.')).toHaveAttribute('id', 'password-error')
    expect(screen.getByLabelText('이메일')).toHaveAttribute('aria-describedby', 'email-error')
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('aria-describedby', 'password-error')
    expect(mocks.signInAction).not.toHaveBeenCalled()
  })

  it('기존 고객사 비밀번호 길이를 로그인 화면에서 다시 제한하지 않는다', () => {
    render(<LoginForm next="/app" />)

    const passwordInput = screen.getByLabelText('비밀번호')
    expect(passwordInput).not.toHaveAttribute('minlength')
    expect(passwordInput).toHaveAttribute('placeholder', '비밀번호를 입력해 주세요')
  })

  it('소셜 로그인(Google) 클릭 시 signInWithOAuth 호출 전에 clearSupabaseAuthCookies를 먼저 호출한다', async () => {
    render(<LoginForm next="/app" />)

    fireEvent.click(screen.getByRole('button', { name: 'Google 계정으로 시작' }))

    await waitFor(() => {
      expect(mocks.clearSupabaseAuthCookies).toHaveBeenCalledOnce()
      expect(mocks.signInWithOAuth).toHaveBeenCalledOnce()
    })

    const clearIdx = mocks.callOrder.indexOf('clearSupabaseAuthCookies')
    const createClientIdx = mocks.callOrder.indexOf('createBrowserSupabaseClient')
    const oauthIdx = mocks.callOrder.indexOf('signInWithOAuth')

    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(clearIdx).toBeLessThan(createClientIdx)
    expect(createClientIdx).toBeLessThan(oauthIdx)
  })


  it('URL에 error=exchange_failed 파라미터가 있으면 에러 문구를 노출하고 낡은 쿠키를 정리한다', async () => {
    mocks.searchParams = new URLSearchParams('error=exchange_failed')
    render(<LoginForm next="/app" />)

    expect(
      screen.getByText('로그인을 완료하지 못했어요. 다시 한 번 시도해 주세요.'),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.clearSupabaseAuthCookies).toHaveBeenCalled()
    })
  })

  it('카카오 환경변수가 설정되어 있으면 카카오 로그인 버튼이 노출되고 클릭 시 서버 플로우로 이동한다', async () => {
    const originalEnv = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test-kakao-js-key'

    const assignMock = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      assign: assignMock,
    })

    try {
      render(<LoginForm next="/app/schedule" />)

      const kakaoButton = screen.getByRole('button', { name: '카카오톡 계정으로 시작' })
      expect(kakaoButton).toBeInTheDocument()

      fireEvent.click(kakaoButton)
      expect(assignMock).toHaveBeenCalledWith(
        '/api/auth/kakao/start?next=' + encodeURIComponent('/app/schedule'),
      )
    } finally {
      process.env.NEXT_PUBLIC_KAKAO_JS_KEY = originalEnv
      vi.unstubAllGlobals()
    }
  })
  it('서버가 kakaoEnabled=true 로 알리면 빌드 시점 공개 환경변수 없이도 카카오 버튼을 노출한다', () => {
    const original = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
    delete process.env.NEXT_PUBLIC_KAKAO_JS_KEY
    try {
      render(<LoginForm next="/app" kakaoEnabled />)
      expect(screen.getByRole('button', { name: '카카오톡 계정으로 시작' })).toBeInTheDocument()
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_KAKAO_JS_KEY = original
    }
  })

  it('서버가 kakaoEnabled=false 로 알리면 공개 환경변수가 있어도 카카오 버튼을 숨긴다', () => {
    const original = process.env.NEXT_PUBLIC_KAKAO_JS_KEY
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY = 'test-kakao-js-key'
    try {
      render(<LoginForm next="/app" kakaoEnabled={false} />)
      expect(screen.queryByRole('button', { name: '카카오톡 계정으로 시작' })).not.toBeInTheDocument()
    } finally {
      if (original === undefined) delete process.env.NEXT_PUBLIC_KAKAO_JS_KEY
      else process.env.NEXT_PUBLIC_KAKAO_JS_KEY = original
    }
  })

  it('이메일 및 비밀번호 입력칸에 모바일 키보드 최적화 속성이 설정되어 있다', () => {
    render(<LoginForm next="/app" />)

    const emailInput = screen.getByLabelText('이메일')
    expect(emailInput).toHaveAttribute('enterkeyhint', 'next')
    expect(emailInput).toHaveAttribute('autocapitalize', 'none')
    expect(emailInput).toHaveAttribute('autocorrect', 'off')
    expect(emailInput).toHaveAttribute('spellcheck', 'false')
    expect(emailInput).toHaveAttribute('inputmode', 'email')

    const passwordInput = screen.getByLabelText('비밀번호')
    expect(passwordInput).toHaveAttribute('enterkeyhint', 'go')
  })

  it('비밀번호 보기/숨기기 토글 버튼으로 입력값 손실 없이 type과 aria 속성이 전환된다', () => {
    render(<LoginForm next="/app" />)

    const passwordInput = screen.getByLabelText('비밀번호')
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('id', 'password')
    expect(passwordInput).toHaveAttribute('name', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')

    // 초기 버튼 상태: 숨김 상태이므로 '비밀번호 보기'
    const toggleButton = screen.getByRole('button', { name: '비밀번호 보기' })
    expect(toggleButton).toHaveAttribute('type', 'button')
    expect(toggleButton).toHaveAttribute('aria-pressed', 'false')

    // 비밀번호 입력
    fireEvent.change(passwordInput, { target: { value: 'my-super-secret-pw' } })
    expect(passwordInput).toHaveValue('my-super-secret-pw')

    // 토글 클릭 -> 표시 상태
    fireEvent.click(toggleButton)

    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(passwordInput).toHaveValue('my-super-secret-pw')
    expect(mocks.signInAction).not.toHaveBeenCalled()

    const hideButton = screen.getByRole('button', { name: '비밀번호 숨기기' })
    expect(hideButton).toHaveAttribute('aria-pressed', 'true')

    // 다시 토글 클릭 -> 숨김 상태
    fireEvent.click(hideButton)

    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveValue('my-super-secret-pw')
    expect(mocks.signInAction).not.toHaveBeenCalled()

    const viewButtonAgain = screen.getByRole('button', { name: '비밀번호 보기' })
    expect(viewButtonAgain).toHaveAttribute('aria-pressed', 'false')
  })
})
