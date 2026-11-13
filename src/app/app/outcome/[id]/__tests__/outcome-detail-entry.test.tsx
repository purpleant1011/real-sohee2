// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
/** 셸은 자기 테스트가 있다. 여기서는 진입점이 무엇을 그리는지만 본다. */
vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: ReactNode }) => children,
}))

import { OutcomeDetailEntry } from '../outcome-detail-entry'

const MISSION = '11111111-1111-4111-8111-111111111111'
const OTHER_MISSION = '33333333-3333-4333-8333-333333333333'
const WS = '22222222-2222-4222-8222-222222222222'

const VERIFIED_RESULT = {
  overallStatus: 'ALL_VERIFIED',
  receipts: {
    instagram: {
      channel: 'instagram',
      stage: 'EXTERNALLY_VERIFIED',
      permalink: 'https://www.instagram.com/p/abc/',
      verifiedAt: '2026-10-24T01:00:00Z',
    },
  },
}

const CHECKING_RESULT = {
  overallStatus: 'PARTIAL_SUCCESS',
  receipts: { instagram: { channel: 'instagram', stage: 'PROVIDER_ACCEPTED' } },
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function matchesAt(query: string, px: number): boolean {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query)
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)
  const checks: number[] = []
  if (max) checks.push(px <= Number(max[1]) ? 1 : 0)
  if (min) checks.push(px >= Number(min[1]) ? 1 : 0)
  return checks.length > 0 && checks.every(Boolean)
}

function stubWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matchesAt(query, px),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** 전달 실패로 끝난 실행 — 서버가 재시도를 허용하는 상태. */
const FAILED_RESULT = {
  overallStatus: 'FAILED',
  receipts: { instagram: { channel: 'instagram', stage: 'FAILED', failureCause: 'TRANSPORT_FAILED' } },
}

const fetchSpy = vi.fn()

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  router.replace.mockReset()
  router.push.mockReset()
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
  // 가드는 페이지 단위 싱글턴이다 — 테스트 사이에 '진행 중' 슬롯이 남지 않게 매번 새로 시작한다.
  resetPageActionGuardForTests()
  setOnline(true)
  stubWidth(390)
})

afterEach(() => vi.unstubAllGlobals())

function ui(props: Readonly<{ missionId?: string; workspaceId?: string; enabled?: boolean }> = {}) {
  return (
    <MobileR2Provider enabled={props.enabled ?? true}>
      <OutcomeDetailEntry missionId={props.missionId ?? MISSION} workspaceId={props.workspaceId ?? WS} />
    </MobileR2Provider>
  )
}

function renderEntry(props: Readonly<{ missionId?: string; workspaceId?: string; enabled?: boolean }> = {}) {
  return render(ui(props))
}

