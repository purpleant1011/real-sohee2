import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileLandingView } from '../landing-view'
import {
  LANDING_EXAMPLES,
  LANDING_SIGNUP_HREF,
  resolveLandingExamples,
  type LandingViewSnapshot,
} from '../landing-model'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const base: LandingViewSnapshot = {
  loadState: 'ready',
  examples: LANDING_EXAMPLES,
  checkedAt: '2026-10-23T01:00:00.000Z',
}

describe('MobileLandingView', () => {
  it('첫 CTA는 /signup?next=/start 로 간다', () => {
    render(<MobileLandingView snapshot={base} />)
    expect(LANDING_SIGNUP_HREF).toBe('/signup?next=/start')
    expect(screen.getByRole('link', { name: '무료로 우리 가게 시작하기' }).getAttribute('href')).toBe('/signup?next=/start')
  })

  it('로그인 링크가 헤더에 있고 44px 터치 영역을 갖는다', () => {
    render(<MobileLandingView snapshot={base} />)
    const link = screen.getByRole('link', { name: '로그인' })
    expect(link.getAttribute('href')).toBe('/login')
    expect(link.className).toContain('min-h-11')
  })

  it('예시를 고르면 가입 주소에 업종이 실리고, 다시 누르면 기본 주소로 돌아온다', () => {
    render(<MobileLandingView snapshot={base} />)
    const cta = () => screen.getByRole('link', { name: '무료로 우리 가게 시작하기' })
    const beauty = screen.getByRole('button', { name: /뷰티/ })
    fireEvent.click(beauty)
    expect(beauty.getAttribute('aria-pressed')).toBe('true')
    expect(cta().getAttribute('href')).toBe('/signup?next=/start&industry=beauty')
    fireEvent.click(beauty)
    expect(cta().getAttribute('href')).toBe('/signup?next=/start')
  })

  it('약관·개인정보 링크가 있고 터치 영역이 44px 이상이다', () => {
    render(<MobileLandingView snapshot={base} />)
    for (const [name, href] of [['이용약관', '/terms'], ['개인정보 처리방침', '/privacy']] as const) {
      const link = screen.getByRole('link', { name })
      expect(link.getAttribute('href')).toBe(href)
      expect(link.className).toContain('min-h-11')
      // ANI-1737: 200% 글자 배율에서 '이용약관' 폭이 42px로 44px 미달이었다. 폭도 함께 보장한다.
      expect(link.className).toContain('min-w-11')
    }
  })

  it('업종별 예시는 모두 "예시"로 표시되고 숫자 성과를 담지 않는다', () => {
    const { container } = render(<MobileLandingView snapshot={base} />)
    expect(screen.getAllByText(/· 예시$/)).toHaveLength(LANDING_EXAMPLES.length)
    expect(screen.getByText(/^뷰티 · 예시$/)).toBeTruthy()
    const exampleText = Array.from(container.querySelectorAll('li button')).map(a => a.textContent).join(' ')
    expect(exampleText).not.toMatch(/\d/)
  })

  it('외부 게시·예약을 약속하는 과장 문구가 없다', () => {
    render(<MobileLandingView snapshot={base} />)
    expect(screen.queryByText(/자동으로 (예약|게시)/)).toBeNull()
    expect(screen.getByText(/채널 연결 전에는 외부에 아무것도 올리지 않아요/)).toBeTruthy()
    // 예약 API 는 채널 연결·검증을 확인하지 않고 CONFIRMED 로 저장한다.
    // 따라서 '예약은 채널에서만' 같은 미강제 제한을 약속하지 않는다.
    expect(screen.queryByText(/예약은[^.]*채널에서만/)).toBeNull()
    expect(screen.getByText(/게시는 채널 연결과 사장님 승인이 끝난 뒤에만 진행돼요/)).toBeTruthy()
  })

  it('수평 overflow를 만들지 않도록 루트가 가로 넘침을 막는다', () => {
    const { container } = render(<MobileLandingView snapshot={base} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('overflow-x-clip')
    expect((container.firstElementChild as HTMLElement).className).not.toContain('overflow-x-hidden')
  })
})

describe('랜딩 5상태', () => {
  const cta = () => screen.getByRole('link', { name: '무료로 우리 가게 시작하기' })

  it.each([
    ['loading', { ...base, loadState: 'loading' as const, examples: null }, 'loading'],
    ['error', { ...base, loadState: 'error' as const, examples: null }, 'error'],
    ['unknown 은 error', { ...base, loadState: 'unknown' as const, examples: null }, 'error'],
    ['빈 목록은 partial', { ...base, examples: [] }, 'partial'],
    ['stale', { ...base, loadState: 'stale' as const }, 'stale'],
    ['ready', base, 'ready'],
  ])('%s', (_label, snapshot, expected) => {
    expect(resolveLandingExamples(snapshot)).toBe(expected)
    render(<MobileLandingView snapshot={snapshot} />)
    // 예시 조회 상태와 무관하게 첫 CTA는 항상 보인다.
    expect(cta()).toBeTruthy()
  })

  it('error 는 빈 예시처럼 보이지 않고 예시 카드를 그리지 않는다', () => {
    render(<MobileLandingView snapshot={{ ...base, loadState: 'error', examples: LANDING_EXAMPLES }} />)
    expect(screen.queryByText(/· 예시$/)).toBeNull()
    expect(screen.getByText('불러오지 못했어요')).toBeTruthy()
  })

  it('loading 은 상태 영역(role=status)으로 안내한다', () => {
    render(<MobileLandingView snapshot={{ ...base, loadState: 'loading', examples: null }} />)
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
  })
})
