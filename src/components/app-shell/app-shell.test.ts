import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/actions', () => ({
  signOutAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

import {
  AppShell,
  appNavigation,
  CONVERSATION_COMPATIBILITY_PATHS,
  isCurrentAppRoute,
} from './app-shell'

const recentThreads = [
  { id: '11111111-1111-4111-8111-111111111111', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '첫 번째 대화', status: 'active' as const, lastMessageAt: '2026-08-19T01:00:00.000Z', createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T01:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '두 번째 대화', status: 'active' as const, lastMessageAt: '2026-08-18T01:00:00.000Z', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z' },
  { id: '33333333-3333-4333-8333-333333333333', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '세 번째 대화', status: 'archived' as const, lastMessageAt: '2026-08-17T01:00:00.000Z', createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T01:00:00.000Z' },
  { id: '44444444-4444-4444-8444-444444444444', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '네 번째 대화', status: 'active' as const, lastMessageAt: '2026-08-16T01:00:00.000Z', createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T01:00:00.000Z' },
  { id: '55555555-5555-4555-8555-555555555555', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '지난달 대화', status: 'active' as const, lastMessageAt: '2026-07-31T01:00:00.000Z', createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T01:00:00.000Z' },
]

describe('app navigation (Prototype V0.86)', () => {
  it('uses the full desktop content width and keeps five-item mobile navigation', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/app-shell/app-shell.module.css'), 'utf8')

    expect(css).toContain('@media (min-width: 1200px)')
    expect(css).toContain('grid-template-columns: 248px minmax(0, 1fr);')
    expect(css).not.toContain('grid-template-columns: minmax(600px, 1fr) 304px;')
  })

  it('exposes the V0.86 primary destinations', () => {
    expect(appNavigation.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: '/app', label: '오늘' },
      { href: '/app/conversations', label: '대화' },
      { href: '/app/engagement', label: '소통함' },
      { href: '/app/customers', label: '고객' },
      { href: '/app/campaigns', label: '캠페인' },
      { href: '/app/plugins', label: '플러그인' },
      { href: '/app/knowledge/harnesses', label: '소희 업무 기준' },
      { href: '/app/content', label: '콘텐츠' },
      { href: '/app/automation', label: '자동화' },
      { href: '/app/reports', label: '성과' },
      { href: '/app/account', label: '나의 소희' },
    ])
    expect(CONVERSATION_COMPATIBILITY_PATHS).toEqual({
      inbox: '/app/inbox',
      work: '/app/work',
    })
  })

  it('provides navigation, full-width primary work, and a compact context menu', () => {
    render(createElement(
      AppShell,
      { activePathname: '/app', userAvatarUrl: 'https://signed.example/user.png' },
      createElement('p', null, '대화 본문'),
    ))

    expect(screen.getByText('V0.8.6 마케팅 운영실')).toBeVisible()
    expect(screen.getByRole('img', { name: '소희 로고' })).toHaveAttribute(
      'src',
      expect.stringContaining('sohee-logo-mark-v1.png'),
    )
    expect(screen.getByRole('img', { name: '내 프로필 사진' })).toHaveAttribute(
      'src',
      'https://signed.example/user.png',
    )
    expect(screen.getByRole('main').closest('[data-v07-contract]')).toHaveAttribute(
      'data-v07-contract',
      'D-01 D-02 D-03',
    )
    expect(screen.getByRole('complementary', { name: '주요 탐색' })).toHaveAttribute('data-v07-column', 'navigation')
    expect(screen.getByRole('main')).toHaveAttribute('data-v07-column', 'primary')
    expect(screen.queryByRole('complementary', { name: '업무 문맥' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '작업공간 빠른 설정' })).toHaveAttribute(
      'href',
      '/app/settings/business',
    )
    for (const conversationLink of screen.getAllByRole('link', { name: '오늘' })) {
      expect(conversationLink).toHaveAttribute('aria-current', 'page')
    }
  })

  it('shows all loaded conversations in monthly groups when active section is conversation', () => {
    const { rerender } = render(createElement(
      AppShell,
      {
        activePathname: '/app/conversations',
        canManageThreads: true,
        recentThreads,
        recentThreadsHasMore: false,
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      createElement('p', null, '대화 본문'),
    ))

    expect(screen.getByRole('navigation', { name: '최근 대화' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /첫 번째 대화/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /세 번째 대화/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /네 번째 대화/ })).toBeInTheDocument()
    expect(screen.getByText('2026년 8월')).toBeInTheDocument()
    expect(screen.getByText('2026년 7월')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '전체 대화 보기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '과거 대화' })).not.toBeInTheDocument()

    rerender(createElement(
      AppShell,
      { activePathname: '/app/schedule', recentThreads },
      createElement('p', null, '일정 본문'),
    ))
    expect(screen.queryByRole('navigation', { name: '최근 대화' })).not.toBeInTheDocument()
  })

  it('keeps the desktop conversation history in a scrollable rail', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/app-shell/app-shell.module.css'), 'utf8')

    expect(css).toContain('overscroll-behavior: contain;')
    expect(css).toContain('scrollbar-gutter: stable;')
  })

  it.each([
    ['/app', 'conversation'],
    ['/app/conversations/thread-1', 'conversation'],
    ['/app/engagement', 'engagement'],
    ['/app/customers', 'customers'],
    ['/app/campaigns', 'campaigns'],
    ['/app/plugins', 'plugins'],
    ['/app/content', 'content'],
    ['/app/schedule', 'schedule'],
    ['/app/reports', 'reports'],
    ['/app/account', 'account'],
  ])('marks %s for its prototype-aligned desktop composition', (activePathname, section) => {
    const { container } = render(createElement(
      AppShell,
      { activePathname },
      createElement('p', null, '화면 본문'),
    ))

    expect(container.firstElementChild).toHaveAttribute('data-app-section', section)
  })

  it('keeps home current only for the app root', () => {
    expect(isCurrentAppRoute('/app', '/app')).toBe(true)
    expect(isCurrentAppRoute('/app/work/content-123', '/app')).toBe(false)
  })

  it('keeps a nested work item current without matching a similarly named route', () => {
    expect(isCurrentAppRoute('/app/work/content-123', '/app/work')).toBe(true)
    expect(isCurrentAppRoute('/app/workflow', '/app/work')).toBe(false)
  })
})
