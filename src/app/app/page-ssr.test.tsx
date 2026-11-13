// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

const workspaceId = '11111111-1111-4111-8111-111111111111'
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`) },
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('@/features/auth/active-workspace.server', () => ({ readPreferredWorkspaceIdFromCookies: async () => null }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'local-ssr-user' } }, error: null }) },
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: [{ workspace_id: '11111111-1111-4111-8111-111111111111', role: 'owner', status: 'active' }], error: null }),
      }
      return query
    },
  }),
}))
import AppHomePage from './page'

describe('실제 홈 컴포넌트의 브라우저 없는 첫 HTML', () => {
  it('iPhone 첫 HTML은 구형 홈 없이 실제 R2 메뉴와 조회 중 상태를 제공한다', async () => {
    const page = await AppHomePage()
    const html = renderToString(
      <WorkspaceProvider value={{ workspaceId, workspaceName: '로컬 SSR fixture', workspaceKind: null, membershipRole: 'owner', actorId: 'local-ssr-user', resolutionSource: 'membership' }}>
        <MobileR2Provider enabled initialMobile>{page}</MobileR2Provider>
      </WorkspaceProvider>,
    )
    expect(html).toContain('data-mobile-shell')
    expect(html).toContain('소희 업무 메뉴')
    expect(html).not.toContain('사장님, 오늘도 소희가 함께해요')
    expect(html).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING')
  })
  it.each([false, true])('R2 provider=%s도 클라이언트 다운로드 전에 본문을 제공하고 화면 연결 도움은 노출하지 않는다', async (enabled) => {
    expect(typeof window).toBe('undefined')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const page = await AppHomePage()
      const html = renderToString(
        <WorkspaceProvider value={{ workspaceId, workspaceName: '로컬 SSR fixture', workspaceKind: null, membershipRole: 'owner', actorId: 'local-ssr-user', resolutionSource: 'membership' }}>
          <MobileR2Provider enabled={enabled}>{page}</MobileR2Provider>
        </WorkspaceProvider>,
      )
      expect(html).toContain('사장님, 오늘도 소희가 함께해요')
      expect(html).not.toContain('앱 다시 열기')
      expect(html).not.toContain('화면 연결 도움')
      expect(html).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING')
      expect(fetchSpy).not.toHaveBeenCalled()
      // Optional local visual fixture: real page/components, synthetic identity, no API calls.
      const preview = process.env.SOHEE_HOME_SSR_PREVIEW_PATH
      if (preview && !enabled) {
        mkdirSync(dirname(preview), { recursive: true })
        writeFileSync(preview, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><p>로컬 SSR fixture · 신원은 합성 · JS/API 없음</p>${html}</body></html>`)
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
