import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { resolveRoute } from '@/features/mobile-shell/routes'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { PublicHomeEntry } from './home-entry'

const LEGACY_HEADING = '여러 마케팅 채널을 돌아다니지 마세요.'
const R2_HEADING = '사장님은 가게에. 마케팅은 소희에게.'

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
afterEach(() => vi.unstubAllGlobals())

describe('M01 공개 첫 화면 진입(ANI-1672)', () => {
  it('플래그 OFF 면 좁은 화면에서도 기존 랜딩을 그대로 쓴다', () => {
    narrow(true)
    render(<MobileR2Provider enabled={false}><PublicHomeEntry /></MobileR2Provider>)
    expect(screen.getByRole('heading', { name: LEGACY_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: R2_HEADING })).toBeNull()
  })

  it('플래그 ON + 좁은 화면에서만 모바일 랜딩을 그린다', () => {
    narrow(true)
    render(<MobileR2Provider enabled><PublicHomeEntry /></MobileR2Provider>)
    expect(screen.getByRole('heading', { name: R2_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: LEGACY_HEADING })).toBeNull()
  })

  it('플래그 ON 이어도 넓은 화면은 기존 랜딩이다(PC 정보구조 유지)', () => {
    narrow(false)
    render(<MobileR2Provider enabled><PublicHomeEntry /></MobileR2Provider>)
    expect(screen.getByRole('heading', { name: LEGACY_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: R2_HEADING })).toBeNull()
  })

  it('랜딩 CTA·로그인은 기존 라우트만 가리키고 가입 처리 호출을 하지 않는다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<MobileR2Provider enabled><PublicHomeEntry /></MobileR2Provider>)

    expect(screen.getByRole('link', { name: '무료로 우리 가게 시작하기' }).getAttribute('href')).toBe('/signup?next=/start')
    expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('마운트 지점 `/` 는 라우트 표에 셸 밖 M01(BROWSE)로 등록돼 있다', () => {
    const route = resolveRoute('/')
    expect(route).toMatchObject({ id: 'M01', pattern: '/', tab: null, mode: 'BROWSE' })
  })
})
