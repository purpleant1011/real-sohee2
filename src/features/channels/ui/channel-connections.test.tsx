import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ChannelConnections } from './channel-connections'

const verified = { status: 'VERIFIED', verified: true, username: '@shop' }
const disconnected = { status: 'NOT_CONNECTED', verified: false }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/app/channels') })

function mockResponses(verification: Record<string, unknown>, credentials: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === '/api/channels' ? verification : { connections: credentials },
  })))
}

describe('채널 첫 화면', () => {
  it('계정 변경 방법과 기본 권한 연결을 확장 권한과 분리해서 안내한다', async () => {
    mockResponses({ instagram: verified, threads: verified })
    render(<ChannelConnections />)
    expect(await screen.findByText(/연결을 먼저 해제할 필요는 없어요/)).toBeVisible()
    expect(screen.getByText(/비즈니스 또는 크리에이터/)).toBeInTheDocument()
    expect(screen.getByText(/같은 브라우저/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '인스타그램 다른 계정으로 다시 연결' }).getAttribute('href')).not.toContain('extended=1')
  })

  it('실제 API에서 읽은 상태로 두 채널을 표시하며 OAuth 링크를 눈에 띄게 제공한다', async () => {
    mockResponses({ instagram: disconnected, threads: verified }, [{ channel: 'threads', status: 'connected', account_label: '@shop' }])
    render(<ChannelConnections />)
    const instagram = await screen.findByRole('article', { name: '인스타그램' })
    expect(within(instagram).getByText('연결 필요')).toBeInTheDocument()
    expect(instagram).toHaveAttribute('tabindex', '0')
    expect(within(instagram).getByRole('link', { name: '인스타그램 연결하기' })).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=/app/channels')
    const threads = screen.getByRole('article', { name: '스레드' })
    expect(within(threads).getByText('연결됨 @shop')).toBeInTheDocument()
    expect(within(threads).queryByRole('link', { name: /연결하기/u })).not.toBeInTheDocument()
    expect(screen.getByText('네이버 블로그')).toBeInTheDocument()
    expect(screen.getByText('당근')).toBeInTheDocument()
    expect(screen.getAllByText('준비 중')).toHaveLength(2)
    expect(screen.queryByText(/Capability Registry/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/Production 연동 준비 상태/u)).not.toBeInTheDocument()
  })

  it('토큰 만료 시 재연결을 제안하고 쿼리 오류 해결 안내를 유지한다', async () => {
    window.history.replaceState({}, '', '/app/channels?connect=unavailable&connect_error=META_OAUTH_TOKEN_EXCHANGE')
    mockResponses({ instagram: { status: 'READY_DEGRADED', verified: false }, threads: disconnected }, [{ channel: 'instagram', status: 'connected', account_label: '@old' }])
    render(<ChannelConnections />)
    const instagram = await screen.findByRole('article', { name: '인스타그램' })
    expect(within(instagram).getByText('다시 연결 필요')).toBeInTheDocument()
    expect(within(instagram).getByRole('link', { name: '인스타그램 다시 연결' })).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=/app/channels')
    expect(screen.getByRole('alert')).toHaveTextContent('소희 운영팀에 문의')
  })

  it('계정 ID가 유실되어 재연결이 필요한 채널 카드에 재연결 필요 배지를 표시한다', async () => {
    mockResponses(
      { instagram: { status: 'CONNECTED_UNVERIFIED', verified: false }, threads: disconnected },
      [{ channel: 'instagram', status: 'connected', account_label: '@shop', external_account_id: null }]
    )
    render(<ChannelConnections />)
    const instagram = await screen.findByRole('article', { name: '인스타그램' })
    expect(within(instagram).getByText('재연결 필요')).toBeInTheDocument()
    expect(within(instagram).getByRole('link', { name: '인스타그램 다시 연결' })).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=/app/channels')
  })

  it('조회 실패 시 미연결로 오인하거나 연결 버튼을 제공하지 않고 재시도 가능하다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ connections: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ instagram: disconnected, threads: disconnected }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ connections: [] }) })
    vi.stubGlobal('fetch', fetcher)
    render(<ChannelConnections />)
    expect(await screen.findByText(/연결 상태를 불러오지 못했어요/u)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '인스타그램 연결하기' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.getByRole('link', { name: '인스타그램 연결하기' })).toBeInTheDocument())
  })

  it('콜백 성공만으로 연결을 단정하지 않고 서버 상태를 그대로 보여준다', async () => {
    window.history.replaceState({}, '', '/app/channels?connect=authorized&channel=instagram&account=%40fake')
    mockResponses({ instagram: disconnected, threads: disconnected })
    render(<ChannelConnections />)
    const instagram = await screen.findByRole('article', { name: '인스타그램' })
    expect(within(instagram).getByText('연결 필요')).toBeInTheDocument()
    expect(screen.queryByText('@fake')).not.toBeInTheDocument()
    expect(screen.getByText('연결 결과를 확인하고 있어요')).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('자격 정보 조회가 실패해도 검증된 채널은 연결됨으로 표시하며 계정명을 지어내지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/channels'
      ? { ok: true, json: async () => ({ instagram: { status: 'VERIFIED', verified: true }, threads: disconnected }) }
      : { ok: false }))
    render(<ChannelConnections />)
    const instagram = await screen.findByRole('article', { name: '인스타그램' })
    expect(within(instagram).getByRole('status')).toHaveTextContent('연결됨')
    expect(within(instagram).queryByRole('link', { name: /연결하기/u })).not.toBeInTheDocument()
  })

  it('고급 정보는 기본 접힘이고 키보드로 펼쳐 진단 내용을 볼 수 있다', async () => {
    mockResponses({ instagram: disconnected, threads: disconnected })
    render(<ChannelConnections />)
    await within(await screen.findByRole('article', { name: '인스타그램' })).findByText('연결 필요')
    const toggle = screen.getByRole('button', { name: /고급 정보 · 문제 해결용/u })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/주요 채널 역량/u)).toBeInTheDocument()
    expect(screen.getByText(/Webhook 파이프라인 감시/u)).toBeInTheDocument()
  })

  it('상단 이전 링크: 기본값은 /app, 온보딩 유입 시 /start?step=channels로 연결된다', async () => {
    mockResponses({ instagram: disconnected, threads: disconnected })
    const { unmount } = render(<ChannelConnections />)
    const defaultBackLink = await screen.findByRole('link', { name: '이전 화면으로 이동' })
    expect(defaultBackLink).toHaveAttribute('href', '/app')
    unmount()

    window.history.replaceState({}, '', '/app/channels?from=onboarding')
    render(<ChannelConnections />)
    const onboardingBackLink = await screen.findByRole('link', { name: '이전 화면으로 이동' })
    expect(onboardingBackLink).toHaveAttribute('href', '/start?step=channels')
  })

  it('연결 성공 시 다음 단계 영역을 렌더링하고 첫 글 작성 CTA를 제공한다', async () => {
    window.history.replaceState({}, '', '/app/channels?connect=authorized&channel=threads')
    mockResponses(
      { workspaceId: 'ws-test', instagram: disconnected, threads: verified },
      [{ channel: 'threads', status: 'connected', account_label: '@shop' }]
    )
    render(<ChannelConnections />)

    // 안내 카드가 성공 상태로 전환 확인
    await waitFor(() => {
      expect(screen.getByText('연결이 확인됐어요 🎉')).toBeInTheDocument()
    })
    expect(screen.getByText(/스레드 @shop/)).toBeInTheDocument()

    // 다음 단계 영역 렌더링 확인 (첫 글 만들기 & 소희 작업실로 이동)
    expect(screen.getByRole('region', { name: '다음 단계 안내' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /첫 글 만들기/ })).toHaveAttribute('href', '/start/preview')
    expect(screen.getByRole('link', { name: '소희 작업실로 이동' })).toHaveAttribute('href', '/app')
  })

  it('이미 발행된 글이 있는 경우 다음 글 만들기 CTA를 제공한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/channels') {
        return { ok: true, json: async () => ({ workspaceId: 'ws-test', instagram: disconnected, threads: verified }) }
      }
      if (url === '/api/channels/credentials') {
        return { ok: true, json: async () => ({ connections: [{ channel: 'threads', status: 'connected', account_label: '@shop' }] }) }
      }
      if (url.includes('/quick-post')) {
        return { ok: true, json: async () => ({ items: [{ status: 'PUBLISHED_VERIFIED' }] }) }
      }
      return { ok: true, json: async () => ({}) }
    }))

    render(<ChannelConnections />)
    await screen.findByRole('region', { name: '다음 단계 안내' })
    expect(screen.getByRole('link', { name: /다음 글 만들기/ })).toHaveAttribute('href', '/app/content')
    expect(screen.getByRole('link', { name: '소희 작업실로 이동' })).toHaveAttribute('href', '/app')
  })

  it('SCOPE_MISSING 오류 시 게시 권한 안내 및 [다시 연결하기] 버튼을 role=alert로 렌더링한다', async () => {
    window.history.replaceState({}, '', '/app/channels?error=SCOPE_MISSING&channel=threads')
    mockResponses({ instagram: disconnected, threads: disconnected })
    render(<ChannelConnections />)

    const alertBox = await screen.findByRole('alert')
    expect(alertBox).toHaveTextContent('게시 권한을 허용해 주세요')
    expect(alertBox).toHaveTextContent('소희가 사장님 대신 글을 올리려면 "게시물 작성" 권한이 필요해요.')
    const retryBtn = within(alertBox).getByRole('link', { name: '다시 연결하기' })
    expect(retryBtn).toHaveAttribute('href', '/api/channels/threads/connect?returnPath=%2Fapp%2Fchannels')
  })

  it('ACCOUNT_ALREADY_CONNECTED 오류 시 중복 바인딩 안내 및 [다른 계정으로 연결하기] 버튼을 role=alert로 렌더링한다', async () => {
    window.history.replaceState({}, '', '/app/channels?error=ACCOUNT_ALREADY_CONNECTED&channel=instagram')
    mockResponses({ instagram: disconnected, threads: disconnected })
    render(<ChannelConnections />)

    const alertBox = await screen.findByRole('alert')
    expect(alertBox).toHaveTextContent('이미 다른 소희 계정에 연결된 계정이에요')
    expect(alertBox).toHaveTextContent('이 인스타그램/스레드 계정은 다른 소희 계정에서 사용 중이에요.')
    const switchBtn = within(alertBox).getByRole('link', { name: '다른 계정으로 연결하기' })
    expect(switchBtn).toHaveAttribute('href', '/api/channels/instagram/connect?returnPath=%2Fapp%2Fchannels')
  })

  describe('확장 권한 다시 연결 액션 (Meta App Review)', () => {
    const allowlistedWs = '00000000-0000-4000-8000-0000000000a2'

    it('서버 응답에서 extendedScopesAllowed가 false이면 클라이언트 process.env에 allowlist가 있더라도 액션이 노출되지 않는다 (서버 진실 단일 원천)', async () => {
      process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS = allowlistedWs
      mockResponses({ workspaceId: allowlistedWs, extendedScopesAllowed: false, instagram: verified, threads: disconnected })

      render(<ChannelConnections role="owner" />)
      await screen.findByRole('article', { name: '인스타그램' })
      expect(
        screen.queryByRole('link', { name: /확장 권한으로 다시 연결/ }),
      ).not.toBeInTheDocument()
    })

    it('서버 응답에서 extendedScopesAllowed가 true이면 44px 터치·16px 폰트의 확장 권한 다시 연결 액션이 노출된다', async () => {
      delete process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS
      mockResponses({ workspaceId: allowlistedWs, extendedScopesAllowed: true, instagram: verified, threads: disconnected })

      render(<ChannelConnections />)
      const instagram = await screen.findByRole('article', { name: '인스타그램' })
      const extendedLink = within(instagram).getByRole('link', {
        name: '인스타그램 확장 권한으로 다시 연결 (댓글·DM·인사이트)',
      })

      expect(extendedLink).toBeInTheDocument()
      expect(extendedLink).toHaveAttribute(
        'href',
        '/api/channels/instagram/connect?returnPath=/app/channels&extended=1',
      )
      expect(extendedLink.textContent).toBe('확장 권한으로 다시 연결 (댓글·DM·인사이트)')
      // 44px touch target & 16px font
      expect(extendedLink.className).toMatch(/min-h-\[44px\]/)
      expect(extendedLink.className).toMatch(/text-\[16px\]|text-base/)
    })

    it('canRequestExtended prop override가 주어지면 서버 응답보다 우선한다', async () => {
      mockResponses({ workspaceId: allowlistedWs, extendedScopesAllowed: false, instagram: verified, threads: disconnected })

      render(<ChannelConnections canRequestExtended={true} />)
      const instagram = await screen.findByRole('article', { name: '인스타그램' })
      expect(
        within(instagram).getByRole('link', {
          name: '인스타그램 확장 권한으로 다시 연결 (댓글·DM·인사이트)',
        }),
      ).toBeInTheDocument()
    })
  })
})
