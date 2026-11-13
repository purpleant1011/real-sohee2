import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: () => {} }) }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'fixture-ws' }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
import { MobileApprovalPage } from './mobile-approval-page'
afterEach(() => vi.unstubAllGlobals())
it('목록 조회 실패는 "할 일 없음"으로 보이지 않고 없다는 뜻이 아님을 알려준다', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('network') })
  render(<MobileApprovalPage />)
  expect(await screen.findByText(/조회가 실패했다고 해서 확인할 일이 없는 것은 아니에요/)).toBeVisible()
  expect(screen.queryByText('지금 확인하실 일은 없어요')).not.toBeInTheDocument()
})
