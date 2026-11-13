import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/app', useSearchParams: () => new URLSearchParams() }))
vi.mock('./legacy-today-home', () => ({ LegacyTodayHome: () => <p>legacy-pc-home</p> }))
vi.mock('./pc/pc-today-home', () => ({ PcTodayHome: () => <p>pc-3col-home</p> }))
vi.mock('@/features/mobile-today/r2-today', () => ({ R2Today: () => <p>r2-today</p> }))
vi.mock('@/features/mobile-decision/mobile-today', () => ({ MobileToday: () => <p>mobile-ui-today</p> }))
vi.mock('@/features/mobile-decision/mobile-ui-provider', () => ({ useMobileUi: () => ({ enabled: false }) }))

import { TodayHome } from './today-home'

const ws = '00000000-0000-4000-8000-000000000001'

function wide() {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('PC 오늘 홈 — 새 3열 화면이 기본, NEXT_PUBLIC_PC_HOME_V2=0 이면 기존 홈', () => {
  it('플래그가 0 이면 넓은 화면에서 기존 PC 홈으로 되돌린다', async () => {
    vi.stubEnv('NEXT_PUBLIC_PC_HOME_V2', '0')
    wide()
    render(<TodayHome workspaceId={ws} />)
    expect(await screen.findByText('legacy-pc-home')).toBeInTheDocument()
    expect(screen.queryByText('pc-3col-home')).toBeNull()
  })

  it('플래그가 없으면 넓은 화면에서 새 3열 홈을 그린다', async () => {
    wide()
    render(<TodayHome workspaceId={ws} />)
    expect(await screen.findByText('pc-3col-home')).toBeInTheDocument()
    expect(screen.queryByText('legacy-pc-home')).toBeNull()
  })
})
