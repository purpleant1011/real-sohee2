import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { NotificationList } from './notification-list'
const navigation = vi.hoisted(() => ({ replace: vi.fn(), query: '' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: navigation.replace, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(navigation.query) }))
vi.mock('@/features/notifications/actions/manage-notifications', () => ({ markNotificationReadAction: vi.fn() }))
const data = { userId: 'user', preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true }, notifications: [
  { id: 'published', kind: 'publish' as const, body: '게시 처리 상태를 확인해 주세요.', href: '/app/work/11111111-1111-4111-8111-111111111111?from=%2Fapp%2Fcontent#preview', readAt: null, createdAt: '2026-11-03T00:00:00Z' },
  { id: 'system', kind: 'system' as const, body: '기타 안내', href: null, readAt: null, createdAt: '2026-11-03T00:00:00Z' },
] }
beforeEach(() => { navigation.query = ''; navigation.replace.mockReset() })
it('restores the publish filter from the URL on returning to notifications', () => {
  navigation.query = 'kind=publish'
  render(<NotificationList data={data} workspaceId="w1" />)
  expect(screen.getByRole('tab', { name: '게시' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByText('기타 안내')).toBeNull()
})
it('supports arrow-key filter selection and focus instead of requiring pointer input', () => {
  render(<NotificationList data={data} workspaceId="w1" />)
  const all = screen.getByRole('tab', { name: '전체' })
  all.focus()
  fireEvent.keyDown(all, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: '승인' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: '승인' })).toHaveAttribute('aria-selected', 'true')
})
it('keeps the selected filter in the return URL and replaces stale from parameters', () => {
  render(<NotificationList data={data} workspaceId="w1" />)
  fireEvent.click(screen.getByRole('tab', { name: '게시' }))
  expect(navigation.replace).toHaveBeenCalledWith('/app/notifications?kind=publish', { scroll: false })
  const href = screen.getByRole('link', { name: '관련 화면 열기' }).getAttribute('href')!
  const target = new URL(href, 'https://example.test')
  expect(target.searchParams.getAll('from')).toEqual(['/app/notifications?kind=publish'])
  expect(target.hash).toBe('#preview')
})
it('필터 탭 목록이 가로 스크롤 snap 및 shrink-0 whitespace-nowrap, min-h-11 터치 크기를 준수한다', () => {
  render(<NotificationList data={data} workspaceId="w1" />)
  const tablist = screen.getByRole('tablist', { name: '알림 종류' })
  expect(tablist.className).toContain('overflow-x-auto')
  expect(tablist.className).toContain('snap-x')
  const tabs = screen.getAllByRole('tab')
  for (const tab of tabs) {
    expect(tab.className).toContain('shrink-0')
    expect(tab.className).toContain('whitespace-nowrap')
    expect(tab.className).toContain('min-h-11')
  }
})
