import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const headerState = vi.hoisted(() => ({ host: 'localhost:3000', ua: 'Mozilla/5.0' }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: headerState.host, 'user-agent': headerState.ua }),
}))

import PublicLayout from './layout'
import { PublicHomeEntry } from './home-entry'

const LEGACY_HEADING = '여러 마케팅 채널을 돌아다니지 마세요.'
const R2_HEADING = '사장님은 가게에. 마케팅은 소희에게.'

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
async function renderLayout() {
  const tree = await PublicLayout({ children: <PublicHomeEntry /> })
  render(tree)
}
afterEach(() => {
  headerState.host = 'localhost:3000'
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('공개 레이아웃의 M01 랜딩 플래그 배선(ANI-1672)', () => {
  it('플래그가 없으면(기본) 기존 랜딩과 공개 머리말을 그대로 보여준다', async () => {
    narrow(true)
    await renderLayout()
    expect(screen.getByRole('heading', { name: LEGACY_HEADING })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내 매장 무료 진단' })).toBeInTheDocument()
  })

  it('플래그 ON + 좁은 화면이면 랜딩만 그리고 공개 머리말을 겹치지 않는다', async () => {
    vi.stubEnv('MOBILE_R2_LANDING_ENABLED', '1')
    narrow(true)
    await renderLayout()
    expect(screen.getByRole('heading', { name: R2_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '내 매장 무료 진단' })).toBeNull()
  })

  it('플래그 ON 이어도 넓은 화면은 기존 랜딩과 머리말 그대로다', async () => {
    vi.stubEnv('MOBILE_R2_LANDING_ENABLED', '1')
    narrow(false)
    await renderLayout()
    expect(screen.getByRole('heading', { name: LEGACY_HEADING })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내 매장 무료 진단' })).toBeInTheDocument()
  })

  it('플래그 값이 1 이 아니면 켜지지 않는다', async () => {
    vi.stubEnv('MOBILE_R2_LANDING_ENABLED', 'true')
    narrow(true)
    await renderLayout()
    expect(screen.getByRole('heading', { name: LEGACY_HEADING })).toBeInTheDocument()
  })

  it('m.example.com 호스트는 플래그 OFF·넓은 화면(PC)에서도 모바일 랜딩을 보여준다', async () => {
    vi.stubEnv('MOBILE_R2_LANDING_ENABLED', '')
    headerState.host = 'm.example.com'
    narrow(false)
    await renderLayout()
    expect(screen.getByRole('heading', { name: R2_HEADING })).toBeInTheDocument()
    expect(screen.queryByText(LEGACY_HEADING)).toBeNull()
  })
})
