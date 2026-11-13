import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { V088AppShell } from '../v088-app-shell'

let mockPathname = '/app'
let mockConversationWorkbenchEnabled = false
vi.mock('@/hooks/use-workspace-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/use-workspace-context')>(),
  useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-test', workspaceName: '예시 매장', conversationWorkbenchEnabled: mockConversationWorkbenchEnabled }),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// Mock Supabase & Auth
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      signOut: () => Promise.resolve(),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null }),
          limit: () => Promise.resolve({ data: [] }),
        }),
      }),
    }),
  }),
}))

// Mock fetch for approvals API
const approvalsResponse = {
  success: true,
  data: {
    autonomyLevel: 'L2',
    items: [],
    autoHandledCount: 0,
    summary: { total: 3, comments: 1, posts: 2, dms: 0, proposals: 0 },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  mockPathname = '/app'
  mockConversationWorkbenchEnabled = false
})

describe('V088AppShell 결정 대기 배지 SSOT 및 5대 탭 통합 검증', () => {
  it('대화 주간 이용한도 및 크레딧 위젯을 사이드바에서 렌더링하지 않는다', async () => {
    mockConversationWorkbenchEnabled = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/conversation-work-status')
      ? { ok: true, json: async () => ({ data: {
        activeJobCount: 0, attentionThreadCount: 0, threads: [],
        creditBalance: { available: 2000, weeklyLimit: 2000, consumed: 0, reserved: 0, policyVersion: 'live' },
        observedAt: '2026-11-02T10:00:00Z',
      } }) }
      : { ok: false, json: async () => ({}) }))
    render(<V088AppShell workspaceId="ws-test"><div>본문</div></V088AppShell>)
    const sidebar = screen.getByTestId('business-world-pane')
    expect(within(sidebar).queryByText('대화 주간 이용한도')).toBeNull()
    expect(within(sidebar).queryByText('소희 크레딧')).toBeNull()
    expect(within(sidebar).queryByText(/제작·광고 크레딧 잔액과 별도/)).toBeNull()
    expect(within(sidebar).queryByText(/크레딧/)).toBeNull()
  })

  it('서버 summary.total이 3일 때 홈 메뉴 배지는 하드코딩 2가 아니라 실제 3으로 렌더링된다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/home/approvals')) {
          return { ok: true, json: async () => approvalsResponse }
        }
        return { ok: false, json: async () => ({}) }
      })
    )

    render(
      <V088AppShell workspaceId="ws-test">
        <div>페이지 본문</div>
      </V088AppShell>
    )

    // 사이드바 오늘(홈) 링크 배지 확인 (서버 응답 비동기 반영 대기)
    const desktopPane = screen.getByTestId('business-world-pane')
    const homeLink = within(desktopPane).getByRole('link', { name: /오늘|홈/ })
    await vi.waitFor(() => {
      expect(homeLink.textContent).toContain('3')
    })
    expect(homeLink.textContent).not.toContain('2')
  })

  it('경로가 /app/content 또는 /app/vault 로 바뀌어도 배지가 2로 리셋되지 않고 서버 집계 3이 유지된다', async () => {
    mockPathname = '/app/vault'

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/home/approvals')) {
          return { ok: true, json: async () => approvalsResponse }
        }
        return { ok: false, json: async () => ({}) }
      })
    )

    render(
      <V088AppShell workspaceId="ws-test">
        <div>보관함 페이지 본문</div>
      </V088AppShell>
    )

    // 보관함 페이지에서도 사이드바 오늘(홈) 배지는 2가 아니라 3
    const desktopPane = screen.getByTestId('business-world-pane')
    const homeLink = within(desktopPane).getByRole('link', { name: /오늘|홈/ })
    await vi.waitFor(() => {
      expect(homeLink.textContent).toContain('3')
    })
    expect(homeLink.textContent).not.toContain('2')

    // 모바일 2차 탭 헤더에 '보관함' 링크가 존재함
    const subNavHeader = screen.getByTestId('mobile-sub-navigation-header')
    expect(within(subNavHeader).getByRole('link', { name: /보관함/ })).toBeDefined()
  })

  it('모바일 하단 내비게이션 5개(오늘, 작업, 고객, 성과, 더보기)와 상단 더보기 버튼이 렌더링된다', async () => {
    render(
      <V088AppShell workspaceId="ws-test">
        <div>페이지 본문</div>
      </V088AppShell>
    )

    // 모바일 하단 탭
    const navElements = screen.getAllByRole('navigation')
    const mobileBottomNav = navElements.find((el) => el.className.includes('fixed bottom-0'))
    expect(mobileBottomNav).toBeDefined()

    const tabs = within(mobileBottomNav!)
    expect(tabs.getByRole('link', { name: /오늘/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /작업/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /고객/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /성과/ })).toBeDefined()
    expect(tabs.getByRole('link', { name: /더보기/ })).toBeDefined()

    // ANI-1664-1: 소희대화 탭은 폐기되고 대화는 헤더/FAB/커맨드바로 진입한다.
    expect(tabs.queryByRole('button', { name: /소희대화/ })).toBeNull()

    // 상단 더보기 버튼
    expect(screen.getByRole('button', { name: /더보기 메뉴 열기/ })).toBeDefined()
  })
})
