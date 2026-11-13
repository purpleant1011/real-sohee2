import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/app', useSearchParams: () => new URLSearchParams() }))
vi.mock('./legacy-today-home', () => ({ LegacyTodayHome: () => <div data-testid="legacy" /> }))
vi.mock('@/features/mobile-today/r2-today', () => ({ R2Today: () => <p>r2-today</p> }))
vi.mock('@/features/mobile-decision/mobile-today', () => ({ MobileToday: () => <p>mobile-ui-today</p> }))
vi.mock('@/features/mobile-decision/mobile-ui-provider', () => ({ useMobileUi: () => ({ enabled: false }) }))
vi.mock('@/hooks/use-sohee-autonomy', () => ({ useSoheeAutonomy: () => ({ isPaused: false, toggleAutonomy: vi.fn() }) }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="legacy">{children}</div> }))

import { TodayHome } from './today-home'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

function viewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: narrow, addEventListener: () => {}, removeEventListener: () => {} }))
}
const ws = '00000000-0000-4000-8000-000000000001'
afterEach(() => vi.unstubAllGlobals())

describe('/app 오늘 홈 R2 마운트 (ANI-1770 배선 A)', () => {
  it('given 플래그 OFF, when 좁은 화면, then R2 오늘 화면을 마운트하지 않는다', async () => {
    viewport(true)
    render(<MobileR2Provider enabled={false}><TodayHome workspaceId={ws} /></MobileR2Provider>)
    expect(screen.queryByText('r2-today')).toBeNull()
    expect(await screen.findByTestId('legacy')).toBeInTheDocument()
  })
  it('given 플래그 ON, when 넓은 화면, then R2를 마운트하지 않는다', () => {
    viewport(false)
    render(<MobileR2Provider enabled><TodayHome workspaceId={ws} /></MobileR2Provider>)
    expect(screen.queryByText('r2-today')).toBeNull()
  })
  it('given 플래그 ON, when 좁은 화면, then R2 오늘 화면을 마운트한다', () => {
    viewport(true)
    render(<MobileR2Provider enabled><TodayHome workspaceId={ws} /></MobileR2Provider>)
    expect(screen.getByText('r2-today')).toBeVisible()
  })
})
