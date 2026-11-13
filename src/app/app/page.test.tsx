import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

vi.mock('@/components/home-today/today-home', () => ({
  TodayHome: ({ workspaceId }: { workspaceId: string }) => (
    <main data-workspace-id={workspaceId}><h1>오늘 업무</h1></main>
  ),
}))

import AppHomePage from './page'

describe('AppHomePage Fail-Closed Workspace Resolution (ANI-751)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /login when user is unauthenticated', async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    })

    await expect(AppHomePage()).rejects.toThrow('NEXT_REDIRECT:/login')
  })

  it('renders explicit error screen when membership query fails (no ws-default fallback)', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)

    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue(query),
    })

    const view = await AppHomePage()
    expect(view).toBeDefined()
    expect(view.props['data-testid']).toBe('workspace-resolution-error')
  })

  it('redirects to /start when user has zero memberships', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)

    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue(query),
    })

    await expect(AppHomePage()).rejects.toThrow('NEXT_REDIRECT:/start')
  })

  it('renders TodayHome with resolved workspaceId when user has valid membership', async () => {
    const validUuid = '11111111-1111-4111-8111-111111111111'
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn().mockResolvedValue({
        data: [{ workspace_id: validUuid, role: 'owner', status: 'active' }],
        error: null,
      }),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)

    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-1' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue(query),
    })

    const view = await AppHomePage()
    const html = renderToString(view)
    // A stalled client chunk must not leave the installed app with skeleton-only HTML.
    expect(html).toContain('<h1>오늘 업무</h1>')
    expect(html).toContain(`data-workspace-id="${validUuid}"`)
    expect(html).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING')
    expect(html).not.toContain('오늘 할 일을 불러오고 있어요.')
    // 화면 연결 도움은 대화에서 제공하며 홈 위에 별도 버튼을 덮지 않는다.
    expect(html).not.toContain('화면 연결 도움')
    expect(html).not.toContain('앱 다시 열기')
    expect(html).not.toContain('method="post"')
  })
})
