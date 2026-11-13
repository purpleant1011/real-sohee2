import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { SystemEntry } from './system-entry'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/system', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => <p>legacy-system</p> }))

const WS = '11111111-1111-4111-8111-111111111111'

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean) {
  const tree = <SystemEntry />
  return render(
    <WorkspaceProvider value={{ workspaceId: WS, workspaceName: '테스트', workspaceKind: 'standard', membershipRole: 'owner', actorId: 'user-1', resolutionSource: 'membership' }}>
      {r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree}
    </WorkspaceProvider>
  )
}

/** 기존 읽기 API 3개(가게 정보·채널·크레딧)만 응답한다. */
function sources(overrides: { profile?: unknown; channels?: unknown; energy?: unknown } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    void init
    if (url.endsWith('/profile')) {
      return overrides.profile === undefined
        ? { ok: true, json: async () => ({ success: true, profile: { business: { businessName: '바이름' }, brand: {} } }) }
        : overrides.profile
    }
    if (url === '/api/channels') {
      return overrides.channels === undefined
        ? { ok: true, json: async () => ({ instagram: { status: 'VERIFIED', verified: true, supportedPublish: true }, threads: { status: 'VERIFIED', verified: true, supportedPublish: true } }) }
        : overrides.channels
    }
    return overrides.energy === undefined
      ? { ok: true, json: async () => ({ workspaceId: WS, status: 'ACTIVE', budgetAlertStage: 'NORMAL', balanceSC: 2000 }) }
      : overrides.energy
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('/app/system 배선(ANI-1771)', () => {
  it('플래그 OFF(기본) 이면 기존 화면이고 새 API 호출이 없다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(false)
    expect(screen.getByText('legacy-system')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면이고 API 호출이 없다', () => {
    narrow(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)
    expect(screen.getByText('legacy-system')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON + 좁은 화면이면 세 원천을 no-store 로 읽어 더보기를 그린다', async () => {
    narrow(true)
    const fetchMock = sources()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('채널 연결')).toBeVisible())
    expect(screen.queryByText('legacy-system')).toBeNull()
    expect(screen.getByText('지금 보는 가게: 테스트')).toBeVisible()
    expect(screen.getByText('우리 가게')).toBeVisible()
    expect(screen.getByText('채널 연결').closest('li')?.textContent).toContain('확인됨')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
    }
  })

  it('원천이 없는 섹션과 개인정보 요청 상태는 값을 만들지 않는다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', sources())
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('채널 연결')).toBeVisible())
    for (const label of ['우리 가게', '연결', '요금·결제', '알림·계정', '도움']) {
      expect(screen.getByText(label)).toBeVisible()
    }
    expect(screen.queryByText('진행 상태를 확인하지 못했어요')).toBeNull()
    // 개인정보 요청은 더보기가 아닌 별도 관리 화면으로 안내한다.
    expect(screen.queryByText(/내 정보 내보내기 요청$/)).toBeNull()
    expect(screen.getByRole('link', { name: /개인정보 관리/ })).toHaveAttribute('href', '/app/system/privacy')
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
  })

  it('일부 조회가 실패하면 그 섹션만 확인하지 못함으로 남고 나머지는 그대로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', sources({ profile: { ok: false, json: async () => ({}) } }))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('채널 연결')).toBeVisible())
    expect(screen.getByText('가게 정보')).toBeVisible()
    const storeRow = screen.getByText('가게 정보').closest('li')
    if (!storeRow) throw new Error('가게 정보 설정 행이 없어요')
    expect(within(storeRow).getByText('외부 확인 중')).toBeVisible()
    expect(within(storeRow).queryByText('확인됨')).toBeNull()
  })

  it('세 조회가 모두 실패하면 정상이 아니라 오류로 끝난다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
    expect(screen.queryByText('채널 연결')).toBeNull()
  })

  it('다른 가게의 채널 응답은 그리지 않고 확인하지 못함으로 둔다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', sources({ channels: { ok: true, json: async () => ({ success: true, workspaceId: 'other-ws', instagram: { status: 'VERIFIED', verified: true, supportedPublish: true }, threads: { status: 'VERIFIED', verified: true, supportedPublish: true } }) } }))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('가게 정보')).toBeVisible())
    const channelRow = screen.getByText('채널 연결').closest('li')
    if (!channelRow) throw new Error('채널 행이 없어요')
    expect(within(channelRow).getByText('외부 확인 중')).toBeVisible()
    expect(within(channelRow).queryByText('확인됨')).toBeNull()
  })

  it('채널 응답 형식이 다르면 연결 상태를 단정하지 않는다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', sources({ channels: { ok: true, json: async () => ({ channels: [] }) } }))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('가게 정보')).toBeVisible())
    const channelRow = screen.getByText('채널 연결').closest('li')
    if (!channelRow) throw new Error('채널 행이 없어요')
    expect(within(channelRow).getByText('외부 확인 중')).toBeVisible()
    expect(within(channelRow).queryByText('확인됨')).toBeNull()
  })

  it('게시 지원 근거가 없는 채널은 검증 문자열만으로 게시 가능이 되지 않는다', async () => {
    narrow(true)
    // 실제 /api/channels 는 5개 키를 모두 내려준다. 나머지 3개는 확인된 미연결로 두어
    // '검증 문자열만 있는' 2개 채널의 판정만 이 테스트가 보게 한다.
    vi.stubGlobal('fetch', sources({ channels: { ok: true, json: async () => ({ instagram: { status: 'VERIFIED', verified: true }, threads: { status: 'VERIFIED', verified: true }, naverBlog: { status: 'NOT_CONNECTED' }, naverPlace: { status: 'NOT_CONNECTED' }, daangn: { status: 'NOT_CONNECTED' } }) } }))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('가게 정보')).toBeVisible())
    const channelRow = screen.getByText('채널 연결').closest('li')
    if (!channelRow) throw new Error('채널 행이 없어요')
    expect(within(channelRow).getByText('외부 확인 중')).toBeVisible()
    expect(within(channelRow).queryByText('확인됨')).toBeNull()
  })

  it('연결만 된 채널은 확인이 필요하다고 센다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', sources({ channels: { ok: true, json: async () => ({ instagram: { status: 'CONNECTED_UNVERIFIED' }, threads: { status: 'NOT_CONNECTED' } }) } }))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('가게 정보')).toBeVisible())
    const channelRow = screen.getByText('채널 연결').closest('li')
    if (!channelRow) throw new Error('채널 행이 없어요')
    expect(within(channelRow).getByText('조치 필요')).toBeVisible()
  })
})
