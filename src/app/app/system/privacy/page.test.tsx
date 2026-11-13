import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    mockRedirect(path)
    throw new Error('NEXT_REDIRECT')
  },
  usePathname: () => '/app/system/privacy',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

const mockGetClaims = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getClaims: mockGetClaims,
    },
    from: vi.fn(() => ({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    })),
  })),
}))

vi.mock('@/features/account/profile-image-repository', () => ({
  createProfileImageGateway: vi.fn(() => ({})),
  getProfileImageUrl: vi.fn(async () => 'https://example.com/avatar.jpg'),
}))

vi.mock('@/features/mobile-settings/personal-settings', () => ({
  PersonalSettings: ({
    initialAvatarUrl,
    initialDisplayName,
    profileLoadError,
  }: {
    initialAvatarUrl: string | null
    initialDisplayName: string | null
    profileLoadError?: boolean
  }) => (
    <div data-testid="personal-settings-mock">
      <span>avatar: {initialAvatarUrl ?? 'null'}</span>
      <span>name: {initialDisplayName ?? 'null'}</span>
      <span>error: {profileLoadError ? 'true' : 'false'}</span>
    </div>
  ),
}))

import PersonalPrivacyPage from './page'

describe('PersonalPrivacyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('비로그인 세션이면 /login으로 redirect한다', async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: new Error('No session') })

    await expect(PersonalPrivacyPage()).rejects.toThrow('NEXT_REDIRECT')

    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('로그인 세션이면 프로필 이미지 및 표시 이름을 조회하여 PersonalSettings에 전달한다', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'auth-user-id' } },
      error: null,
    })
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: '테스트대표' },
      error: null,
    })

    const element = await PersonalPrivacyPage()
    render(element)

    expect(screen.getByTestId('personal-settings-mock')).toBeInTheDocument()
    expect(screen.getByText('avatar: https://example.com/avatar.jpg')).toBeInTheDocument()
    expect(screen.getByText('name: 테스트대표')).toBeInTheDocument()
    expect(screen.getByText('error: false')).toBeInTheDocument()
  })

  it('프로필 조회 실패 시 profileLoadError 플래그를 전달한다', async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: 'auth-user-id' } },
      error: null,
    })
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'Database query failed' },
    })

    const element = await PersonalPrivacyPage()
    render(element)

    expect(screen.getByTestId('personal-settings-mock')).toBeInTheDocument()
    expect(screen.getByText('error: true')).toBeInTheDocument()
  })
})
