import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CustomersPage from '@/app/app/customers/customers-view'

const { workspace } = vi.hoisted(() => ({ workspace: { id: 'workspace-a' } }))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => workspace.id }))
vi.mock('@/features/reporting/weekly-truth-summary', () => ({ WeeklyTruthSummary: () => null }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: React.PropsWithChildren) => <div>{children}</div> }))
vi.mock('@/components/agent-os/sohee-live-workboard', () => ({ SoheeLiveWorkboard: () => null }))
vi.mock('@/components/v088/customers/customer-closed-loop-trace', () => ({ CustomerClosedLoopTrace: () => null }))
vi.mock('@/components/v088/customers/reservation-dialog', () => ({ ReservationDialog: () => null }))
vi.mock('@/components/v088/customers/reservation-calendar-view', () => ({ ReservationCalendarView: () => null }))
vi.mock('@/features/booking-recovery/components/recovery-card', () => ({ RecoveryCard: () => null }))
vi.mock('@/features/empty-states/empty-state', () => ({ EmptyState: () => <p>문의 없음</p>, ComingSoonRoadmap: () => null }))
vi.mock('next/link', () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }))

function pipeline(name: string) {
  return { ok: true, json: async () => ({ datasetMode: 'ACTUAL', reservations: [], items: [{ id: name, name,
    handle: '@test', channel: 'instagram', channelLabel: '인스타 DM', channelColor: '',
    lastMessage: '예약 문의', lastMessageTime: '', urgency: 'medium', bookingIntent: true,
    stage: 'inquiry', stageLabel: '문의 접수', stageColor: '', unread: false, dialogueHistory: [],
  }] }) }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); workspace.id = 'workspace-a'; window.history.replaceState(null, '', '/') })

describe('customer actual-data consumer', () => {
  it('does not present excluded data as an observed empty customer list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ datasetMode: 'EXCLUDED', items: [], reservations: [] }) })))
    render(<CustomersPage />)
    await screen.findByText('실제 운영 자료로 확인되지 않아 고객 목록 집계에서 제외했어요.')
    expect(screen.queryByText('문의 없음')).toBeNull()
  })
  it('does not replace a missing reservation deep link with another customer after reload', async () => {
    window.history.replaceState(null, '', '/app/customers#reservation-missing')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/customers/pipeline') ? pipeline('기본 선택하면 안 되는 고객') : { ok: true, json: async () => ({ cases: [] }) }))
    render(<CustomersPage />)
    await screen.findByRole('alert')
    expect(screen.queryAllByText('기본 선택하면 안 되는 고객')).toHaveLength(0)
  })

  it('ignores a previous workspace response that arrives after the current one', async () => {
    let resolveA!: (value: unknown) => void
    const deferredA = new Promise((resolve) => { resolveA = resolve })
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/customers/pipeline')
      ? url.includes('workspace-a') ? deferredA : Promise.resolve(pipeline('현재 사업장 고객'))
      : Promise.resolve({ ok: true, json: async () => ({ cases: [] }) })))
    const view = render(<CustomersPage />)
    workspace.id = 'workspace-b'
    view.rerender(<CustomersPage />)
    await screen.findAllByText('현재 사업장 고객')
    await act(async () => resolveA(pipeline('이전 사업장 고객')))
    expect(screen.queryAllByText('이전 사업장 고객')).toHaveLength(0)
    expect(screen.getAllByText('현재 사업장 고객').length).toBeGreaterThan(0)
  })
})
