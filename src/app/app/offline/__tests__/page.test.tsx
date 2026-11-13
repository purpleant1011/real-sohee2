import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Next.js 의 redirect/notFound 는 던져서 렌더를 중단한다.
 * 목이 그냥 undefined 를 돌려주면 페이지가 계속 진행해 '안내가 보이는' 가짜 통과가 난다.
 */
const nav = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('next/navigation', () => nav)

const getCurrentWorkspaceContext = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: () => getCurrentWorkspaceContext(),
}))

vi.mock('../offline-entry', () => ({
  OfflineEntry: () => <div data-testid="offline-entry" />,
}))

import OfflinePage from '../page'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

/** 플래그 판정은 실제 함수에 맡기고 env 만 바꾼다. */
function allowR2() {
  vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
  vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', WORKSPACE_ID)
}

describe('/app/offline 게이트 (ANI-1664)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      role: 'owner',
      status: 'active',
    })
  })

  it('플래그 OFF 면 오늘과 같이 404 다', async () => {
    await expect(OfflinePage()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(nav.notFound).toHaveBeenCalled()
    expect(screen.queryByTestId('offline-entry')).toBeNull()
  })

  it('allowlist 밖 매장도 404 다', async () => {
    vi.stubEnv('MOBILE_R2_UI_ENABLED', '1')
    vi.stubEnv('MOBILE_R2_UI_WORKSPACE_ALLOWLIST', 'other-workspace')

    await expect(OfflinePage()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(nav.notFound).toHaveBeenCalled()
    expect(screen.queryByTestId('offline-entry')).toBeNull()
  })

  it('플래그 ON + allowlist 매장이면 안내를 보여준다', async () => {
    allowR2()

    render(await OfflinePage())

    expect(nav.notFound).not.toHaveBeenCalled()
    expect(screen.getByTestId('offline-entry')).toBeInTheDocument()
  })

  it('매장이 없으면 온보딩으로 보낸다', async () => {
    allowR2()
    getCurrentWorkspaceContext.mockResolvedValue(null)

    await expect(OfflinePage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding')

    expect(nav.redirect).toHaveBeenCalledWith('/app/onboarding')
    expect(nav.notFound).not.toHaveBeenCalled()
  })
})
