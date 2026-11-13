// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: ReactElement }) => <>{children}</>,
  ShellScreen: ({ children }: { children: ReactElement }) => <>{children}</>,
}))

import { R2Memory } from './r2-memory'

const WS = '11111111-1111-4111-8111-111111111111'

const CANDIDATE = {
  key: 'price:가격',
  kind: 'price',
  proposalId: 'p-1',
  proposedValue: '커트 35,000원',
  currentValue: '커트 30,000원',
  origin: 'owner_stated',
  source: { label: '소희와의 대화', href: null, observedAt: '2026-10-22T01:00:00.000Z' },
  customerVisible: true,
}

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => ({ ok: true, json: async () => payload }) as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('R2 가게 기억 화면 배선 (ANI-1709)', () => {
  it('서버 스냅샷을 그대로 그린다', async () => {
    const fetchMock = stubFetch({
      workspaceId: WS, loadState: 'ready', complete: true,
      checkedAt: '2026-10-24T05:00:00.000Z', candidates: [CANDIDATE],
    })
    render(<R2Memory workspaceId={WS} />)

    expect(await screen.findByText('가격')).toBeTruthy()
    expect(screen.getByText('커트 35,000원')).toBeTruthy()
    expect(screen.getByText('커트 30,000원')).toBeTruthy()
    expect(screen.getByText('변경 제안')).toBeTruthy()
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspaces/${WS}/mobile-memory`)
    expect(fetchMock.mock.calls[0][1]?.cache).toBe('no-store')
  })

  it('조회 실패는 "기억 없음"이 아니라 실패로 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<R2Memory workspaceId={WS} />)

    expect(await screen.findByText('불러오지 못했어요')).toBeTruthy()
    expect(screen.queryByText('확인할 가게 정보가 없어요')).toBeNull()
  })

  it('다른 가게 스냅샷은 그리지 않고 실패로 닫는다', async () => {
    stubFetch({ workspaceId: 'other', loadState: 'ready', complete: true, checkedAt: null, candidates: [CANDIDATE] })
    render(<R2Memory workspaceId={WS} />)

    expect(await screen.findByText('불러오지 못했어요')).toBeTruthy()
    expect(screen.queryByText('커트 35,000원')).toBeNull()
  })

  it('일부만 확인되면 빈 목록을 "없음"으로 단정하지 않는다', async () => {
    stubFetch({ workspaceId: WS, loadState: 'ready', complete: false, checkedAt: '2026-10-24T05:00:00.000Z', candidates: [] })
    render(<R2Memory workspaceId={WS} />)

    expect(await screen.findByText('일부만 불러왔어요')).toBeTruthy()
    expect(screen.queryByText('확인할 가게 정보가 없어요')).toBeNull()
  })

  it('완전히 확인된 빈 목록만 "없음"으로 표시한다', async () => {
    stubFetch({ workspaceId: WS, loadState: 'ready', complete: true, checkedAt: '2026-10-24T05:00:00.000Z', candidates: [] })
    render(<R2Memory workspaceId={WS} />)

    await waitFor(() => expect(screen.getByText('확인할 가게 정보가 없어요')).toBeTruthy())
  })
})

// 승인 가능한 후보(기존 값 없음) — 변경 제안은 재확인이 필요하므로 결정 테스트에는 쓰지 않는다.
const APPROVABLE = { ...CANDIDATE, key: 'service:커트', currentValue: null }

function snapshotPayload() {
  return {
    workspaceId: WS, loadState: 'ready', complete: true,
    checkedAt: '2026-10-24T05:00:00.000Z', candidates: [APPROVABLE],
  }
}

function stubDecisionFetch(response: { status?: number; payload: unknown }) {
  const status = response.status ?? 200
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === 'POST') {
      return { ok: status < 400, status, json: async () => response.payload } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => snapshotPayload() } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function approveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '이 내용으로 승인' }) as HTMLButtonElement
}

function rejectButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '이 내용은 아니에요' }) as HTMLButtonElement
}

const posts = (fetchMock: ReturnType<typeof stubDecisionFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

describe('R2 가게 기억 승인·거절 쓰기 (ANI-1709 M22)', () => {
  it('화면을 열기만 해서는 쓰기 요청을 보내지 않는다', async () => {
    const fetchMock = stubDecisionFetch({ payload: {} })
    render(<R2Memory workspaceId={WS} />)

    expect(await screen.findByText('커트 35,000원')).toBeTruthy()
    expect(posts(fetchMock)).toHaveLength(0)
  })

  it('승인을 누르면 그 제안만 한 번 쓰고 결과를 알린다', async () => {
    const fetchMock = stubDecisionFetch({
      payload: { outcome: 'decided', proposalId: 'p-1', status: 'confirmed', factId: null },
    })
    render(<R2Memory workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 승인' }))

    expect(await screen.findByText('승인했어요.')).toBeTruthy()
    const sent = posts(fetchMock)
    expect(sent).toHaveLength(1)
    expect(sent[0]![0]).toBe(`/api/workspaces/${WS}/mobile-memory`)
    expect(sent[0]![1]?.cache).toBe('no-store')
    expect(sent[0]![1]?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(sent[0]![1]?.body))).toEqual({
      proposalId: 'p-1', decision: 'confirm', confirm: true,
    })
    expect(approveButton().disabled).toBe(true)
  })

  it('거절은 승인과 다른 결정으로 보내고 거절 결과를 알린다', async () => {
    const fetchMock = stubDecisionFetch({
      payload: { outcome: 'decided', proposalId: 'p-1', status: 'rejected', factId: null },
    })
    render(<R2Memory workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: '이 내용은 아니에요' }))

    expect(await screen.findByText('거절했어요.')).toBeTruthy()
    expect(JSON.parse(String(posts(fetchMock)[0]![1]?.body))).toEqual({
      proposalId: 'p-1', decision: 'reject', confirm: true,
    })
  })

  it('이미 처리된 항목은 성공과 구분해 알린다', async () => {
    stubDecisionFetch({
      payload: { outcome: 'already_handled', proposalId: 'p-1', status: 'confirmed', factId: null },
    })
    render(<R2Memory workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 승인' }))

    expect(await screen.findByText('이미 승인된 항목이에요.')).toBeTruthy()
    expect(screen.queryByText('승인했어요.')).toBeNull()
  })

  it('저장 실패는 성공으로 넘기지 않고 다시 시도할 수 있게 둔다', async () => {
    stubDecisionFetch({ status: 503, payload: { outcome: 'unavailable', proposalId: 'p-1' } })
    render(<R2Memory workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 승인' }))

    expect(await screen.findByText('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(approveButton().disabled).toBe(false)
    expect(rejectButton().disabled).toBe(false)
    expect(screen.queryByText('승인했어요.')).toBeNull()
  })

  it('없는 항목은 실패와 다른 사유로 알린다', async () => {
    stubDecisionFetch({ status: 404, payload: { outcome: 'not_found', proposalId: 'p-1' } })
    render(<R2Memory workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: '이 내용으로 승인' }))

    expect(await screen.findByText('이미 처리됐거나 찾을 수 없는 항목이에요. 화면을 새로 고쳐 확인해 주세요.')).toBeTruthy()
  })

  it('빠르게 두 번 눌러도 한 번만 보낸다', async () => {
    const fetchMock = stubDecisionFetch({
      payload: { outcome: 'decided', proposalId: 'p-1', status: 'confirmed', factId: null },
    })
    render(<R2Memory workspaceId={WS} />)

    const button = await screen.findByRole('button', { name: '이 내용으로 승인' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(await screen.findByText('승인했어요.')).toBeTruthy()
    expect(posts(fetchMock)).toHaveLength(1)
  })
})
