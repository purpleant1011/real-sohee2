import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'

const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/campaigns',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
}))

import { CampaignsEntry } from './campaigns-entry'

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
const payload = (workspaceId: string, over: Record<string, unknown> = {}) => ({
  workspaceId, loadState: 'ready', candidates: [], customers: [], now: '2026-10-24T00:00:00.000Z', checkedAt: '2026-10-24T00:00:00.000Z', sourceConnected: true, ...over,
})

const FINGERPRINT = 'a'.repeat(64)
const approvable = {
  proposal: {
    id: 'p1', workspaceId: 'ws-a', kind: 'revisit', slotId: 'slot-1',
    message: '오랜만에 들러 주세요', audienceIds: ['c1'], estimatedConversions: 1,
    sentTo: [], approvedAt: null, dispatchIdempotencyKey: 'dispatch-p1',
  },
  slot: null,
  channel: { channelLabel: '인스타그램', publishable: true, reason: null, next: null },
  ledger: { available: 100, reserved: 0, consumed: 0, refunded: 0, observedAt: '2026-10-23T00:00:00.000Z' },
  estimate: 5,
  actualConversions: null,
  actualSource: null,
  fingerprint: FINGERPRINT,
}
const consentedCustomer = {
  id: 'c1', workspaceId: 'ws-a', displayName: '김민지', segment: 'revisit',
  consent: { status: 'granted', checkedAt: '2026-10-20T00:00:00.000Z', source: '예약 시 동의' },
  verifiedContacts: ['message'], lastAction: null, sourceLabel: null,
}

beforeEach(() => replace.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('/app/campaigns 진입(ANI-1771)', () => {
  it('플래그 OFF 이면 새 API 호출 없이 기존 화면으로 보낸다', async () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignsEntry workspaceId="ws-a" />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/sohee?tab=campaigns'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면으로 보낸다', async () => {
    narrow(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/sohee?tab=campaigns'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON + 좁은 화면이면 이동 없이 R2 제안 화면을 그리고 우리 매장 API 만 부른다', async () => {
    narrow(true)
    const fetchMock = vi.fn<(url: string) => Promise<unknown>>(async () => ({ ok: true, json: async () => payload('ws-a') }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByText('제안이 없어요')).toBeVisible())
    expect(replace).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/ws-a/mobile-campaigns')
  })

  it('제안 원본 미연결(503, unknown)은 "제안 없음"이 아니라 확인 불가로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => payload('ws-a', { loadState: 'unknown', sourceConnected: false }) })))
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('제안이 없어요')).toBeNull()
  })

  it('다른 매장 응답은 그리지 않고 오류로 다룬다(계정 경계)', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload('ws-OTHER') })))
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('제안이 없어요')).toBeNull()
  })

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x') }))
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByText('제안이 없어요')).toBeNull()
  })

  it('"승인했어요" 문구는 쓰기 응답이 성공한 뒤에만 보인다', async () => {
    narrow(true)
    let release: (value: unknown) => void = () => {}
    const postGate = new Promise<unknown>(resolve => { release = resolve })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<unknown> => {
      if (init?.method === 'POST') return postGate
      return { ok: true, json: async () => payload('ws-a', { candidates: [approvable], customers: [consentedCustomer] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)

    fireEvent.click(await screen.findByRole('button', { name: /문구 확인하고 승인/ }))

    // 쓰기 응답이 오기 전에는 성공 문구가 없어야 한다.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/workspaces/ws-a/mobile-campaigns/approve')
    const postInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(postInit.method).toBe('POST')
    expect((postInit.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
    expect(JSON.parse(String(postInit.body))).toEqual({
      proposalId: 'p1', slotId: 'slot-1', expectedFingerprint: FINGERPRINT,
    })
    expect(screen.queryByText(/승인했어요/)).toBeNull()

    release({ ok: true, status: 200, json: async () => ({ approved: true, decidedAt: '2026-10-24T00:01:00.000Z', externalPublishCount: 0 }) })

    expect(await screen.findByText(/승인했어요/)).toBeVisible()
  })

  it('승인 실패(409)에는 "승인했어요" 문구를 쓰지 않고 사유를 구분해 보여준다', async () => {
    narrow(true)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit): Promise<unknown> => {
      if (init?.method === 'POST') return { ok: false, status: 409, json: async () => ({ error: 'ALREADY_RESOLVED' }) }
      return { ok: true, json: async () => payload('ws-a', { candidates: [approvable], customers: [consentedCustomer] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MobileR2Provider enabled><CampaignsEntry workspaceId="ws-a" /></MobileR2Provider>)

    fireEvent.click(await screen.findByRole('button', { name: /문구 확인하고 승인/ }))

    expect(await screen.findByText(/이미 처리된 제안이에요/)).toBeVisible()
    expect(screen.queryByText(/승인했어요/)).toBeNull()
  })
})
