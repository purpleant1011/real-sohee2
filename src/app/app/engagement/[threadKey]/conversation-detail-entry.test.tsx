import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const context = vi.hoisted(() => ({ active: false, replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: context.replace }) }))
vi.mock('@/features/mobile-shell/r2-gate', () => ({ useMobileR2Active: () => context.active }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'workspace-a' }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <main aria-label="PC 작업 공간">{children}</main> }))
vi.mock('@/features/mobile-inbox/r2-conversation-detail', () => ({ R2ConversationDetail: ({ workspaceId, threadKey, embedded }: { workspaceId: string; threadKey: string; embedded?: boolean }) => <p data-testid="conversation" data-workspace={workspaceId} data-key={threadKey} data-embedded={String(!!embedded)}>대화 원장 조회</p> }))
import { ConversationDetailEntry } from './conversation-detail-entry'
beforeEach(() => { context.active = false; context.replace.mockReset() })
it('keeps a desktop review on the exact source conversation instead of redirecting to the list', () => {
  render(<ConversationDetailEntry threadKey="dm%3A11111111-1111-4111-8111-111111111111" />)
  expect(screen.getByTestId('conversation')).toHaveAttribute('data-key', 'dm:11111111-1111-4111-8111-111111111111')
  expect(screen.getByTestId('conversation')).toHaveAttribute('data-workspace', 'workspace-a')
  expect(screen.getByTestId('conversation')).toHaveAttribute('data-embedded', 'true')
  expect(screen.getByRole('main', { name: 'PC 작업 공간' })).toBeVisible()
  expect(context.replace).not.toHaveBeenCalled()
})
it('retains the mobile presentation and the same source identity when R2 is active', () => {
  context.active = true
  render(<ConversationDetailEntry threadKey="dm:11111111-1111-4111-8111-111111111111" />)
  expect(screen.getByTestId('conversation')).toHaveAttribute('data-embedded', 'false')
  expect(screen.queryByRole('main', { name: 'PC 작업 공간' })).toBeNull()
  expect(context.replace).not.toHaveBeenCalled()
})
