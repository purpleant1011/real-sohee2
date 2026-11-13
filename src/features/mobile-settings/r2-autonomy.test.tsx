// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: ReactElement }) => <>{children}</>,
  ShellScreen: ({ children }: { children: ReactElement }) => <>{children}</>,
}))

import { autonomyScreenConfig, R2Autonomy } from './r2-autonomy'

const WS = '11111111-1111-4111-8111-111111111111'

const RUNNING = {
  workspaceId: WS,
  desiredMode: 'RUNNING',
  actualMode: 'RUNNING',
  activeActionRunCount: 2,
  killSwitchActive: false,
  version: 7,
  updated_at: '2026-10-24T05:00:00.000Z',
}

const PAUSED = {
  ...RUNNING,
  desiredMode: 'PAUSED',
  actualMode: 'PAUSED',
  activeActionRunCount: 0,
  version: 8,
}

type Call = { url: string; init?: RequestInit }

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const call = { url: String(input), init: init as RequestInit | undefined }
    calls.push(call)
    return (await handler(call)) as unknown as Response
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('R2 자율근무 화면 배선 (ANI-1712)', () => {
  it('서버 readback 만으로 상태를 표시한다', async () => {
    const calls = stubFetch(() => json(RUNNING))
    render(<R2Autonomy workspaceId={WS} />)

    expect(await screen.findByText('2건 진행 중')).toBeTruthy()
    expect(screen.getByRole('button', { name: /잠시 멈추기/ })).toBeTruthy()
    expect(calls[0].url).toBe(`/api/workspaces/${WS}/agent/control`)
    expect(calls[0].init?.cache).toBe('no-store')
  })

  it('중지는 서버 확인 전까지 "중지됨"으로 표시하지 않는다', async () => {
    let gets = 0
    const calls = stubFetch(call => {
      if (call.init?.method === 'POST') return json({ ok: true })
      gets += 1
      return gets === 1 ? json(RUNNING) : new Promise<Response>(() => {})
    })
    render(<R2Autonomy workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: /잠시 멈추기/ }))

    await waitFor(() => expect(calls.some(c => c.init?.method === 'POST')).toBe(true))
    const post = calls.find(c => c.init?.method === 'POST')
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ action: 'set_mode', desiredMode: 'PAUSED', expectedVersion: 7 })
    // 로컬 토글로 성공이나 과거 가동을 현재 상태처럼 표시하지 않는다.
    expect(screen.getByText('상태를 확인하고 있어요')).toBeTruthy()
    expect(screen.queryByText('2건 진행 중')).toBeNull()
    expect(screen.queryByText('중지됨 · 새 일을 시작하지 않아요')).toBeNull()
  })

  it('서버가 PAUSED 를 확인해 준 뒤에만 중지됨으로 바뀐다', async () => {
    let gets = 0
    stubFetch(call => {
      if (call.init?.method === 'POST') return json({ ok: true })
      gets += 1
      return json(gets === 1 ? RUNNING : PAUSED)
    })
    render(<R2Autonomy workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: /잠시 멈추기/ }))

    expect(await screen.findByText('중지됨 · 새 일을 시작하지 않아요')).toBeTruthy()
    expect(screen.getByRole('button', { name: /다시 시작/ })).toBeTruthy()
  })

  it('다른 기기에서 중지한 뒤 이 기기로 돌아오면 서버 상태(PAUSED)로 맞춘다', async () => {
    // 이 기기는 아무것도 POST 하지 않는다. 다른 기기의 변경은 서버 readback 으로만 들어온다.
    let gets = 0
    const calls = stubFetch(call => {
      if (call.init?.method === 'POST') throw new Error('이 기기에서 POST 하면 안 된다')
      gets += 1
      return json(gets === 1 ? RUNNING : PAUSED)
    })
    render(<R2Autonomy workspaceId={WS} />)

    expect(await screen.findByText('2건 진행 중')).toBeTruthy()

    // 앱 복귀/새로고침: 화면이 보이는 순간 서버 상태를 다시 읽는다.
    document.dispatchEvent(new Event('visibilitychange'))

    expect(await screen.findByText('중지됨 · 새 일을 시작하지 않아요')).toBeTruthy()
    expect(screen.getByRole('button', { name: /다시 시작/ })).toBeTruthy()
    expect(calls.some(call => call.init?.method === 'POST')).toBe(false)
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('다른 기기 선변경(409)은 충돌로 알리고 상태를 유지한다', async () => {
    stubFetch(call => call.init?.method === 'POST' ? json({}, 409) : json(RUNNING))
    render(<R2Autonomy workspaceId={WS} />)

    fireEvent.click(await screen.findByRole('button', { name: /잠시 멈추기/ }))

    // 충돌 문구는 상태 영역과 안내 문구에 함께 나온다.
    expect((await screen.findAllByText('다른 기기에서 먼저 바뀌었어요. 최신 상태를 다시 확인해 주세요.')).length).toBeGreaterThan(0)
    expect(screen.queryByText('중지됨 · 새 일을 시작하지 않아요')).toBeNull()
  })

  it('조회 실패는 "대기 중"이 아니라 확인 실패로 보여준다', async () => {
    stubFetch(() => { throw new Error('offline') })
    render(<R2Autonomy workspaceId={WS} />)

    expect(await screen.findByText('소희 일하기 상태를 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.')).toBeTruthy()
    expect(screen.queryByText('대기 중 · 새 일을 받을 수 있어요')).toBeNull()
    expect(screen.queryByRole('button', { name: /잠시 멈추기/ })).toBeNull()
  })

  it('다른 작업공간 응답은 그리지 않고 확인 실패로 닫는다', async () => {
    stubFetch(() => json({ ...RUNNING, workspaceId: 'other' }))
    render(<R2Autonomy workspaceId={WS} />)

    expect(await screen.findByText('소희 일하기 상태를 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.')).toBeTruthy()
    expect(screen.queryByText('2건 진행 중')).toBeNull()
  })

  it('화면 모드는 DETAIL·자율근무다', () => {
    expect(autonomyScreenConfig()).toEqual({ mode: 'DETAIL', title: '자율근무' })
  })
})
