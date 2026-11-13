import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import MobileR2DevPage from './page'
import MobileR2FramePage from './frame/page'
import { DEFAULT_FRAME_WIDTH, MAX_FRAME_WIDTH, MIN_FRAME_WIDTH, parseFrameWidth } from './frame-width'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
  usePathname: () => '/app',
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

function renderFrame(width?: string) {
  return MobileR2FramePage({ searchParams: Promise.resolve(width ? { w: width } : {}) })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('parseFrameWidth', () => {
  it('defaults when the value is missing or not a number', () => {
    expect(parseFrameWidth(undefined)).toBe(DEFAULT_FRAME_WIDTH)
    expect(parseFrameWidth('')).toBe(DEFAULT_FRAME_WIDTH)
    expect(parseFrameWidth('abc')).toBe(DEFAULT_FRAME_WIDTH)
    expect(parseFrameWidth('390px')).toBe(DEFAULT_FRAME_WIDTH)
  })

  it('clamps to the allowed range', () => {
    expect(parseFrameWidth('200')).toBe(MIN_FRAME_WIDTH)
    expect(parseFrameWidth('999')).toBe(MAX_FRAME_WIDTH)
    expect(parseFrameWidth('430')).toBe(430)
  })

  it('uses the first value when the parameter repeats', () => {
    expect(parseFrameWidth(['390', '480'])).toBe(390)
  })
})

describe('MobileR2DevPage', () => {
  it('triggers notFound in production environment', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => MobileR2DevPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('renders the shell preview with example copy outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    expect(screen.getByText('예시 화면')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '소희 업무 메뉴' }).querySelectorAll('a')).toHaveLength(5)
    expect(document.querySelector('[data-mobile-r2-preview]')).not.toBeNull()
  })

  it('mounts the today screen components with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M09 오늘 화면: 다음 행동 카드와 자율근무 제어가 실제 컴포넌트로 마운트된다.
    // 같은 컴포넌트가 '오늘 화면' 예시 마운트에도 있으므로 이 섹션 안에서 확인한다.
    const today = within(screen.getByRole('region', { name: '오늘 할 일' }))
    expect(today.getByRole('region', { name: '다음 행동' })).toBeInTheDocument()
    expect(today.getByRole('region', { name: '소희 일하기' })).toBeInTheDocument()
    expect(today.getByRole('heading', { name: '게시 전 최종 확인이 필요해요' })).toBeInTheDocument()
    expect(screen.getByText('2건 진행 중')).toBeInTheDocument()
  })

  it('mounts the onboarding screen with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M03 가게 소개: 예시 스냅샷(가게·말투 확인됨, 채널 미검증)이 서버 판정대로 '계정' 단계에 서는지 본다.
    // ANI-1781 이후 단계 모델은 가게 → 말투 → 계정 → 첫 글이다. 사진 단계는 이 화면에 없다(첫 게시 준비 화면의 몫).
    expect(screen.getByRole('heading', { name: '가게 소개', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '가게 소개 단계' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '글을 올릴 계정을 연결해 주세요' })).toBeInTheDocument()
  })

  it('mounts the first post lane steps with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M02 가게 정보 → M04 사진 등록 → M04b 사진 사용권 화면이 3단계 진행과 함께 실제로 렌더된다.
    expect(screen.getByRole('heading', { name: '어떤 가게인가요?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '사진을 올려 주세요' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '사진 사용권을 확인해 주세요' })).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar', { name: '첫 게시 준비 진행률' })[0]).toHaveAttribute(
      'aria-valuenow',
      '1',
    )
    // 권리 확인 전 사진은 "게시 전 확인 필요"로 남고, 확인된 사진만 게시 가능으로 집계된다.
    expect(screen.getByText('1 / 2장')).toBeInTheDocument()
    expect(screen.getByText('게시 전 확인 필요')).toBeInTheDocument()
    expect(screen.getByText('권리를 확인했어요. 이 사진으로 첫 게시를 준비할 수 있어요.')).toBeInTheDocument()
  })

  it('never sends a request from the preview, even when the autonomy button is pressed', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fetchSpy = vi.fn(() => Promise.reject(new Error('preview must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<MobileR2DevPage />)

    await act(async () => {
      fireEvent.click(within(screen.getByRole('region', { name: '오늘 할 일' })).getByRole('button', { name: '잠시 멈추기' }))
    })

    expect(screen.getByText('미리보기에서는 자율근무를 바꾸지 않아요.')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('mounts the chat transcript and composer with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M10 대화 화면: 진행 카드·버블·승인 카드·컴포저가 실제 컴포넌트로 마운트된다.
    expect(screen.getByRole('region', { name: '업무 진행 상황' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '대화 내용' })).toBeInTheDocument()
    expect(screen.getByText('이번 주 예약 문의 답장을 준비해 줄 수 있어?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '승인 화면에서 확인' })).toHaveAttribute(
      'href',
      '/app/approvals/preview-approval-1',
    )
    expect(screen.getByRole('textbox', { name: '메시지 내용' })).toBeInTheDocument()
  })

  it('never sends a chat message from the preview', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fetchSpy = vi.fn(() => Promise.reject(new Error('preview must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<MobileR2DevPage />)

    fireEvent.change(screen.getByRole('textbox', { name: '메시지 내용' }), {
      target: { value: '테스트 메시지' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    })

    expect(screen.getByText('미리보기에서는 메시지를 실제로 보내지 않아요.')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('mounts the work hub with example rows', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M11 작업함: 검색·세그먼트·예시 목록이 실제 컴포넌트로 마운트된다.
    const workList = within(screen.getByRole('region', { name: '작업 목록' }))
    expect(workList.getByRole('heading', { name: '작업', level: 1 })).toBeInTheDocument()
    expect(workList.getByText('인스타그램 게시물 · 신메뉴 안내')).toBeInTheDocument()
    expect(workList.getByText('예약 문의 답장 초안 3건')).toBeInTheDocument()
    expect(workList.getByRole('textbox', { name: '작업 검색' })).toBeInTheDocument()
  })

  it('mounts the work tab hub with entries and recent rows', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    const hub = within(screen.getByRole('region', { name: '작업 탭 허브' }))
    expect(hub.getByRole('heading', { name: '작업', level: 1 })).toBeInTheDocument()
    expect(hub.getByRole('link', { name: /작업 목록/ })).toBeInTheDocument()
    expect(hub.getByRole('link', { name: /알림함/ })).toBeInTheDocument()
    expect(hub.getByRole('heading', { name: '최근 작업' })).toBeInTheDocument()
  })

  it('mounts the more tab hub without exposing unverified counts as zero', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    const hub = within(screen.getByRole('region', { name: '더보기 탭 허브' }))
    expect(hub.getByRole('heading', { name: '더보기', level: 1 })).toBeInTheDocument()
    expect(hub.getByRole('link', { name: /채널 연결/ })).toBeInTheDocument()
    expect(hub.getByRole('link', { name: /크레딧/ })).toBeInTheDocument()
    expect(hub.getByRole('link', { name: /가게 기억/ })).toBeInTheDocument()
    // 설정은 서버에서 확인한 개수가 없어 0건으로 표시하지 않는다.
    expect(hub.getByRole('link', { name: /설정/ })).toBeInTheDocument()
    expect(hub.queryByText('0건')).not.toBeInTheDocument()
  })

  it('mounts the notification list with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M23 알림함: 읽지 않음 배지·종류 탭·검증된 내부 경로만 링크로 마운트된다.
    expect(screen.getByRole('region', { name: '알림함' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '알림', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '알림 종류' })).toBeInTheDocument()
    expect(screen.getByText('3개 읽지 않음')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '관련 화면 열기' })).toHaveLength(3)
    expect(screen.getByText('연결된 화면 없음')).toBeInTheDocument()
    expect(screen.getByText('확인할 답변이 있어요')).toBeInTheDocument()
    expect(screen.getByText('알림 설정을 확인해 주세요')).toBeInTheDocument()
  })

  it('mounts the today example screen with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M09 오늘: 셸 없이 본문만, 조회 없이 예시 데이터로 실제 화면이 마운트된다.
    const todayExample = document.querySelector('[data-example-today-screen]')
    expect(todayExample).not.toBeNull()
    expect(within(todayExample as HTMLElement).getByRole('heading', { name: '오늘, 소희와 함께' })).toBeInTheDocument()
    expect(within(todayExample as HTMLElement).getByText(/예시 화면이에요/)).toBeInTheDocument()
  })

  it('mounts the campaigns and results screens with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M18 제안·M20 성과: 서버 조회 없이 예시 데이터로 실제 화면이 레지스트리에 마운트된다.
    expect(screen.getByRole('heading', { name: '캠페인 제안 화면' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '성과 화면' })).toBeInTheDocument()
    expect(document.querySelector('[data-example-campaigns-screen]')).not.toBeNull()
    expect(document.querySelector('[data-example-results-screen]')).not.toBeNull()
    // 예시 카드의 숫자는 '예시' 표시와 함께 그려진다.
    expect(document.querySelectorAll('[data-example-badge]').length).toBeGreaterThan(0)
  })

  it('mounts the customers, inbox and ledger example screens', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // M17 고객·M13 소통함·M15 예약표: 셸 없이 본문만, 조회 없이 예시 데이터로 마운트된다.
    expect(document.querySelector('[data-example-customers-screen]')).not.toBeNull()
    expect(document.querySelector('[data-example-inbox-screen]')).not.toBeNull()
    expect(document.querySelector('[data-example-ledger-screen]')).not.toBeNull()
  })
})

describe('MobileR2FramePage', () => {
  it('triggers notFound in production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(renderFrame()).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('defaults to 390px when w is absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(await renderFrame())

    expect(screen.getByText(`미리보기 폭 ${DEFAULT_FRAME_WIDTH}px · 예시 화면`)).toBeInTheDocument()
    const frame = document.querySelector('[data-mobile-r2-frame]') as HTMLIFrameElement
    expect(frame).not.toBeNull()
    expect(frame.getAttribute('src')).toBe('/dev/mobile-r2')
    expect(frame.style.width).toBe(`${DEFAULT_FRAME_WIDTH}px`)
  })

  it('applies the requested width', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(await renderFrame('430'))

    const frame = document.querySelector('[data-mobile-r2-frame]') as HTMLIFrameElement
    expect(frame.style.width).toBe('430px')
  })
})