describe('M08 결과 상세 진입점 (/app/outcome/:id)', () => {
  it('저장된 readback 근거로만 게시 확인을 그린다', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        executionResult: VERIFIED_RESULT,
        approvedChannels: { instagram: '@sohee' },
      }),
    )

    renderEntry()

    expect(await screen.findByRole('heading', { name: '게시를 확인했어요' })).toBeDefined()
    expect(screen.getAllByText('인스타그램 게시 확인').length).toBeGreaterThanOrEqual(1)
    // 승인 스냅샷의 계정(`@sohee`)을 대조 근거로 표시한다(화면은 `@` 없이 보여 준다).
    expect(screen.getByText('sohee')).toBeDefined()

    const links = screen.getAllByRole('link', { name: '게시물 보기' })
    expect(links[0].getAttribute('href')).toBe('https://www.instagram.com/p/abc/')

    // 조회는 매장 범위로만, 캐시 없이 나간다.
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/missions/first-post/${MISSION}/outcome`,
      expect.objectContaining({ cache: 'no-store', headers: { 'x-workspace-id': WS } }),
    )
  })

  it('승인 계정을 확인할 수 없으면 게시 확인으로 올리지 않는다', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { success: true, executionResult: VERIFIED_RESULT, approvedChannels: {} }),
    )

    renderEntry()

    expect(await screen.findByText('게시 대상 계정을 확인할 수 없어 직접 확인해 주세요.')).toBeDefined()
    expect(screen.queryByRole('heading', { name: '게시를 확인했어요' })).toBeNull()
  })

  it('저장된 결과가 없으면 실패가 아니라 "아직 없음"이다', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { success: true, executionResult: null, approvedChannels: {} }))

    renderEntry()

    expect(await screen.findByText('아직 게시 결과가 없어요')).toBeDefined()
  })

  it('조회 실패를 "결과 없음"으로 낮추지 않는다', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(500, { error: '게시 결과를 확인하지 못했어요.' }))

    renderEntry()

    expect(await screen.findByText('게시 결과를 확인하지 못했어요')).toBeDefined()
    expect(screen.queryByText('아직 게시 결과가 없어요')).toBeNull()
  })

  it('다른 매장·없는 미션은 찾지 못함으로 표시한다', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(404, { error: '게시 결과를 찾지 못했어요.' }))

    renderEntry()

    expect(await screen.findByText('게시 결과를 찾지 못했어요')).toBeDefined()
  })

  it('모양이 어긋난 결과는 확인 실패로 남긴다', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { success: true, executionResult: { hello: 1 } }))

    renderEntry()

    expect(await screen.findByText('게시 결과를 확인하지 못했어요')).toBeDefined()
  })

  it('결과 새로고침은 저장된 결과를 다시 읽는다(새 게시 없음)', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { success: true, executionResult: CHECKING_RESULT, approvedChannels: {} }),
    )

    renderEntry()

    const refresh = await screen.findByRole('button', { name: '결과 새로고침' })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    fireEvent.click(refresh)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })

  it('1440 넓은 화면은 조회하지 않고 작업함으로 되돌린다', async () => {
    stubWidth(1440)

    renderEntry()

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/app/content'))
    // 넓은 화면은 이 상세를 그리지 않으므로 저장된 결과도 읽지 않는다.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('플래그가 꺼져 있으면 조회하지 않는다', async () => {
    renderEntry({ enabled: false })

    expect(await screen.findByText('작업함으로 이동하고 있어요.')).toBeDefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('미션·매장이 바뀌면 이전 확인 결과를 즉시 지운다', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { success: true, executionResult: VERIFIED_RESULT, approvedChannels: { instagram: '@sohee' } }),
    )

    const view = renderEntry()
    expect(await screen.findByRole('heading', { name: '게시를 확인했어요' })).toBeDefined()

    // 새 대상의 조회는 아직 응답이 없다 — 그동안 이전 결과를 보여 주면 안 된다.
    fetchSpy.mockImplementationOnce(() => new Promise<Response>(() => {}))
    view.rerender(ui({ missionId: OTHER_MISSION }))

    expect(screen.queryByRole('heading', { name: '게시를 확인했어요' })).toBeNull()
    expect(screen.getByText('확인하는 중이에요')).toBeDefined()
  })

  it('이전 대상의 늦은 응답은 새 조회 결과를 덮어쓰지 않는다', async () => {
    let resolveStale: (value: Response) => void = () => {}
    fetchSpy.mockImplementationOnce(
      () => new Promise<Response>((resolve) => { resolveStale = resolve }),
    )

    const view = renderEntry()

    // 새 대상 조회는 정상 응답한다.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { success: true, executionResult: CHECKING_RESULT, approvedChannels: {} }),
    )
    view.rerender(ui({ missionId: OTHER_MISSION }))
    expect(await screen.findByText('외부 확인 중이에요')).toBeDefined()

    // 뒤늦게 도착한 이전 대상의 '게시 확인' 응답은 버려진다.
    await act(async () => {
      resolveStale(jsonResponse(200, { success: true, executionResult: VERIFIED_RESULT, approvedChannels: { instagram: '@sohee' } }))
    })

    expect(screen.queryByRole('heading', { name: '게시를 확인했어요' })).toBeNull()
    expect(screen.getByText('외부 확인 중이에요')).toBeDefined()
  })

  it('오프라인에서는 재시도 요청을 보내지 않고 이유를 알린다 (ANI-1778)', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { success: true, executionResult: FAILED_RESULT, approvedChannels: {} }),
    )
    renderEntry()

    // 채널 행과 하단 기본 행동 두 곳에 같은 '다시 시도'가 있다 — 어느 쪽을 눌러도 같은 재시도다.
    const [retry] = await screen.findAllByRole('button', { name: '다시 시도' })
    setOnline(false)
    fireEvent.click(retry)

    expect(await screen.findByRole('alert')).toHaveTextContent(OFFLINE_WRITE_COPY)
    expect(fetchSpy.mock.calls.some(([url]) => url === '/api/missions/first-post/publish/retry')).toBe(false)
  })

  it('재시도를 연달아 눌러도 외부 요청은 한 번만 나간다 (ANI-1778)', async () => {
    // 첫 재시도 요청을 붙잡아 두어 '진행 중' 상태를 만든다.
    let release!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/manifest.webmanifest')) return Promise.resolve(jsonResponse(200, {}))
      if (url === '/api/missions/first-post/publish/retry') return pending
      return Promise.resolve(jsonResponse(200, { success: true, executionResult: FAILED_RESULT, approvedChannels: {} }))
    })
    renderEntry()

    const [retry] = await screen.findAllByRole('button', { name: '다시 시도' })
    fireEvent.click(retry)
    fireEvent.click(retry)

    expect(await screen.findByText(DUPLICATE_WRITE_COPY)).toBeDefined()
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/missions/first-post/publish/retry')).toHaveLength(1)
    await act(async () => {
      release(jsonResponse(200, { success: true }))
    })
  })
})
