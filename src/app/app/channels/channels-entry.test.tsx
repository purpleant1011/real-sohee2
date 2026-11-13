import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { ChannelsEntry } from './channels-entry'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/channels', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('@/features/channels/ui/channel-connections', () => ({ ChannelConnections: () => <p>legacy-channels</p> }))

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
afterEach(() => vi.unstubAllGlobals())

describe('/app/channels 배선(ANI-1707)', () => {
  it('플래그 OFF(기본) 이면 기존 화면이고 새 API 호출이 없다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ChannelsEntry />)
    expect(screen.getByText('legacy-channels')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/channels', expect.anything())
  })
  it('플래그 ON 이어도 넓은 화면이면 기존 화면이고 PC 셸로 감싸진다', () => {
    narrow(false)
    render(<MobileR2Provider enabled><ChannelsEntry /></MobileR2Provider>)
    expect(screen.getByText('legacy-channels')).toBeVisible()
    expect(screen.getByTestId('business-world-pane')).toBeInTheDocument()
  })
  it('플래그 ON + 좁은 화면이면 R2 채널 화면, 서버 판정 그대로 표시', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ instagram: { status: 'VERIFIED', verified: true }, threads: { status: 'CONNECTED_UNVERIFIED', verified: false } }) })))
    render(<MobileR2Provider enabled><ChannelsEntry /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByText('인스타그램')).toBeVisible())
    expect(screen.queryByText('legacy-channels')).toBeNull()
    expect(screen.getByText('스레드')).toBeVisible()
  })
  it('플래그 ON 에서 조회 실패는 빈 목록이 아니라 오류로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    render(<MobileR2Provider enabled><ChannelsEntry /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('인스타그램')).toBeNull()
  })
  it('OAuth 복귀 쿼리를 읽어 취소 안내를 띄운다', async () => {
    narrow(true)
    window.history.replaceState({}, '', '/app/channels?connect=cancelled&channel=threads')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ instagram: { status: 'VERIFIED', verified: true }, threads: { status: 'CONNECTED_UNVERIFIED', verified: false } }) })))
    try {
      render(<MobileR2Provider enabled><ChannelsEntry /></MobileR2Provider>)
      await waitFor(() => expect(screen.getByText('새 연결을 완료하지 못했어요')).toBeVisible())
    } finally {
      window.history.replaceState({}, '', '/app/channels')
    }
  })
})
