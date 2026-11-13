import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  getMembershipTier: vi.fn().mockResolvedValue('FORMAL'),
  getSoheeReadiness: vi.fn().mockResolvedValue({ ready: true, blockers: [] }),
  resolveAppShellMode: vi.fn().mockReturnValue('APP_SHELL'),
  isApplicationSubmitted: vi.fn().mockReturnValue(true),
  resolveAppEntryRedirect: vi.fn().mockReturnValue(null),
  evaluateReadiness: vi.fn().mockReturnValue({ prepared: true }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-sohee-pathname': '/app/schedule?view=week' })),
  // ANI-1779: 활성 가게 선택은 httpOnly 쿠키로 읽는다.
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn() })),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('../../lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))
vi.mock('../../lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))
vi.mock('@/features/membership/membership-tier', () => ({
  getMembershipTier: mocks.getMembershipTier,
}))
vi.mock('@/features/sohee-ready/read-model', () => ({
  getSoheeReadiness: mocks.getSoheeReadiness,
}))
vi.mock('@/features/sohee-ready/shell-resolver', () => ({
  resolveAppShellMode: mocks.resolveAppShellMode,
}))
vi.mock('@/features/business-verification/entry-gate', () => ({
  isApplicationSubmitted: mocks.isApplicationSubmitted,
  resolveAppEntryRedirect: mocks.resolveAppEntryRedirect,
}))
vi.mock('@/features/readiness', () => ({
  evaluateReadiness: mocks.evaluateReadiness,
}))
vi.mock('../../components/app-shell/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}))

import ProtectedAppLayout from './protected-app-content'
import { headers } from 'next/headers'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

describe('ProtectedAppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('비로그인 상태일 때 /login?next=... 로 fail-closed 리다이렉트한다', async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: null }) },
    })
    await expect(ProtectedAppLayout({ children: <div>대화</div> })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fapp%2Fschedule%3Fview%3Dweek'
    )
  })

  it('로그인했으나 소속 워크스페이스가 없을 때 /app/onboarding 으로 리다이렉트한다', async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: 'user-no-ws' } } }) },
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [] }),
      })),
    })
    await expect(ProtectedAppLayout({ children: <div>대화</div> })).rejects.toThrow(
      'NEXT_REDIRECT:/app/onboarding'
    )
  })

  it('소속 가게가 없는 인증 사용자의 onboarding 자체는 루프 없이 열고 보호 데이터는 조회하지 않는다', async () => {
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ 'x-sohee-pathname': '/app/onboarding' }) as never)
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: { claims: { sub: 'new-user' } } }) },
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) })
    const result = await ProtectedAppLayout({ children: <div>onboarding-child</div> })
    expect(result).toBeTruthy()
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled()
  })

  it('비로그인 복귀 경로는 앱 내부 경로로 제한한다', async () => {
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ 'x-sohee-pathname': 'https://untrusted.invalid' }) as never)
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getClaims: async () => ({ data: null }) } })
    await expect(ProtectedAppLayout({ children: <div>private-child</div> })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fapp')
  })

  it('로그인 사용자의 워크스페이스 등급 조회 시 session client가 아닌 admin client로 getMembershipTier를 호출한다', async () => {
    const mockSessionSupabase = {
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: 'user-456' } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ workspace_id: '11111111-1111-4111-8111-111111111111', role: 'owner', status: 'active' }],
            }),
          }
        }
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { name: '테스트 워크스페이스' } }),
          }
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'VERIFIED', document_url: 'https://example.com/doc' } }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
    }

    const mockAdminSupabase = {
      rpc: vi.fn(),
      from: vi.fn(),
    }

    mocks.createServerSupabaseClient.mockResolvedValue(mockSessionSupabase)
    mocks.createAdminSupabaseClient.mockReturnValue(mockAdminSupabase)

    const view = await ProtectedAppLayout({ children: <div>대화</div> })
    expect(view).toBeDefined()
    expect(mocks.createAdminSupabaseClient).toHaveBeenCalled()
    expect(mocks.getMembershipTier).toHaveBeenCalledWith(mockAdminSupabase, '11111111-1111-4111-8111-111111111111')
    expect(mocks.getMembershipTier).not.toHaveBeenCalledWith(mockSessionSupabase, expect.anything())
  })

  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', true],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1', true],
    ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', true],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1', false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Safari/605.1.15', false],
    ['', false],
  ])('인증된 요청 UA=%s의 첫 HTML 힌트는 %s이며 권한 플래그와 분리한다', async (ua, initialMobile) => {
    vi.mocked(headers).mockResolvedValueOnce(new Headers({ 'user-agent': ua }) as Awaited<ReturnType<typeof headers>>)
    const query: any = {
      select: () => query, eq: () => query,
      order: async () => ({ data: [{ workspace_id: '11111111-1111-4111-8111-111111111111', role: 'owner', status: 'active' }] }),
      maybeSingle: async () => ({ data: { name: '테스트 가게', status: 'VERIFIED' } }),
    }
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: 'owner' } } }) }, from: () => query,
    })
    vi.stubEnv('MOBILE_R2_UI_ENABLED', 'all')
    try {
      const view = await ProtectedAppLayout({ children: <div>본문</div> })
      const provider = view.props.children
      expect(provider.type).toBe(MobileR2Provider)
      expect(provider.props.initialMobile).toBe(initialMobile)
      expect(provider.props.enabled).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('인가된 가게의 이름·준비·신청·등급은 서로 기다리지 않고 시작한다', async () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111'
    function deferred<T>() {
      let resolve!: (value: T) => void
      const promise = new Promise<T>(done => { resolve = done })
      return { promise, resolve }
    }
    const names = deferred<{ data: { name: string } }>()
    const business = deferred<{ data: { status: string; document_url: null } }>()
    const readiness = deferred<{ ready: boolean; blockers: never[] }>()
    const tier = deferred<string>()
    const started: string[] = []
    const session = {
      auth: { getClaims: async () => ({ data: { claims: { sub: 'owner' } } }) },
      from: vi.fn((table: string) => {
        const query: any = {
          select: () => query, eq: () => query,
          order: async () => ({ data: [{ workspace_id: workspaceId, role: 'owner', status: 'active' }] }),
          maybeSingle: () => {
            started.push(table)
            return table === 'workspaces' ? names.promise : business.promise
          },
        }
        return query
      }),
    }
    const admin = { serverOnly: true }
    mocks.createServerSupabaseClient.mockResolvedValue(session)
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    mocks.getSoheeReadiness.mockImplementationOnce(() => { started.push('readiness'); return readiness.promise })
    mocks.getMembershipTier.mockImplementationOnce(() => { started.push('tier'); return tier.promise })
    const job = ProtectedAppLayout({ children: <div>본문</div> })
    try {
      await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(['workspaces', 'business_verifications', 'readiness', 'tier'])))
    } finally {
      names.resolve({ data: { name: '테스트 매장' } })
      business.resolve({ data: { status: 'VERIFIED', document_url: null } })
      readiness.resolve({ ready: true, blockers: [] })
      tier.resolve('FORMAL')
      await job
    }
    expect(mocks.getSoheeReadiness).toHaveBeenCalledWith(workspaceId, { supabaseClient: session, adminClient: admin })
  })

  it('활성 멤버십 조회 실패 시 보호 데이터 조회나 admin 생성으로 진행하지 않는다', async () => {
    const query: any = {
      select: () => query, eq: () => query,
      order: async () => ({ data: null, error: { message: 'unavailable' } }),
    }
    const from = vi.fn(() => query)
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: 'owner' } } }) }, from,
    })
    await expect(ProtectedAppLayout({ children: <div>본문</div> })).rejects.toThrow(
      'WORKSPACE_MEMBERSHIP_UNAVAILABLE'
    )
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('workspace_members')
    expect(mocks.getSoheeReadiness).not.toHaveBeenCalled()
    expect(mocks.getMembershipTier).not.toHaveBeenCalled()
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled()
  })
})
