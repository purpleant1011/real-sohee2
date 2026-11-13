import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { CustomersEntry } from './customers-entry'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/customers', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => <p>legacy-customers</p> }))

const WS = '11111111-1111-4111-8111-111111111111'

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean) {
  const tree = <CustomersEntry />
  return render(
    <WorkspaceProvider value={{ workspaceId: WS, workspaceName: '테스트', workspaceKind: 'standard', membershipRole: 'owner', actorId: 'user-1', resolutionSource: 'membership' }}>
      {r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree}
    </WorkspaceProvider>
  )
}

const customer = {
  id: 'c1', workspaceId: WS, displayName: '김민지', segment: 'inquiring' as const,
  consent: { status: 'unknown' as const, checkedAt: null, source: null },
  verifiedContacts: [], lastAction: null, sourceLabel: '인스타그램',
}

afterEach(() => vi.unstubAllGlobals())

describe('/app/customers 배선(ANI-1771)', () => {
  it('플래그 OFF(기본) 이면 기존 화면이고 새 API 호출이 없다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(false)
    expect(screen.getByText('legacy-customers')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면이고 API 호출이 없다', () => {
    narrow(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)
    expect(screen.getByText('legacy-customers')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON + 좁은 화면이면 R2 고객, 동의 미확인 고객의 연락 CTA 는 비활성', async () => {
    narrow(true)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ loadState: 'ready', customers: [customer], workspaceId: WS, complete: true, checkedAt: '2026-10-24T03:00:00.000Z' }) }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('김민지')).toBeVisible())
    expect(screen.queryByText('legacy-customers')).toBeNull()
    expect(screen.getByText('수신 동의 미확인')).toBeVisible()
    for (const b of screen.getAllByRole('button', { name: /로 연락/ })) expect(b).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${WS}/mobile-customers`, expect.objectContaining({ cache: 'no-store' }))
  })

  it('조회 실패는 고객 없음이 아니라 오류로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('등록된 고객이 없어요')).toBeNull()
  })

  it('다른 가게 스냅샷은 그리지 않고 오류로 끝난다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ loadState: 'ready', customers: [customer], workspaceId: 'other-ws', complete: true, checkedAt: null }) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('김민지')).toBeNull()
  })
})
