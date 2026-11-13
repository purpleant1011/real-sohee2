// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useCustomersSnapshot } from './customers-snapshot'

const WS = 'ws-1'

function Probe({ workspaceId = WS }: { workspaceId?: string }) {
  const snapshot = useCustomersSnapshot(workspaceId)
  return <p>{`${snapshot.loadState}:${snapshot.customers.length}:${String(snapshot.complete)}:${String(snapshot.offline === true)}`}</p>
}

const ROW = {
  id: 'c1', workspaceId: WS, displayName: '김민지', segment: 'upcoming',
  consent: { status: 'granted', checkedAt: '2026-10-20T03:00:00Z', source: null },
  verifiedContacts: ['phone'], lastAction: null, sourceLabel: null,
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

/** jsdom 기본값은 online 이다. 오프라인 분기를 확인하려고 브라우저 신호만 바꾼다. */
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

let onlineDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  onlineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (onlineDescriptor) Object.defineProperty(window.navigator, 'onLine', onlineDescriptor)
  else Reflect.deleteProperty(window.navigator, 'onLine')
})

describe('고객 스냅샷 조회', () => {
  it('고객 API 를 no-store 로 읽는다', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      loadState: 'ready', customers: [ROW], workspaceId: WS, complete: true, checkedAt: '2026-10-22T00:00:00Z',
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Probe />)
    await screen.findByText('ready:1:true:false')
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${WS}/mobile-customers`, { cache: 'no-store', signal: expect.any(AbortSignal) })
  })

  it('다른 가게 스냅샷은 그대로 쓰지 않고 실패로 다룬다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      loadState: 'ready', customers: [{ ...ROW, workspaceId: 'ws-2' }], workspaceId: 'ws-2', complete: true, checkedAt: null,
    })))
    render(<Probe />)
    await screen.findByText('error:0:false:false')
  })

  it('응답이 계약과 다르면 빈 목록이 아니라 실패로 다룬다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ customers: 'nope' })))
    render(<Probe />)
    await screen.findByText('error:0:false:false')
  })

  it('네트워크 실패도 실패로 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('error:0:false:false')).toBeTruthy())
  })

  it('브라우저가 오프라인이면 실패를 네트워크 끊김으로 구분한다', async () => {
    setOnline(false)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    render(<Probe />)
    await screen.findByText('error:0:false:true')
  })

  it('서버가 응답한 401 은 오프라인이어도 인증 만료로 남긴다', async () => {
    setOnline(false)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    render(<Probe />)
    // 서버 응답을 받았다는 사실이 연결이 살아 있다는 증거다. 오프라인으로 덮지 않는다.
    await screen.findByText('error:0:false:false')
  })

  it('네트워크가 돌아오면 스스로 다시 확인한다', async () => {
    setOnline(false)
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({
        loadState: 'ready', customers: [ROW], workspaceId: WS, complete: true, checkedAt: '2026-10-22T00:00:00Z',
      }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Probe />)
    await screen.findByText('error:0:false:true')

    setOnline(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    await screen.findByText('ready:1:true:false')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
