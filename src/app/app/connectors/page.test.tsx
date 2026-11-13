import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import ConnectorsPage from './page'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/connectors',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => 'ws-fixture-test',
  useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-fixture-test', workspaceName: '매장' }),
}))

vi.mock('@/features/marketing-connectors/connector-entry', () => ({
  ConnectorEntry: () => <div data-testid="connector-entry-content">커넥터 엔트리</div>,
}))

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

afterEach(() => vi.unstubAllGlobals())

describe('ConnectorsPage 셸 래핑 검증 (Task 1)', () => {
  it('PC 환경에서는 V088AppShell로 감싸져 전역 사이드바가 렌더된다', () => {
    narrow(false)
    render(<ConnectorsPage />)

    expect(screen.getByTestId('connector-entry-content')).toBeInTheDocument()
    expect(screen.getByTestId('business-world-pane')).toBeInTheDocument()
  })

  it('모바일 R2 환경에서는 MobileAppShell과 함께 /app/system 뒤로가기 링크가 제공된다', () => {
    narrow(true)
    render(
      <MobileR2Provider enabled>
        <ConnectorsPage />
      </MobileR2Provider>
    )

    expect(screen.getByTestId('connector-entry-content')).toBeInTheDocument()
    const backBtn = screen.getByRole('button', { name: '뒤로' })
    expect(backBtn).toBeInTheDocument()
  })
})
