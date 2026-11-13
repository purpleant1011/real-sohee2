import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EvidenceRecordListRoute from './page'

const notFoundMock = vi.fn()
vi.mock('next/navigation', () => ({
  notFound: () => notFoundMock(),
}))

const mockIsEvidenceListR2Enabled = vi.fn()
vi.mock('@/features/mobile-results/evidence-list-flag', () => ({
  isEvidenceListR2Enabled: () => mockIsEvidenceListR2Enabled(),
}))

vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: async () => ({ workspaceId: 'ws-123' }),
}))

vi.mock('./evidence-record-list-entry', () => ({
  EvidenceRecordListEntry: ({ metricId }: { metricId: string }) => (
    <div data-testid="evidence-entry">evidence:{metricId}</div>
  ),
}))

describe('EvidenceRecordListRoute (/app/results/[id]/evidence)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('플래그 OFF 상태에서 404 notFound 대신 "아직 준비 중이에요" 와 돌아가기 링크를 V088AppShell 안에서 렌더링한다', async () => {
    mockIsEvidenceListR2Enabled.mockReturnValue(false)

    const jsx = await EvidenceRecordListRoute({
      params: Promise.resolve({ id: 'verifiedPublishedPosts' }),
      searchParams: Promise.resolve({}),
    })
    render(jsx)

    expect(notFoundMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.getByText('아직 준비 중이에요')).toBeInTheDocument()
    const backBtn = screen.getByRole('link', { name: /돌아가기/ })
    expect(backBtn).toHaveAttribute('href', '/app/results/verifiedPublishedPosts')
    expect(screen.queryByTestId('evidence-entry')).toBeNull()
  })

  it('플래그 ON 상태에서는 근거 기록 목록 컴포넌트를 렌더링한다', async () => {
    mockIsEvidenceListR2Enabled.mockReturnValue(true)

    const jsx = await EvidenceRecordListRoute({
      params: Promise.resolve({ id: 'verifiedPublishedPosts' }),
      searchParams: Promise.resolve({}),
    })
    render(jsx)

    expect(notFoundMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('evidence-entry')).toHaveTextContent('evidence:verifiedPublishedPosts')
  })
})
