import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const callOrder: string[] = []
  return {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOAuth: vi.fn(),
    clearSupabaseAuthCookies: vi.fn(),
    rpc: vi.fn(),
    getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    createBrowserSupabaseClient: vi.fn(),
    callOrder,
  }
})

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => {
    mocks.callOrder.push('createBrowserSupabaseClient')
    return {
      auth: {
        signUp: mocks.signUp,
        signInWithPassword: mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'usr-1' } }, error: null }),
        signInWithOAuth: mocks.signInWithOAuth.mockImplementation(async () => {
          mocks.callOrder.push('signInWithOAuth')
          return { error: null }
        }),
        getUser: mocks.getUser,
      },
      rpc: mocks.rpc,
    }
  },
}))

vi.mock('@/lib/supabase/clear-stale-auth-cookies', () => ({
  clearSupabaseAuthCookies: mocks.clearSupabaseAuthCookies.mockImplementation(() => {
    mocks.callOrder.push('clearSupabaseAuthCookies')
    return []
  }),
}))

import { SignupForm } from './signup-form'

describe('SignupForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.callOrder.length = 0
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    mocks.signInWithOAuth.mockImplementation(async () => {
      mocks.callOrder.push('signInWithOAuth')
      return { error: null }
    })
    mocks.clearSupabaseAuthCookies.mockImplementation(() => {
      mocks.callOrder.push('clearSupabaseAuthCookies')
      return []
    })
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'usr-1' } }, error: null })
    window.sessionStorage.clear()
  })

  it('이메일 가입 폼에 대표자명, 휴대폰번호, 상호명, 사업자등록번호, 약관 동의 항목이 노출된다', () => {
    render(<SignupForm />)

    expect(screen.getByLabelText(/이메일 주소/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^비밀번호$/)).toBeInTheDocument()
    expect(screen.getByLabelText(/비밀번호 확인/)).toBeInTheDocument()
    expect(screen.getByLabelText(/대표자 성명/)).toBeInTheDocument()
    expect(screen.getByLabelText(/휴대폰 번호/)).toBeInTheDocument()
    expect(screen.getByLabelText(/상호명/)).toBeInTheDocument()
    expect(screen.getByLabelText(/사업자등록번호/)).toBeInTheDocument()
    expect(screen.getByLabelText(/개업일자/)).toBeInTheDocument()
    expect(screen.getByLabelText(/모든 약관에 전체 동의합니다/)).toBeInTheDocument()
    expect(screen.getByText(/SNS 마케팅 채널\(인스타그램·스레드\) 연동 및 발행 지원 동의/)).toBeInTheDocument()
    expect(screen.queryByText(/네이버.*자율 발행 및 대행 권한 위임/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /소희 회원가입 완료/ })).toBeInTheDocument()
  })

  it('유효한 사업자등록번호 입력 시 체크섬 통과 상태가 실시간으로 표시된다', () => {
    render(<SignupForm />)

    const brnInput = screen.getByLabelText(/사업자등록번호/)
    // 유효한 국세청 사업자등록번호: 120-81-47521
    fireEvent.change(brnInput, { target: { value: '1208147521' } })

    expect(screen.getByText(/유효한 사업자번호 형식입니다/)).toBeInTheDocument()
  })

  it('잘못된 사업자등록번호 입력 시 체크섬 실패 경고가 표시된다', () => {
    render(<SignupForm />)

    const brnInput = screen.getByLabelText(/사업자등록번호/)
    // 체크섬 실패 번호
    fireEvent.change(brnInput, { target: { value: '1234567890' } })

    expect(screen.getByText(/국세청 체크섬 검증에 실패했습니다/)).toBeInTheDocument()
  })

  it('이메일 회원가입 양식을 올바르게 제출하면 /api/auth/register-email 호출 및 자동 로그인을 수행한다', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '' },
    })

    const oldFetch = global.fetch
    try {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, workspaceId: 'ws-123' }),
      }) as any

      render(<SignupForm />)

      fireEvent.change(screen.getByLabelText(/이메일 주소/), { target: { value: 'owner@example.com' } })
      fireEvent.change(screen.getByLabelText(/^비밀번호$/), { target: { value: 'password123!' } })
      fireEvent.change(screen.getByLabelText(/비밀번호 확인/), { target: { value: 'password123!' } })
      fireEvent.change(screen.getByLabelText(/대표자 성명/), { target: { value: '홍길동' } })
      fireEvent.change(screen.getByLabelText(/휴대폰 번호/), { target: { value: '01012345678' } })
      fireEvent.change(screen.getByLabelText(/상호명/), { target: { value: '소희카페' } })
      fireEvent.change(screen.getByLabelText(/사업자등록번호/), { target: { value: '1208147521' } })

      // 전체 약관 동의 클릭
      fireEvent.click(screen.getByLabelText(/모든 약관에 전체 동의합니다/))

      fireEvent.submit(screen.getByRole('form', { name: /고객 회원가입/ }))

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/register-email',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"businessNumber":"1208147521"'),
          })
        )
      })

      await waitFor(() => {
        expect(mocks.signInWithPassword).toHaveBeenCalledWith({
          email: 'owner@example.com',
          password: 'password123!',
        })
      })
    } finally {
      global.fetch = oldFetch
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation })
    }
  })

  it('Google 계정으로 시작하기 클릭 시 /start 콜백으로 OAuth를 호출한다', async () => {
    render(<SignupForm />)

    mocks.callOrder.length = 0
    fireEvent.click(screen.getByRole('button', { name: 'Google 계정으로 시작하기' }))
    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=%2Fstart` },
    }))

    const clearIdx = mocks.callOrder.indexOf('clearSupabaseAuthCookies')
    const createClientIdx = mocks.callOrder.indexOf('createBrowserSupabaseClient')
    const oauthIdx = mocks.callOrder.indexOf('signInWithOAuth')

    expect(clearIdx).toBeGreaterThanOrEqual(0)
    expect(clearIdx).toBeLessThan(createClientIdx)
    expect(createClientIdx).toBeLessThan(oauthIdx)
  })

  it('워크스페이스 없이 VERIFICATION_PENDING 인 신청서는 완료 화면으로 오표시하지 않고 재시도 안내를 보여준다', async () => {
    const oldFetch = global.fetch
    try {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'usr-1', app_metadata: { provider: 'email' } } } })
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          application: {
            state: 'VERIFICATION_PENDING',
            workspace_id: null,
            agreements_completed: true,
            company_name: '모모 카페',
            business_number: '1208147521',
          },
        }),
      }) as any

      render(<SignupForm />)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/가입 마무리가 아직 완료되지 않았습니다/)
      expect(screen.queryByText(/소희 회원가입 완료!/)).not.toBeInTheDocument()
      // 재시도할 수 있도록 이메일 가입 폼이 그대로 노출된다
      expect(screen.getByRole('form', { name: /고객 회원가입/ })).toBeInTheDocument()
    } finally {
      global.fetch = oldFetch
    }
  })

  it('워크스페이스가 실제로 결합된 VERIFICATION_PENDING 신청서만 완료 화면을 보여준다', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '' },
    })

    const oldFetch = global.fetch
    try {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'usr-1', app_metadata: { provider: 'email' } } } })
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          application: {
            state: 'VERIFICATION_PENDING',
            workspace_id: 'ws-joined-999',
            agreements_completed: true,
            company_name: '모모 카페',
            business_number: '1208147521',
          },
        }),
      }) as any

      render(<SignupForm />)

      expect(await screen.findByText(/소희 회원가입 완료!/)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      global.fetch = oldFetch
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation })
    }
  })

  it('이메일 가입 폼의 약관 동의 영역에서 서비스 이용약관·개인정보 처리방침 원문 링크를 제공한다', () => {
    render(<SignupForm />)

    const termsLink = screen.getByRole('link', { name: '서비스 이용약관 원문 새 창에서 열기' })
    expect(termsLink).toHaveAttribute('href', '/terms')
    expect(termsLink).toHaveAttribute('target', '_blank')
    expect(termsLink).toHaveAttribute('rel', 'noopener noreferrer')
    // 링크가 label 안에 있으면 링크 클릭이 체크박스 토글로 이어진다.
    expect(termsLink.closest('label')).toBeNull()

    const privacyLink = screen.getByRole('link', { name: '개인정보 수집 및 이용 약관 원문 새 창에서 열기' })
    expect(privacyLink).toHaveAttribute('href', '/privacy')
    expect(privacyLink).toHaveAttribute('target', '_blank')
    expect(privacyLink.closest('label')).toBeNull()
  })

  it('약관 동의 단계에서도 서비스 이용약관·개인정보 처리방침 원문 링크를 제공한다', async () => {
    const oldFetch = global.fetch
    try {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'usr-1', app_metadata: { provider: 'email' } } } })
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          application: {
            state: 'AGREEMENT_REQUIRED',
            company_name: '모모 카페',
            business_number: '1208147521',
          },
        }),
      }) as any

      render(<SignupForm />)

      const termsLink = await screen.findByRole('link', { name: '서비스 이용약관 원문 새 창에서 열기' })
      expect(termsLink).toHaveAttribute('href', '/terms')
      expect(termsLink.closest('label')).toBeNull()

      const privacyLink = screen.getByRole('link', { name: '개인정보 수집 및 이용 약관 원문 새 창에서 열기' })
      expect(privacyLink).toHaveAttribute('href', '/privacy')
      expect(privacyLink.closest('label')).toBeNull()
    } finally {
      global.fetch = oldFetch
    }
  })

  it('기존 인증 세션의 사업자 확인 단계에서 개업일자 라벨과 도움말이 표시된다', async () => {
    const oldFetch = global.fetch
    try {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'usr-1', app_metadata: { provider: 'email' } } } })
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ application: { company_name: '모모 카페', business_number: '1208147521' } }),
      }) as any

      render(<SignupForm />)

      const label = await screen.findByText(/개업일자 \(입력하면 확인이 빨라져요\)/)
      expect(label).toBeInTheDocument()

      const input = screen.getByPlaceholderText('예: 20240101')
      expect(input).toHaveAttribute('id', 'start-date')
      expect(input).toHaveAttribute('aria-describedby', 'start-date-hint')

      const hint = screen.getByText(/사업자등록증에 적힌 '개업연월일'이에요\. 입력하면 국세청에서 바로 확인돼서 심사가 빨라져요\./)
      expect(hint).toHaveAttribute('id', 'start-date-hint')
    } finally {
      global.fetch = oldFetch
    }
  })

  describe('OAuth 복귀 후 이어서 가입', () => {
    const DRAFT_KEY = 'sohee.signup.draft.v1'

    function seedDraft(overrides: Record<string, unknown> = {}) {
      window.sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          email: 'boss@momocafe.kr',
          representativeName: '김소희',
          phone: '01012345678',
          companyName: '모모 카페',
          businessNumber: '1208147521',
          startDate: '20240101',
          agreements: {
            terms: true,
            privacy: true,
            aiData: false,
            delegation: false,
            marketing: false,
          },
          ...overrides,
        }),
      )
    }

    it('복귀 안내 문구가 있으면 배너로 표시한다', () => {
      render(<SignupForm authReturnMessage="로그인을 취소하셨어요. 입력하신 내용은 그대로 두었어요." />)

      expect(screen.getByText('이어서 가입할 수 있어요')).toBeInTheDocument()
      expect(screen.getByText(/로그인을 취소하셨어요\./)).toBeInTheDocument()
    })

    it('복귀 안내 문구가 없으면 배너를 표시하지 않는다', () => {
      render(<SignupForm />)

      expect(screen.queryByText('이어서 가입할 수 있어요')).toBeNull()
    })

    it('preserveDraft가 켜져 있으면 저장된 초안을 복원하고 비밀번호는 비워 둔다', () => {
      seedDraft()

      render(<SignupForm preserveDraft />)

      expect(screen.getByLabelText(/이메일 주소/)).toHaveValue('boss@momocafe.kr')
      expect(screen.getByLabelText(/대표자 성명/)).toHaveValue('김소희')
      expect(screen.getByLabelText(/상호명/)).toHaveValue('모모 카페')
      expect(screen.getByLabelText(/사업자등록번호/)).toHaveValue('1208147521')
      expect(screen.getByLabelText(/^비밀번호$/)).toHaveValue('')
      expect(screen.getByLabelText(/모든 약관에 전체 동의합니다/)).not.toBeChecked()
    })

    it('preserveDraft가 꺼져 있으면 저장된 초안을 복원하지 않는다', () => {
      seedDraft()

      render(<SignupForm />)

      expect(screen.getByLabelText(/이메일 주소/)).toHaveValue('')
      expect(screen.getByLabelText(/상호명/)).toHaveValue('')
    })

    it('복원 직후 초안이 빈 값으로 덮어써지지 않는다 (ANI-1761 회귀)', () => {
      seedDraft()

      // 개발 모드의 StrictMode는 effect를 두 번 실행한다. 복원 effect가 연 직후 저장 effect가
      // 빈 초기값을 덮어쓰면, 두 번째 복원이 이미 비워진 초안을 읽어 입력값이 사라진다.
      render(
        <StrictMode>
          <SignupForm preserveDraft />
        </StrictMode>,
      )

      expect(screen.getByLabelText(/이메일 주소/)).toHaveValue('boss@momocafe.kr')

      const raw = window.sessionStorage.getItem(DRAFT_KEY)
      expect(raw).not.toBeNull()
      const draft = JSON.parse(raw as string)
      expect(draft.email).toBe('boss@momocafe.kr')
      expect(draft.companyName).toBe('모모 카페')
      expect(draft.agreements.terms).toBe(true)
      expect(draft.agreements.privacy).toBe(true)
    })

    it('비밀번호를 제외한 입력값을 초안으로 저장한다', async () => {
      render(<SignupForm />)

      fireEvent.change(screen.getByLabelText(/이메일 주소/), { target: { value: 'boss@momocafe.kr' } })
      fireEvent.change(screen.getByLabelText(/^비밀번호$/), { target: { value: 'super-secret' } })

      await waitFor(() => {
        const raw = window.sessionStorage.getItem(DRAFT_KEY)
        expect(raw).not.toBeNull()
        const draft = JSON.parse(raw as string)
        expect(draft.email).toBe('boss@momocafe.kr')
      })

      const stored = window.sessionStorage.getItem(DRAFT_KEY) as string
      expect(stored).not.toContain('super-secret')
    })
  })
})
