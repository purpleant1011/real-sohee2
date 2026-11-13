import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ContentPage from './page'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (...args: any[]) => mockRedirect(...args),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/app/content',
  useSearchParams: () => new URLSearchParams(),
}))

const mockGetCurrentWorkspace = vi.fn()
vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => mockGetCurrentWorkspace(),
}))

vi.mock('./content-entry', () => ({
  ContentEntry: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="content-entry" data-workspace-id={workspaceId}>
      콘텐츠 화면
    </div>
  ),
}))

describe('ContentPage Route', () => {
  it('워크스페이스가 없으면 온보딩으로 보낸다', async () => {
    mockGetCurrentWorkspace.mockResolvedValueOnce(null)
    await ContentPage()
    expect(mockRedirect).toHaveBeenCalledWith('/app/onboarding')
  })

  it('확인된 워크스페이스로 화면을 그린다', async () => {
    mockGetCurrentWorkspace.mockResolvedValueOnce({ workspaceId: 'ws-1234', role: 'owner', status: 'active' })
    const result = await ContentPage()
    render(result)
    const entry = screen.getByTestId('content-entry')
    expect(entry).toBeInTheDocument()
    expect(entry).toHaveAttribute('data-workspace-id', 'ws-1234')
  })
})
