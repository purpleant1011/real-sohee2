import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

import { AppShell, resolveWorkspaceLabel } from './app-shell'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'

const ctx = (workspaceName: string | null) => ({
  workspaceId: '10000000-0000-4000-8000-000000000001',
  workspaceName,
  workspaceKind: null,
  membershipRole: 'owner',
  actorId: 'u1',
  resolutionSource: 'membership' as const,
})

describe('ANI-1779 workspace name truth', () => {
  it('given membership name, when resolved, then shows the server name as verified', () => {
    expect(resolveWorkspaceLabel(ctx('바이름 강남점'))).toEqual({ text: '바이름 강남점', verified: true })
  })
  it('given blank name, when resolved, then shows honest unavailable label, never a fake store name', () => {
    const r = resolveWorkspaceLabel(ctx('  '))
    expect(r.verified).toBe(false)
    expect(r.text).not.toContain('우리 매장')
  })
  it('given no workspace context, when resolved, then reports not connected', () => {
    expect(resolveWorkspaceLabel(null)).toEqual({ text: '작업공간 연결 안 됨', verified: false })
  })
  it('given provider with name, when AppShell renders, then header shows that name and no hardcoded one', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: null }))
    render(
      <WorkspaceProvider value={ctx('바이름 강남점')}>
        <AppShell>x</AppShell>
      </WorkspaceProvider>,
    )
    expect(screen.getByRole('button', { name: '작업공간 선택: 바이름 강남점' })).toBeInTheDocument()
    expect(screen.queryByText('우리 매장')).toBeNull()
  })
  it('given no provider, when AppShell renders, then header shows not-connected state', () => {
    render(<AppShell>x</AppShell>)
    // 상단 바의 작업공간 선택 버튼이 미연결 상태를 정직하게 알린다.
    expect(screen.getByRole('button', { name: '작업공간 선택: 작업공간 연결 안 됨' })).toBeInTheDocument()
  })
})