describe('MobileR2DevPage business screens', () => {
  it('mounts the customers, credit and memory approval views with example data', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<MobileR2DevPage />)

    // 고객 화면: 동의 상태가 다른 예시 고객이 목록으로 그려진다.
    const customers = screen.getByRole('region', { name: '고객 화면' })
    expect(within(customers).getByRole('heading', { name: '고객', level: 1 })).toBeInTheDocument()
    expect(within(customers).getByRole('list', { name: '고객 목록' })).toBeInTheDocument()

    // 크레딧 화면: 잔액·사용 판단·충전 안내가 실제 섹션으로 마운트된다.
    const credit = screen.getByRole('region', { name: '크레딧 화면' })
    expect(within(credit).getByRole('heading', { name: '이용 현황', level: 1 })).toBeInTheDocument()

    // 가게 기억 승인 화면: 승인 후보 목록이 그려진다.
    const memory = screen.getByRole('region', { name: '가게 기억 승인 화면' })
    expect(within(memory).getByRole('heading', { name: '가게 기억', level: 1 })).toBeInTheDocument()
    expect(within(memory).getByRole('list', { name: '가게 기억 후보' })).toBeInTheDocument()

    // 채널 화면: 게시 가능 판정이 붙은 채널 목록이 실제 섹션으로 마운트된다.
    const channels = screen.getByRole('region', { name: '채널 화면' })
    expect(within(channels).getByRole('heading', { name: '연결된 채널', level: 1 })).toBeInTheDocument()
    expect(within(channels).getByRole('list', { name: '연결 채널' })).toBeInTheDocument()
    // 확인된 채널만 "게시 가능"으로 표시되고, 나머지는 다음 행동을 안내한다.
    expect(within(channels).getByText('게시 가능')).toBeInTheDocument()
    expect(within(channels).getByText('직접 올리기')).toBeInTheDocument()
    expect(within(channels).getByText('다시 연결하기')).toBeInTheDocument()
  })

  it('never sends a request from the business screens', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fetchSpy = vi.fn(() => Promise.reject(new Error('preview must not fetch')))
    vi.stubGlobal('fetch', fetchSpy)
    render(<MobileR2DevPage />)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
