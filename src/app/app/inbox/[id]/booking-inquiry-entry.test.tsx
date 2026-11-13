import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const nav = vi.hoisted(() => ({ active: false, replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace }) }))
vi.mock('@/features/mobile-shell/r2-gate', () => ({ useMobileR2Active: () => nav.active }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => 'workspace-a' }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('@/features/mobile-inbox/r2-booking-timeline', () => ({ R2BookingTimeline: ({ caseId, workspaceId, embedded }: { caseId: string; workspaceId: string; embedded?: boolean }) => <p data-testid="booking" data-case={caseId} data-workspace={workspaceId} data-embedded={String(!!embedded)}>예약 원장</p> }))
import { BookingInquiryEntry } from './booking-inquiry-entry'
beforeEach(() => { nav.active = false; nav.replace.mockReset() })
it('keeps the PC booking review on the exact case instead of bouncing to the inbox', () => {
  render(<BookingInquiryEntry caseId="case-a" />)
  expect(screen.getByTestId('booking')).toHaveAttribute('data-case', 'case-a')
  expect(screen.getByTestId('booking')).toHaveAttribute('data-workspace', 'workspace-a')
  expect(screen.getByTestId('booking')).toHaveAttribute('data-embedded', 'true')
  expect(nav.replace).not.toHaveBeenCalled()
})
it('keeps the mobile booking presentation when R2 is active', () => {
  nav.active = true
  render(<BookingInquiryEntry caseId="case-a" />)
  expect(screen.getByTestId('booking')).toHaveAttribute('data-embedded', 'false')
})
