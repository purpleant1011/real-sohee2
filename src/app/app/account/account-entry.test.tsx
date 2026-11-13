import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import type { AccountSettingsProp } from '@/features/mobile-settings/account-settings-model'
import { AccountEntry } from './account-entry'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/account',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/features/mobile-settings/r2-account', () => ({ R2Account: () => <p>r2-account</p> }))

const BUSINESS = { businessName: '바이름', industry: '뷰티', location: '서울', summary: '요약' }

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean, settings: AccountSettingsProp = { ok: true, business: BUSINESS, canEdit: true }) {
  const tree = <AccountEntry settings={settings} legacy={<p>legacy-account</p>} />
  return render(r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree)
}

afterEach(() => vi.unstubAllGlobals())

describe('/app/account 배선(ANI-1771)', () => {
  it('플래그 OFF(기본) 이면 기존 화면 그대로다', () => {
    narrow(true)
    renderEntry(false)
    expect(screen.getByText('legacy-account')).toBeVisible()
    expect(screen.queryByText('r2-account')).toBeNull()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면이고 PC 셸로 감싸진다', () => {
    narrow(false)
    renderEntry(true)
    expect(screen.getByText('legacy-account')).toBeVisible()
    expect(screen.getByTestId('business-world-pane')).toBeInTheDocument()
    expect(screen.queryByText('r2-account')).toBeNull()
  })

  it('플래그 ON + 좁은 화면이면 R2 가게 정보 화면을 마운트한다', () => {
    narrow(true)
    renderEntry(true)
    expect(screen.getByText('r2-account')).toBeVisible()
    expect(screen.queryByText('legacy-account')).toBeNull()
  })

  it('서버 정본을 읽지 못한 경우에도 진입 분기는 그대로다(빈 값으로 대체하지 않는다)', () => {
    narrow(true)
    renderEntry(true, { ok: false })
    expect(screen.getByText('r2-account')).toBeVisible()
  })
})
