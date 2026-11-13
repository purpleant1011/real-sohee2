// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ usePathname: () => '/app', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push, back: vi.fn() }) }))

import { R2More } from './r2-more'

const WS = '11111111-1111-4111-8111-111111111111'

/** 세 원천(가게 정보·채널·크레딧)의 응답 코드를 순서대로 돌려준다. */
function stubReads(...statuses: number[]) {
  const queue = [...statuses]
  const fetchMock = vi.fn(async () => {
    const status = queue.shift() ?? 200
    return new Response(status === 200 ? '{}' : JSON.stringify({ error: '요청을 처리하지 못했습니다.' }), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('R2 더보기 화면 배선 — 권한 없음 구분 (ANI-1714)', () => {
  it('기존 원천과 함께 동일 가게의 읽기 전용 상태를 조회하고 부분 실패도 재시도할 수 있다', async () => {
    let statusFails = true
    const mock = vi.fn(async (url: string) => {
      if (url.endsWith('/settings/status')) return statusFails
        ? Response.json({ workspaceId: WS, automation: { ok: false, value: null }, notifications: { ok: false, value: null } })
        : Response.json({ workspaceId: WS, automation: { ok: true, value: { mode: 'OFF', checkedAt: '2026-11-03T00:00:00Z' } }, notifications: { ok: true, value: { recentCount: 14, unreadCount: 5, checkedAt: '2026-11-03T00:00:00Z' } } })
      return Response.json({ profile: { business: { businessName: 'TEST' } } })
    })
    vi.stubGlobal('fetch', mock)
    render(<R2More workspaceId={WS} />)
    const retry = await screen.findByRole('button', { name: '상태 다시 확인' })
    statusFails = false
    fireEvent.click(retry)
    expect(await screen.findByText('알림 설정')).toBeVisible()
    expect(mock.mock.calls.some(([url]) => url.endsWith('/settings/status'))).toBe(true)
  })
  it('다른 가게 상태 응답은 자동 업무·알림 확인 근거로 쓰지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/settings/status')
      ? Response.json({ workspaceId: 'other', automation: { ok: true, value: { mode: 'OFF', checkedAt: '2026-11-03T00:00:00Z' } }, notifications: { ok: true, value: { recentCount: 14, unreadCount: 5, checkedAt: '2026-11-03T00:00:00Z' } } })
      : Response.json({ profile: { business: { businessName: 'TEST' } } })))
    render(<R2More workspaceId={WS} />)
    expect(await screen.findByRole('button', { name: /가게 정보/ })).toBeVisible()
    expect(screen.queryByText('자동 업무 설정 꺼짐')).toBeNull()
    expect(screen.queryByText(/최근 조회 14개/)).toBeNull()
  })
  it.each([{}, { workspaceId: 'other', status: 'ACTIVE', budgetAlertStage: 'NORMAL' }, { workspaceId: WS, status: 'MISSING', budgetAlertStage: 'NORMAL' }])('형식이 틀리거나 다른 가게의 크레딧 응답을 정상으로 표시하지 않는다: %j', async energy => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/agent/energy')
      ? Response.json(energy)
      : Response.json({ profile: { business: { businessName: 'TEST' } } })))
    render(<R2More workspaceId={WS} />)
    expect(await screen.findByRole('button', { name: /가게 정보/ })).toBeVisible()
    expect(screen.queryByText('크레딧 잔액 확인됨')).toBeNull()
  })
  it('가게 정보에서 매장 기본 정보 설정 화면을 연다', async () => {
    stubReads(200, 200, 200)
    render(<R2More workspaceId={WS} />)
    fireEvent.click(await screen.findByRole('button', { name: /가게 정보/ }))
    expect(push).toHaveBeenCalledWith('/app/settings/business')
  })

  it('세 원천이 모두 401 이면 조회 실패가 아닌 로그인 만료 안내로 알린다', async () => {
    const fetchMock = stubReads(401, 401, 401)
    render(<R2More workspaceId={WS} />)

    expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    // 인증이 끊기면 섹션 상태도 알 수 없다. '확인하지 못함' 목록을 그리지 않는다.
    expect(screen.queryByLabelText('설정 목록')).toBeNull()
    expect(screen.queryByLabelText('개인정보')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('세 원천이 모두 403 이면 권한 요청 안내로 알린다 — 만료와 구분한다', async () => {
    stubReads(403, 403, 403)
    render(<R2More workspaceId={WS} />)

    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
    expect(screen.queryByText('로그인이 만료됐어요')).toBeNull()
    expect(screen.queryByText('불러오지 못했어요')).toBeNull()
    expect(screen.queryByLabelText('설정 목록')).toBeNull()
    expect(screen.queryByLabelText('개인정보')).toBeNull()
  })

  it('403 과 401 이 섞이면 다시 로그인하면 함께 풀리는 로그인 만료를 먼저 알린다', async () => {
    stubReads(403, 403, 401)
    render(<R2More workspaceId={WS} />)

    expect(await screen.findByText('로그인이 만료됐어요')).toBeVisible()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  })

  it('일부만 권한 없음이면 가게 전체 권한으로 단정하지 않는다', async () => {
    // 가게 정보만 401, 나머지는 일시적 실패. 이 가게를 볼 권한 자체가 없다고 단정할 수 없다.
    stubReads(401, 500, 500)
    render(<R2More workspaceId={WS} />)

    expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  })

  it('권한 없음이 아닌 실패는 지금처럼 조회 실패로 남긴다', async () => {
    stubReads(500, 500, 500)
    render(<R2More workspaceId={WS} />)

    expect(await screen.findByText('불러오지 못했어요')).toBeVisible()
    expect(screen.queryByText('이 내용을 볼 권한이 없어요')).toBeNull()
  })
})
