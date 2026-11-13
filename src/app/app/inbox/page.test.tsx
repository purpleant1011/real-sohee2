import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InboxPage from './inbox-legacy'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-shell">{children}</div>,
}))

vi.mock('@/lib/read-models/inbox-read-model', async () => {
  const actual = await vi.importActual<any>('@/lib/read-models/inbox-read-model')
  return {
    ...actual,
    getInboxReadModel: (params: any) => actual.getInboxReadModel({ ...params, isDemo: true }),
  }
})

const mockWorkspace = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workspaceName: 'Test Workspace',
  workspaceKind: 'standard',
  membershipRole: 'owner',
  actorId: 'user-1',
  resolutionSource: 'membership' as const,
}

describe('V0.8.7 customer channel inbox route', () => {
  it('renders the renewed delegation inbox and lists conversations', () => {
    render(
      <WorkspaceProvider value={mockWorkspace}>
        <InboxPage />
      </WorkspaceProvider>
    )
    expect(screen.getByTestId('pc-shell')).toBeInTheDocument()
    expect(screen.getByText('통합 문의함 (고객 소통)')).toBeInTheDocument()
    expect(screen.getByText('김*아 님')).toBeInTheDocument()
    expect(screen.getByText('소희 매장 기억 기반 추천 답변')).toBeInTheDocument()
  })
})
