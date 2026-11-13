import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WORK_NEW_FALLBACK_ROUTE } from '../first-post-route-flag'

/** Next.js 의 redirect 는 던져서 렌더를 중단한다. 목이 조용히 돌려주면 가짜 통과가 난다. */
const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('next/navigation', () => nav)

const getCurrentWorkspaceContext = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))

vi.mock('../first-post-new-entry', () => ({
  FirstPostNewEntry: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="first-post-entry" data-workspace={workspaceId} />
  ),
}))

import NewWorkPage from '../page'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

function allowFirstPostRoute() {
  vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
  vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WORKSPACE_ID)
  vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: WORKSPACE_ID, role: 'owner', status: 'active' })
})

describe('/app/work/new 첫 포스팅 실라우트 (ANI-1767)', () => {
  it('플래그 OFF 면 실제 글쓰기 시작 화면(/app/content 4채널 스튜디오)으로 이동한다', async () => {
    await expect(NewWorkPage()).rejects.toThrow(`NEXT_REDIRECT:${WORK_NEW_FALLBACK_ROUTE}`)
    expect(nav.redirect).toHaveBeenCalledWith(WORK_NEW_FALLBACK_ROUTE)
  })

  it('allowlist 밖 매장도 실제 글쓰기 시작 화면으로 간다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'other-workspace')
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'on')

    await expect(NewWorkPage()).rejects.toThrow(`NEXT_REDIRECT:${WORK_NEW_FALLBACK_ROUTE}`)
    expect(nav.redirect).toHaveBeenCalledWith(WORK_NEW_FALLBACK_ROUTE)
  })

  it('R2 는 켜졌지만 첫 포스팅 플래그가 없으면 실제 글쓰기 시작 화면으로 보낸다', async () => {
    allowFirstPostRoute()
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', 'off')

    await expect(NewWorkPage()).rejects.toThrow(`NEXT_REDIRECT:${WORK_NEW_FALLBACK_ROUTE}`)
    expect(nav.redirect).toHaveBeenCalledWith(WORK_NEW_FALLBACK_ROUTE)
  })

  it("'1' 은 켜짐이 아니다 — 화면 계약과 같은 문자열 비교다", async () => {
    allowFirstPostRoute()
    vi.stubEnv('NEXT_PUBLIC_MOBILE_R2_FIRSTPOST', '1')

    await expect(NewWorkPage()).rejects.toThrow(`NEXT_REDIRECT:${WORK_NEW_FALLBACK_ROUTE}`)
    expect(nav.redirect).toHaveBeenCalledWith(WORK_NEW_FALLBACK_ROUTE)
  })

  it('두 플래그가 모두 켜지면 첫 포스팅 진입점을 마운트한다', async () => {
    allowFirstPostRoute()

    render(await NewWorkPage())

    expect(screen.getByTestId('first-post-entry')).toHaveAttribute('data-workspace', WORKSPACE_ID)
    expect(nav.redirect).not.toHaveBeenCalled()
  })

  it('매장이 없으면 온보딩으로 보낸다', async () => {
    allowFirstPostRoute()
    getCurrentWorkspaceContext.mockResolvedValue(null)

    await expect(NewWorkPage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding')
  })
})
