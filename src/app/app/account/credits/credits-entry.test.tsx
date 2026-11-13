// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreditViewSnapshot } from '@/features/mobile-settings/credit-view'
import { buildAuthFailureCreditSnapshot } from '@/features/mobile-settings/server/credit-snapshot'

const routerReplace = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/account/credits',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn(), refresh: vi.fn() }),
}))

import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { CreditsEntry } from './credits-entry'

const READY: CreditViewSnapshot = {
  loadState: 'ready',
  credit: { available: 47, reserved: 3, consumed: 40, refunded: 7, observedAt: '2026-10-24T05:00:00.000Z' },
  customerDeposit: null,
  estimate: null,
  checkedAt: '2026-10-24T05:00:00.000Z',
}

function stubWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /\(max-width:\s*(\d+)px\)/.exec(query)
    return {
      matches: max ? px <= Number(max[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

function mount(snapshot: CreditViewSnapshot, enabled: boolean, px: number) {
  stubWidth(px)
  render(
    <MobileR2Provider enabled={enabled}>
      <CreditsEntry snapshot={snapshot} legacy={<p>legacy-credits</p>} />
    </MobileR2Provider>,
  )
}

beforeEach(() => {
  routerReplace.mockClear()
  // R2 크레딧 화면은 조회하지 않는다(서버 스냅샷을 그리기만 한다). 셸이 부르는 것이 있으면 대기시킨다.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => vi.unstubAllGlobals())

describe('크레딧 진입점 — 인증 만료·권한 없음 (ANI-1714)', () => {
  it('R2 모바일에서는 로그인 만료를 기존 화면으로 보내지 않고 사유를 보여 준다', async () => {
    mount(buildAuthFailureCreditSnapshot('expired'), true, 390)

    expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
    expect(screen.queryByText('legacy-credits')).toBeNull()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('R2 모바일에서는 권한 없음을 로그인 만료와 다른 안내로 보여 준다', async () => {
    mount(buildAuthFailureCreditSnapshot('forbidden'), true, 390)

    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.queryByText('로그인이 만료됐어요')).toBeNull()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('R2 가 아닌 화면에서는 기존과 같은 곳으로 보낸다 — 원장을 0 으로 그리지 않는다', async () => {
    mount(buildAuthFailureCreditSnapshot('expired'), false, 390)

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/app/onboarding'))
    expect(screen.queryByText('legacy-credits')).toBeNull()
    expect(screen.queryByText('0 크레딧')).toBeNull()
  })

  it('인증 문제가 없으면 기존 화면을 그대로 그린다', () => {
    mount(READY, false, 390)

    expect(screen.getByText('legacy-credits')).toBeVisible()
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('PC 폭에서는 인증 스냅샷이어도 R2 화면을 띄우지 않고 기존 경로로 보낸다', async () => {
    mount(buildAuthFailureCreditSnapshot('forbidden'), true, 1024)

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/app/onboarding'))
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  })

})
