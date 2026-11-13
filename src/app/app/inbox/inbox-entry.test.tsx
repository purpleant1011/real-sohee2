import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { InboxEntry } from './inbox-entry'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/inbox', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('./inbox-legacy', () => ({ default: () => <p>legacy-inbox</p> }))

const WS = '11111111-1111-4111-8111-111111111111'

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean) {
  const tree = <InboxEntry />
  return render(
    <WorkspaceProvider value={{ workspaceId: WS, workspaceName: '테스트', workspaceKind: 'standard', membershipRole: 'owner', actorId: 'user-1', resolutionSource: 'membership' }}>
      {r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree}
    </WorkspaceProvider>
  )
}

const thread = {
  id: 'th-1',
  workspaceId: WS,
  channel: 'instagram_dm' as const,
  customerName: '김하나',
  consent: 'granted' as const,
  status: 'draft_ready' as const,
  unread: true,
  lastMessage: { text: '내일 예약 가능할까요?', receivedAt: '2026-10-20T02:00:00.000Z', fromCustomer: true },
  summary: null,
  lastActivityAt: '2026-10-20T02:00:00.000Z',
  draft: { text: '네, 가능합니다.', sources: ['예약표'] },
  sendBlockers: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('/app/inbox 배선(ANI-1770)', () => {
  it('플래그 OFF(기본) 이면 기존 화면이고 새 API 호출이 없다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(false)
    expect(screen.getByText('legacy-inbox')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면', () => {
    narrow(false)
    renderEntry(true)
    expect(screen.getByText('legacy-inbox')).toBeVisible()
  })

  it('플래그 ON + 좁은 화면이면 R2 소통함, 서버 판정 그대로 표시', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ loadState: 'ready', threads: [thread], workspaceId: WS, complete: true, checkedAt: '2026-10-20T03:00:00.000Z' }) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('김하나')).toBeVisible())
    expect(screen.queryByText('legacy-inbox')).toBeNull()
    expect(screen.getByText('답안 준비됨')).toBeVisible()
  })

  it('플래그 ON 에서 조회 실패는 빈 목록이 아니라 오류로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('새 문의가 없어요')).toBeNull()
  })

  it('다른 가게 스냅샷은 그리지 않고 오류로 끝난다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ loadState: 'ready', threads: [thread], workspaceId: 'other-ws', complete: true, checkedAt: null }) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('김하나')).toBeNull()
  })
})
