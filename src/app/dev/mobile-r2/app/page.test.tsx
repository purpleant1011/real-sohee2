import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/app',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => {
    const { prefetch: _prefetch, ...props } = rest as Record<string, unknown>
    void _prefetch
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

import MobileR2AppDevPage from './page'

const SCROLL_KEY = (key: string) => `sohee.shell.scroll:${key}`

/** 셸이 그리는 스크롤 컨테이너. 페이지 래퍼에는 main 을 두지 않는다. */
function scroller(): HTMLElement {
  return document.querySelector('[data-mobile-r2-app] main') as HTMLElement
}

function scrollTo(top: number) {
  const el = scroller()
  Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true })
  fireEvent.scroll(el)
}

async function nextFrame() {
  await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))) })
}

function renderPage() {
  return render(<MobileR2AppDevPage />)
}

function decisionLinks(): NodeListOf<HTMLAnchorElement> {
  return document.querySelectorAll('#today-decisions a')
}

/** 지금 그려진 화면 id. 같은 제목의 h1 이 여러 화면에 있어도 이걸로 구분한다. */
function activeScreen(): string | null {
  return document.querySelector('[data-mobile-r2-app]')?.getAttribute('data-active-screen') ?? null
}

beforeEach(() => {
  window.sessionStorage.clear()
  HTMLElement.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('MobileR2AppDevPage — 개발 전용 게이트', () => {
  it('운영 환경에서는 404 로 끝난다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => MobileR2AppDevPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })
})

describe('앱 셸 — 5탭', () => {
  it('다섯 탭을 그리고 오늘 탭이 선택돼 있다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    const nav = screen.getByRole('navigation', { name: '소희 업무 메뉴' })
    const tabs = Array.from(nav.querySelectorAll('button'))
    expect(tabs.map(tab => tab.textContent)).toEqual(['오늘', '작업', '고객', '성과', '더보기'])
    expect(screen.getByRole('button', { name: '오늘' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('예시 화면')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: '오늘, 소희와 함께' })).toBeInTheDocument()
  })

  it("'소희에게 맡기기'는 탭이 아니라 헤더 명령이고, 탭은 여전히 5개다", () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    const nav = screen.getByRole('navigation', { name: '소희 업무 메뉴' })
    expect(nav.querySelectorAll('button')).toHaveLength(5)

    const delegate = screen.getByRole('button', { name: '소희에게 맡기기' })
    expect(nav.contains(delegate)).toBe(false)
    expect(document.querySelector('[data-mobile-r2-app] header')?.contains(delegate)).toBe(true)

    // 예시 화면에서는 실제 대화로 넘어가지 않고 그 사실만 알린다.
    fireEvent.click(delegate)
    expect(screen.getByRole('status')).toHaveTextContent('대화 화면')
    expect(screen.getByRole('heading', { level: 1, name: '오늘, 소희와 함께' })).toBeInTheDocument()
  })

  it('다른 탭을 누르면 그 탭 화면만 보이고 이전 탭 화면은 사라진다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '고객' }))

    expect(screen.getByRole('heading', { level: 1, name: '고객' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: '오늘, 소희와 함께' })).toBeNull()
    expect(screen.getByRole('button', { name: '고객' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '오늘' })).not.toHaveAttribute('aria-current')
  })
})

describe('오늘 탭 — 결정 3개 제한', () => {
  it('접힌 상태에서는 3개만 보이고 나머지는 더 보기로 펼친다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    expect(decisionLinks()).toHaveLength(3)
    // 예시 목록의 길이를 실제 업무 건수처럼 보여주지 않는다.
    expect(screen.queryByText(/전체 \d+건/)).toBeNull()

    const toggle = screen.getByRole('button', { name: '나머지 1건 더 보기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)

    expect(decisionLinks()).toHaveLength(4)
    expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: '접기' }))
    expect(decisionLinks()).toHaveLength(3)
  })

  it('강조 카드에 쓴 결정은 목록에 다시 나오지 않는다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    const title = '게시 전 최종 확인이 필요해요'
    const highlight = document.querySelector('[aria-label="다음 행동"]')
    expect(highlight).toHaveTextContent(title)

    // 강조 카드 1곳 + 목록 0곳. 정보는 지우지 않고 중복만 없앤다.
    expect(screen.getAllByText(title)).toHaveLength(1)
    expect(Array.from(decisionLinks()).map(link => link.textContent)).not.toContain(title)
  })
})

