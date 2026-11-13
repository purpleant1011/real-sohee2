import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/system/privacy',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

import { PersonalSettings } from './personal-settings'

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

const mockSaveAction = vi.fn()
vi.mock('./actions/save-personal-profile', () => ({
  savePersonalProfileAction: (...args: unknown[]) => mockSaveAction(...args),
}))

vi.mock('@/features/account/profile-image-card', () => ({
  ProfileImageCard: ({ avatarUrl }: { avatarUrl: string | null }) => (
    <div data-testid="profile-image-card">
      <span>프로필 사진 카드 (avatar: {avatarUrl ?? 'none'})</span>
    </div>
  ),
}))

describe('PersonalSettings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'test-user-uuid',
          email: 'owner@example.com',
          created_at: '2026-01-15T09:00:00.000Z',
          app_metadata: { provider: 'email' },
        },
      },
      error: null,
    })
  })

  it('ShellScreen DETAIL 모드와 "개인정보 관리" 타이틀을 렌더링한다', async () => {
    render(<PersonalSettings />)

    const headings = screen.getAllByRole('heading', { level: 1, name: '개인정보 관리' })
    expect(headings.length).toBeGreaterThanOrEqual(1)
  })

  it('사용자 개인정보 변경 가능 범위(변경 가능 vs 변경 불가)를 정직하게 안내한다', async () => {
    render(<PersonalSettings />)

    expect(screen.getByText(/언제든 직접 바꿀 수 있어요/)).toBeInTheDocument()
    expect(screen.getByText(/로그인 이메일은 계정 고유 식별자여서 직접 변경할 수 없어요/)).toBeInTheDocument()
  })

  it('실제 환경에서는 기존 ProfileImageCard를 재사용하여 프로필 사진 영역을 표시한다', async () => {
    render(<PersonalSettings initialAvatarUrl="https://example.com/avatar.jpg" />)

    expect(screen.getByTestId('profile-image-card')).toBeInTheDocument()
    expect(screen.getByText(/avatar: https:\/\/example\.com\/avatar\.jpg/)).toBeInTheDocument()
  })

  it('데모 모드에서는 실제 ProfileImageCard 및 Supabase auth를 호출하지 않고 데모 UI를 안전하게 표시한다', async () => {
    render(
      <PersonalSettings
        isDemo
        initialDisplayName="데모대표"
        previewUser={{
          email: 'demo@example.com',
          createdAt: '2026-02-01T00:00:00.000Z',
          provider: 'email',
        }}
      />,
    )

    expect(mockGetUser).not.toHaveBeenCalled()
    expect(screen.queryByTestId('profile-image-card')).toBeNull()
    expect(screen.getByText(/데모 미리보기 \(업로드 비활성\)/)).toBeInTheDocument()
    expect(screen.getByText('demo@example.com')).toBeInTheDocument()

    // 데모 저장 시 실제 server action 미호출 확인
    const submitBtn = screen.getByRole('button', { name: '이름 저장' })
    fireEvent.click(submitBtn)
    expect(mockSaveAction).not.toHaveBeenCalled()
    expect(screen.getByText('데모 모드: 실제 계정에는 저장하지 않았어요')).toBeInTheDocument()
  })

  it('소셜 로그인 전용 계정(카카오/구글 등)은 소셜 제공자 관리 안내를 표시하고 비밀번호 변경 링크를 숨긴다', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'kakao-user-uuid',
          email: 'kakao_owner@kakao.com',
          created_at: '2026-02-10T00:00:00.000Z',
          app_metadata: { provider: 'kakao' },
          identities: [{ provider: 'kakao' }],
        },
      },
      error: null,
    })

    render(<PersonalSettings />)

    await waitFor(() => {
      expect(screen.getByText(/현재 소셜 로그인 계정\(카카오\)으로 이용 중이에요/)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /비밀번호 변경 안내 받기/ })).toBeNull()
    })
  })

  it('프로필 로드 에러(profileLoadError)가 발생하면 경고를 표시하고 편집을 잠근다', () => {
    render(<PersonalSettings initialDisplayName="기존이름" profileLoadError />)

    expect(screen.getByRole('alert')).toHaveTextContent('프로필 정보를 불러오지 못했어요')
    expect(screen.getByLabelText('표시 이름')).toBeDisabled()
    expect(screen.getByRole('button', { name: '이름 저장' })).toBeDisabled()
  })

  it('createBrowserSupabaseClient auth.getUser를 호출하여 로그인 계정 정보(이메일, 가입일, 방식)를 표시한다', async () => {
    render(<PersonalSettings />)

    await waitFor(() => {
      expect(mockGetUser).toHaveBeenCalled()
      expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    })
  })

  it('표시 이름을 변경하여 저장하고 성공 메시지를 안내한다', async () => {
    mockSaveAction.mockResolvedValue({
      ok: true,
      message: '표시 이름을 저장했어요.',
      displayName: '새로운이름',
    })

    render(<PersonalSettings initialDisplayName="기존이름" />)

    const input = screen.getByLabelText('표시 이름')
    expect(input).toHaveValue('기존이름')

    fireEvent.change(input, { target: { value: '새로운이름' } })
    const submitBtn = screen.getByRole('button', { name: '이름 저장' })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockSaveAction).toHaveBeenCalledWith({ displayName: '새로운이름' })
      expect(screen.getByText('표시 이름을 저장했어요.')).toBeInTheDocument()
    })
  })

  it('저장 중 연결이 끊기면 오류를 알리고 다시 저장할 수 있다', async () => {
    mockSaveAction.mockRejectedValue(new Error('network disconnected'))
    render(<PersonalSettings initialDisplayName="기존이름" />)
    fireEvent.click(screen.getByRole('button', { name: '이름 저장' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'))
    await waitFor(() => expect(screen.getByRole('button', { name: '이름 저장' })).toBeEnabled())
    expect(screen.getByLabelText('표시 이름')).toHaveValue('기존이름')
  })

  it('비밀번호 변경은 /forgot-password 경로로의 정확한 안내 링크를 제공한다', async () => {
    render(<PersonalSettings />)

    await waitFor(() => {
      const passwordLink = screen.getByRole('link', { name: /비밀번호 변경 안내 받기/ })
      expect(passwordLink).toHaveAttribute('href', '/forgot-password')
      expect(screen.getByText(/등록된 이메일로 비밀번호 재설정 링크를 받으실 수 있어요/)).toBeInTheDocument()
    })
  })

  it('개인정보 처리방침 링크(/privacy)를 제공한다', async () => {
    render(<PersonalSettings />)

    const privacyLink = screen.getByRole('link', { name: /개인정보 처리방침 보기/ })
    expect(privacyLink).toHaveAttribute('href', '/privacy')
  })

  it('마지막 구분 영역에 회원 탈퇴 영향 안내와 support 메일 문의 링크를 배치하며 접수/완료를 주장하지 않는다', async () => {
    render(<PersonalSettings />)

    expect(screen.getByRole('heading', { level: 2, name: '회원 탈퇴 안내' })).toBeInTheDocument()
    expect(screen.getByText(/탈퇴는 고객센터에서 본인 확인 후 안내해 드려요/)).toBeInTheDocument()
    expect(screen.getByText(/문의만으로 바로 탈퇴되지는 않아요/)).toBeInTheDocument()
    expect(screen.getByText(/가게 소유자 권한이나 관련 법령에 따른 거래·정산 기록 보관 여부를 먼저 확인한 뒤/)).toBeInTheDocument()

    const withdrawalLink = screen.getByRole('link', { name: /회원 탈퇴 문의하기/ })
    expect(withdrawalLink).toHaveAttribute('href', expect.stringContaining('mailto:support@example.com'))

    // 접수 완료나 삭제 완료를 거짓으로 주장하지 않음
    expect(screen.queryByText(/탈퇴가 접수되었습니다/)).toBeNull()
    expect(screen.queryByText(/삭제가 완료되었습니다/)).toBeNull()
  })

  it('계정 정보 조회에 실패했을 때는 비밀번호 변경 링크를 숨기고 확인 실패 안내를 표시한다 (fail-closed)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('Auth error'),
    })

    render(<PersonalSettings />)

    await waitFor(() => {
      expect(screen.getByText(/계정 로그인 방식을 확인하지 못해 비밀번호 변경을 안내할 수 없어요/)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /비밀번호 변경 안내 받기/ })).toBeNull()
    })
  })

  it('모든 링크와 버튼 등 상호작용 요소의 터치 타깃이 44px 이상 클래스(min-h-11 또는 size-11)를 가진다', async () => {
    render(<PersonalSettings />)

    const interactiveLinks = screen.getAllByRole('link')
    for (const link of interactiveLinks) {
      expect(link.className).toMatch(/min-h-11|min-h-\[44px\]|size-11/)
    }

    const buttons = screen.getAllByRole('button')
    for (const btn of buttons) {
      expect(btn.className).toMatch(/min-h-11|min-h-\[44px\]|size-11/)
    }
  })
})
