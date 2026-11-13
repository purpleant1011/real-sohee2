import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EngagementPage from './page'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (...args: any[]) => mockRedirect(...args),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/engagement',
  useSearchParams: () => new URLSearchParams(),
}))

const mockGetCurrentWorkspace = vi.fn()
vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => mockGetCurrentWorkspace(),
}))

// ANI-1753: 페이지가 createServerSupabaseClient() 로 정책을 읽는다. 대역이 없으면
// 테스트 프로세스가 실제 Supabase 로 요청을 보내 기본 타임아웃(5s)에 걸린다.
vi.mock('@/lib/supabase/server', async () =>
  (await import('../../../../tests/unit/helpers/fake-supabase-server')).fakeServerSupabaseModule(),
)

vi.mock('@/features/engagement/engagement-inbox', () => ({
  EngagementInbox: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="engagement-inbox" data-workspace-id={workspaceId}>
      소통함 화면
    </div>
  ),
}))

describe('EngagementPage Route', () => {
  it('redirects to onboarding when workspace context is missing', async () => {
    mockGetCurrentWorkspace.mockResolvedValueOnce(null)
    await EngagementPage()
    expect(mockRedirect).toHaveBeenCalledWith('/app/onboarding')
  })

  it('renders EngagementInbox with resolved workspaceId', async () => {
    mockGetCurrentWorkspace.mockResolvedValueOnce({
      workspaceId: 'ws-1234',
      role: 'owner',
      status: 'active',
    })

    const result = await EngagementPage()
    render(result)
    const inbox = screen.getByTestId('engagement-inbox')
    expect(inbox).toBeInTheDocument()
    expect(inbox).toHaveAttribute('data-workspace-id', 'ws-1234')
  })
})
