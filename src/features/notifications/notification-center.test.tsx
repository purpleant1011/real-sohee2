import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationCenter, NotificationCenterFailure } from './notification-center'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('./actions/manage-notifications', () => ({ saveNotificationPreferencesAction: vi.fn(), markNotificationReadAction: vi.fn() }))
vi.mock('./notifications-realtime', () => ({ NotificationsRealtime: () => null }))

const base = { userId: '10000000-0000-4000-8000-000000000001', preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true } }

describe('NotificationCenter', () => {
  it('isolates a load failure to the notification area and offers a safe retry', () => {
    render(<NotificationCenterFailure />)

    expect(screen.getByText('알림을 불러오지 못했어요. 다른 작업은 계속할 수 있습니다.')).toBeVisible()
    const retry = screen.getByRole('button', { name: '다시 시도' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(document.body).not.toHaveTextContent(/request[_ -]?id|uuid|SUPABASE|OPENAI|home-unavailable/i)
  })

  it('shows the actual empty state and preferences', () => {
    render(<NotificationCenter data={{ ...base, notifications: [] }} workspaceId="20000000-0000-4000-8000-000000000001" />)
    expect(screen.getByRole('heading', { name: '알림' })).toBeInTheDocument()
    expect(screen.getByText('아직 받은 알림이 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '알림 설정 저장' })).toBeEnabled()
  })

  it('shows unread state, safe recovery link, and read action', () => {
    render(<NotificationCenter workspaceId="20000000-0000-4000-8000-000000000001" data={{ ...base, notifications: [{ id: '90000000-0000-4000-8000-000000000001', kind: 'schedule', body: '예약 시각을 확인해 주세요.', href: '/app/schedule', readAt: null, createdAt: '2026-08-09T05:00:00.000Z' }] }} />)
    expect(screen.getByText('읽지 않음')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '관련 화면 열기' })).toHaveAttribute('href', '/app/schedule')
    expect(screen.getByRole('button', { name: '읽음으로 표시' })).toBeEnabled()
  })
})
