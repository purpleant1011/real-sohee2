import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WORK_NEW_FALLBACK_ROUTE } from '../first-post-route-flag'

const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

const mockUseMobileR2Active = vi.hoisted(() => vi.fn())
vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => mockUseMobileR2Active(),
}))

const mockIsFirstPostR2Enabled = vi.hoisted(() => vi.fn())
vi.mock('@/features/mobile-firstpost/first-post-flow', () => ({
  isFirstPostR2Enabled: () => mockIsFirstPostR2Enabled(),
}))

vi.mock('@/features/mobile-firstpost/first-post-entry', () => ({
  FirstPostEntry: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="mobile-first-post-flow" data-workspace={workspaceId} />
  ),
}))

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mobile-app-shell">{children}</div>
  ),
}))

import { FirstPostNewEntry } from '../first-post-new-entry'

describe('FirstPostNewEntry (PC 및 모바일 진입 게이트)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PC 환경(모바일 R2 비활성)에서는 StateView 안내 화면을 표시하고 실제 글쓰기 시작 화면으로 router.replace 한다', () => {
    mockUseMobileR2Active.mockReturnValue(false)
    mockIsFirstPostR2Enabled.mockReturnValue(true)

    render(<FirstPostNewEntry workspaceId="ws-123" />)

    expect(mockReplace).toHaveBeenCalledWith(WORK_NEW_FALLBACK_ROUTE)
    expect(screen.getByText('PC에서는 콘텐츠 허브에서 글을 만듭니다')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /글 만들기 스튜디오로 이동/i })
    expect(link).toHaveAttribute('href', WORK_NEW_FALLBACK_ROUTE)
    expect(screen.queryByTestId('mobile-first-post-flow')).not.toBeInTheDocument()
  })

  it('모바일 R2 활성 환경에서는 MobileAppShell과 FirstPostEntry를 렌더한다', () => {
    mockUseMobileR2Active.mockReturnValue(true)
    mockIsFirstPostR2Enabled.mockReturnValue(true)

    render(<FirstPostNewEntry workspaceId="ws-123" />)

    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.getByTestId('mobile-first-post-flow')).toHaveAttribute('data-workspace', 'ws-123')
  })
})
