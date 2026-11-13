import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeMobileApproval, fixtureItemKey } from './test-fixtures'
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`item=${encodeURIComponent(fixtureItemKey)}`), useRouter: () => ({ replace: () => {} }) }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'fixture-ws' }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
import { MobileApprovalPage } from './mobile-approval-page'
afterEach(() => vi.unstubAllGlobals())
it('loads only authorized read endpoints and exposes no R1 dispatch', async () => {
  const methods: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET')
    if (url.includes('mobile-approvals')) return Response.json(makeMobileApproval())
    throw new Error('unexpected endpoint')
  })
  render(<MobileApprovalPage />)
  expect(await screen.findByText('서비스를 알려주시면 확인해 드릴게요.')).toBeVisible()
  expect(screen.getByText('테스트 예시는 전송하지 않아요.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '승인하고 전송' })).not.toBeInTheDocument()
  expect(methods).toEqual(['GET'])
})
