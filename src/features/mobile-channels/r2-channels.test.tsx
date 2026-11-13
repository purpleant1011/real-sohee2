import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/channels', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }))
import { R2Channels } from './r2-channels'

const PAYLOAD = {
  instagram: { status: 'VERIFIED', verified: true, supportedPublish: true },
  threads: { status: 'NOT_CONNECTED' },
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

// ANI-1714: 권한 없음(401/403)은 '내용이 없음'도 '일시적 조회 실패'도 아니다.
// '다시 확인'을 눌러도 풀리지 않으므로 재시도 안내와 구분해 보여준다.
it('채널 응답이 정상이면 게시 가능 채널을 보여준다', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<R2Channels />)

  expect(await screen.findByText('인스타그램')).toBeVisible()
  expect(screen.getByText('게시 가능')).toBeVisible()
  expect(fetchMock).toHaveBeenCalledWith('/api/channels', expect.objectContaining({ cache: 'no-store' }))
})

it.each([401, 403])('권한 없음(%s)은 조회 실패가 아니라 권한 안내로 보여준다', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '권한 없음' }), { status })))
  render(<R2Channels />)

  expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
  expect(screen.getByText('가게 관리자에게 권한을 요청해 주세요.')).toBeVisible()
  // 재시도로 풀리는 것처럼 보이면 안 된다.
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
  expect(screen.queryByRole('listitem')).toBeNull()
})

it('권한 없음을 채널 없음으로 단정하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
  render(<R2Channels />)

  expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
  expect(screen.queryByText('아직 아무것도 없어요')).toBeNull()
})

it('권한 없음이 아닌 실패는 다시 확인할 수 있는 조회 실패로 남긴다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  render(<R2Channels />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
})

it('401/403 응답 본문이 JSON이 아니거나 비어 있어도 권한 안내를 띄운다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Invalid JSON 403', { status: 403 })))
  render(<R2Channels />)

  expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
  expect(screen.queryByText('불러오지 못했어요')).toBeNull()
})

it('200 응답이지만 shape이 깨져 있으면 확인 실패로 닫는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })))
  render(<R2Channels />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('인스타그램')).toBeNull()
})

it('200 응답 본문이 JSON 파싱 오류여도 예외를 던지지 않고 실패로 닫는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })))
  render(<R2Channels />)

  expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
  expect(screen.queryByText('인스타그램')).toBeNull()
})

it('컴포넌트 언마운트 후 응답이 도착해도 상태 갱신을 건너뛴다', async () => {
  let resolveFetch!: (res: Response) => void
  const fetchPromise = new Promise<Response>(resolve => {
    resolveFetch = resolve
  })
  vi.stubGlobal('fetch', vi.fn(() => fetchPromise))

  const { unmount } = render(<R2Channels />)
  unmount()

  resolveFetch(new Response(JSON.stringify(PAYLOAD), { status: 200 }))
  await new Promise(r => setTimeout(r, 10))
  // 언마운트 후 호출 시 콘솔 에러나 예외가 발생하지 않음
})

describe('ANI-1720 재진입·두 기기 일관성 (useResumeRevalidation)', () => {
  it('화면 복귀(visibilitychange to visible) 시 채널 상태를 서버에서 다시 확인한다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Channels />)

    expect(await screen.findByText('인스타그램')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 화면 숨김 시뮬레이션
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 다른 기기에서 연동 후 화면 복귀 시뮬레이션
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('오프라인에서 온라인 복귀 시 채널 상태를 재검증한다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Channels />)

    expect(await screen.findByText('인스타그램')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('online'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bfcache 복귀(pageshow persisted) 시 채널 상태를 재검증한다', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Channels />)

    expect(await screen.findByText('인스타그램')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const event = new PageTransitionEvent('pageshow', { persisted: true })
    window.dispatchEvent(event)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('확장 권한 다시 연결 액션 (Meta App Review)', () => {
    it('extendedScopesAllowed가 true일 때 44px 터치·16px 폰트의 확장 권한 다시 연결 액션이 노출된다', async () => {
      const payload = {
        ...PAYLOAD,
        extendedScopesAllowed: true,
      }
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

      render(<R2Channels />)

      const extendedLink = await screen.findByRole('link', {
        name: '인스타그램 확장 권한으로 다시 연결 (댓글·DM·인사이트)',
      })

      expect(extendedLink).toBeInTheDocument()
      expect(extendedLink).toHaveAttribute(
        'href',
        '/api/channels/instagram/connect?returnPath=/app/channels&extended=1',
      )
      expect(extendedLink.textContent).toBe('확장 권한으로 다시 연결 (댓글·DM·인사이트)')
      expect(extendedLink.className).toMatch(/min-h-\[44px\]/)
      expect(extendedLink.className).toMatch(/text-\[16px\]|text-base/)
    })

    it('extendedScopesAllowed가 false이면 확장 권한 액션이 노출되지 않는다', async () => {
      const payload = {
        ...PAYLOAD,
        extendedScopesAllowed: false,
      }
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

      render(<R2Channels />)

      await screen.findByText('인스타그램')
      expect(
        screen.queryByRole('link', { name: /확장 권한으로 다시 연결/ }),
      ).not.toBeInTheDocument()
    })

    it('canRequestExtended prop override가 주어지면 서버 응답보다 우선한다', async () => {
      const payload = {
        ...PAYLOAD,
        extendedScopesAllowed: false,
      }
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))

      render(<R2Channels canRequestExtended={true} />)

      const extendedLink = await screen.findByRole('link', {
        name: '인스타그램 확장 권한으로 다시 연결 (댓글·DM·인사이트)',
      })
      expect(extendedLink).toBeInTheDocument()
    })
  })
})