describe('더보기 탭 — 하위 화면과 뒤로가기', () => {
  it('더보기 목록에서 크레딧으로 들어갔다가 뒤로 돌아온다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '더보기' }))
    expect(screen.getByRole('heading', { level: 1, name: '더보기' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '더보기 목록' }).querySelectorAll('li')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: /크레딧/ }))
    expect(screen.getByRole('heading', { level: 1, name: '이용 현황' })).toBeInTheDocument()
    // 하위 화면에서는 탭 소속이 그대로 더보기다.
    expect(document.querySelector('[data-mobile-r2-app]')).toHaveAttribute('data-active-tab', 'more')

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(screen.getByRole('heading', { level: 1, name: '더보기' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '더보기 목록' })).toBeInTheDocument()
  })
})

describe('작업 탭 — 목록·알림함·캠페인·대화', () => {
  it('진입 목록에서 작업 목록으로 들어갔다가 뒤로 돌아온다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '작업' }))
    expect(screen.getByRole('heading', { level: 1, name: '작업' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '작업 목록' }).querySelectorAll('li')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: /^작업 목록/ }))
    expect(activeScreen()).toBe('work/list')
    expect(document.querySelector('[data-mobile-r2-app]')).toHaveAttribute('data-active-tab', 'work')
    expect(screen.getByPlaceholderText('제목으로 검색')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(activeScreen()).toBe('work')
    expect(screen.getByRole('list', { name: '작업 목록' })).toBeInTheDocument()
  })

  it('알림함과 캠페인 제안 화면을 각각 그린다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '작업' }))

    fireEvent.click(screen.getByRole('button', { name: /^알림함/ }))
    expect(activeScreen()).toBe('work/notifications')
    expect(screen.getByRole('heading', { level: 1, name: '알림' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    fireEvent.click(screen.getByRole('button', { name: /^캠페인 제안/ }))
    expect(activeScreen()).toBe('work/campaigns')
    expect(document.querySelector('[data-example-campaigns-screen]')).not.toBeNull()
  })

  it('대화 진입은 탭이 아니라 안내만 보여 준다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '작업' }))

    fireEvent.click(screen.getByRole('button', { name: /^소희와 대화/ }))
    expect(screen.getByRole('status')).toHaveTextContent('대화 화면')
    expect(activeScreen()).toBe('work')
  })
})

describe('고객 탭 — 고객 목록·소통함·예약표', () => {
  it('세 하위 화면을 모두 그린다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '고객' }))

    expect(screen.getByRole('list', { name: '고객 목록' }).querySelectorAll('li')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: /^고객 목록/ }))
    expect(activeScreen()).toBe('customers/list')
    expect(document.querySelector('[data-mobile-r2-app]')).toHaveAttribute('data-active-tab', 'customers')

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    fireEvent.click(screen.getByRole('button', { name: /^소통함/ }))
    expect(activeScreen()).toBe('customers/inbox')
    expect(screen.getByRole('heading', { level: 1, name: '소통함' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    fireEvent.click(screen.getByRole('button', { name: /^예약표/ }))
    expect(activeScreen()).toBe('customers/ledger')
    expect(screen.getByRole('heading', { level: 1, name: '예약표' })).toBeInTheDocument()
  })
})

describe('고객 상세 — 목록에서 셸 안으로 열린다', () => {
  /** 고객 탭 → 고객 목록까지 간 뒤 첫 고객의 '자세히 보기' 링크. */
  function openCustomerList() {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '고객' }))
    fireEvent.click(screen.getByRole('button', { name: /^고객 목록/ }))
  }

  it("'자세히 보기'를 누르면 실라우트 대신 같은 예시 고객의 상세 화면이 열린다", () => {
    vi.stubEnv('NODE_ENV', 'development')
    openCustomerList()

    const link = document.querySelector('[data-mobile-r2-app] main a[href^="/app/customers/"]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    // capture 단계에서 기본동작을 막으므로 false. 막지 않으면 실라우트로 이동한다.
    expect(fireEvent.click(link)).toBe(false)

    expect(activeScreen()).toBe('customers/detail')
    expect(document.querySelector('[data-mobile-r2-app]')).toHaveAttribute('data-active-tab', 'customers')
    expect(document.querySelector('[data-example-customer-detail]')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '김예시' })).toBeInTheDocument()
    // 상세는 '다른 화면' 안내가 아니라 실제 하위 화면이다.
    expect(screen.queryByText(/다른 화면으로 넘어가지 않아요/)).toBeNull()
  })

  it('뒤로가기는 탭 첫 화면이 아니라 목록으로 돌아가고, 스크롤 위치를 복원한다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    openCustomerList()
    scrollTo(200)

    const link = document.querySelector('[data-mobile-r2-app] main a[href^="/app/customers/"]') as HTMLAnchorElement
    fireEvent.click(link)
    expect(activeScreen()).toBe('customers/detail')
    await nextFrame()

    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(activeScreen()).toBe('customers/list')
    await nextFrame()
    expect(scroller().scrollTop).toBe(200)
    // 사라진 링크에 포커스가 남지 않고 본문으로 돌아온다.
    expect(document.activeElement).toBe(scroller())
  })

  it('상세 진입 목록에는 넣지 않는다 — 목록의 링크로만 연다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '고객' }))

    expect(screen.getByRole('list', { name: '고객 목록' }).querySelectorAll('li')).toHaveLength(3)
  })
})

