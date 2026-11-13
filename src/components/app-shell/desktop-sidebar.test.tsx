import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { DesktopSidebar } from './desktop-sidebar'

describe('DesktopSidebar work status', () => {
  it('shows active API work and the current weekly credit ratio', () => {
    render(<DesktopSidebar
      items={[]}
      pathname="/app"
      workspaceId="10000000-0000-4000-8000-000000000001"
      workspaceStatus="작업공간 연결됨 · 소유자"
      workStatus={{
        activeJobCount: 2,
        attentionThreadCount: 0,
        threads: [],
        creditBalance: { available: 1253, weeklyLimit: 2000, consumed: 700, reserved: 47, policyVersion: 'v08-test-2000-1' },
        observedAt: '2026-08-22T14:00:00.000Z',
      }}
    />)

    expect(screen.getByRole('complementary', { name: '주요 탐색' })).toHaveTextContent('작업 중 · 2개')
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/1253/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2000/)).not.toBeInTheDocument()
  })
})