describe('성과 탭', () => {
  it('예시 성과 화면을 그린다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '성과' }))
    expect(activeScreen()).toBe('results')
    expect(document.querySelector('[data-example-results-screen]')).not.toBeNull()
  })
})

describe('예시 화면 — 실라우트로 넘어가지 않는다', () => {
  it('화면 안의 링크를 눌러도 이동하지 않고 안내만 남긴다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '작업' }))
    fireEvent.click(screen.getByRole('button', { name: /^작업 목록/ }))

    const link = document.querySelector('[data-mobile-r2-app] main a') as HTMLAnchorElement
    expect(link).not.toBeNull()
    // fireEvent 는 기본동작이 막히면 false 를 돌려준다.
    expect(fireEvent.click(link)).toBe(false)
    // 작업 목록 자체도 role=status(건수 안내)를 쓰므로 문구로 확인한다.
    expect(screen.getByText(/다른 화면으로 넘어가지 않아요/)).toBeInTheDocument()
    expect(activeScreen()).toBe('work/list')
  })
})

describe('알림함 — 서버 액션을 부르지 않는다', () => {
  it("'읽음으로 표시'를 눌러도 서버 액션 대신 안내만 남긴다", async () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '작업' }))
    fireEvent.click(screen.getByRole('button', { name: /^알림함/ }))

    const markRead = screen.getAllByRole('button', { name: /읽음으로 표시/ })[0]
    // capture 단계에서 막히면 기본동작이 취소돼 false 를 돌려준다.
    expect(fireEvent.click(markRead)).toBe(false)
    expect(screen.getByText(/알림 읽음 처리/)).toBeInTheDocument()
    expect(activeScreen()).toBe('work/notifications')
  })
})

describe('화면 전환 모션', () => {
  it('화면 본문은 180ms 상태 진입 클래스로 감싼다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    const enter = document.querySelector('[data-mobile-r2-app] main .m-state-enter')
    expect(enter).not.toBeNull()
    expect(enter).toHaveAttribute('data-screen', 'today')
  })
})

describe('스크롤 복원', () => {
  it('탭을 떠나면 위치를 저장하고, 돌아오면 복원한다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    scrollTo(300)
    await nextFrame()
    expect(window.sessionStorage.getItem(SCROLL_KEY('/dev/mobile-r2/app'))).toBe('300')

    fireEvent.click(screen.getByRole('button', { name: '고객' }))
    expect(scroller().scrollTop).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '오늘' }))
    expect(scroller().scrollTop).toBe(300)
  })

  it('저장된 위치가 있으면 첫 진입에서 복원한다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    window.sessionStorage.setItem(SCROLL_KEY('/dev/mobile-r2/app'), '420')

    renderPage()

    expect(scroller().scrollTop).toBe(420)
  })

  it('이미 루트인 탭을 다시 누르면 맨 위로 올린다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '오늘' }))

    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(window.sessionStorage.getItem(SCROLL_KEY('/dev/mobile-r2/app'))).toBe('0')
  })
})

describe('화면 이동 후 포커스', () => {
  it('뒤로가기로 돌아오면 포커스가 본문으로 옮겨간다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '더보기' }))
    fireEvent.click(screen.getByRole('button', { name: /^채널/ }))
    expect(activeScreen()).toBe('more/channels')

    const back = screen.getByRole('button', { name: '뒤로' })
    back.focus()
    expect(document.activeElement).toBe(back)

    // 누르고 있던 버튼이 사라지면서 포커스가 body 로 떨어진다.
    fireEvent.click(back)
    await nextFrame()

    expect(activeScreen()).toBe('more')
    expect(document.activeElement).toBe(scroller())
  })

  it('본문 랜드마크는 지금 화면 이름을 갖는다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    expect(scroller()).toHaveAttribute('aria-label', '오늘')

    fireEvent.click(screen.getByRole('button', { name: '고객' }))
    expect(scroller()).toHaveAttribute('aria-label', '고객')
  })

  it('탭바에 포커스가 남아 있으면 빼앗지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    renderPage()

    const resultsTab = screen.getByRole('button', { name: '성과' })
    resultsTab.focus()
    fireEvent.click(resultsTab)
    await nextFrame()

    expect(activeScreen()).toBe('results')
    expect(document.activeElement).toBe(resultsTab)
  })
})
