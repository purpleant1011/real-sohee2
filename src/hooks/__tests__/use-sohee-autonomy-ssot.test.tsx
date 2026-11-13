import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSoheeAutonomy } from '../use-sohee-autonomy'

vi.mock('../use-workspace-context', () => ({ useOptionalWorkspaceContext: () => null }))
const observedAt = '2026-10-25T10:00:00.000Z'
const state = (workspaceId = 'A', actualMode = 'PAUSED') => ({ workspaceId, desiredMode: 'RUNNING', actualMode, version: 2, activeActionRunCount: 0, killSwitchActive: false, updated_at: observedAt })
const response = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('ANI-1791 레거시 훅 actual 상태 SSOT', () => {
  it('desired RUNNING이어도 actual PAUSED는 실행 중으로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response(state())))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.actualMode).toBe('PAUSED')
  })
  it.each([undefined, 'INVALID'])('actualMode=%s는 RUNNING으로 추정하지 않는다', async actualMode => {
    vi.stubGlobal('fetch', vi.fn(() => response({ ...state(), actualMode })))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.actualMode).toBe('UNKNOWN')
  })
  it.each([null, -1, 'bad'])('작업 수 %s를 0건으로 지어내면서 가동을 표시하지 않는다', async count => {
    vi.stubGlobal('fetch', vi.fn(() => response({ ...state('A', 'RUNNING'), activeActionRunCount: count })))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.actualMode).toBe('UNKNOWN')
    expect(result.current.isRunning).toBe(false)
  })
  it('확인 시각 없는 응답은 실제 관측값으로 승격하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response({ ...state('A', 'RUNNING'), updated_at: undefined })))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.actualMode).toBe('UNKNOWN')
  })
  it('타 가게 응답은 숨기고 A 가게 상태로 세탁하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response(state('B', 'RUNNING'))))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.actualMode).toBe('UNKNOWN')
  })
  it('localStorage/custom event 값은 상태를 뒤집지 못하고 서버 재조회만 유발한다', async () => {
    const fetcher = vi.fn(() => response(state()))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('sohee:autonomy_change', { detail: { isRunning: true, workspaceId: 'B' } }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'sohee_agent_autonomy_state_v1', newValue: 'true' }))
    })
    expect(result.current.isRunning).toBe(false)
    expect(result.current.actualMode).toBe('PAUSED')
  })
  it('변경 POST를 보내도 pending 중 실행 중으로 먼저 표시하지 않는다', async () => {
    const pending = deferred<unknown>()
    vi.stubGlobal('fetch', vi.fn((_url, init) => init?.method === 'POST' ? pending.promise : response(state())))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let operation!: Promise<unknown>
    act(() => { operation = result.current.setAutonomy(true) })
    expect(result.current.isRunning).toBe(false)
    expect(result.current.isLoading).toBe(true)
    await act(async () => { pending.resolve(await response(state('A', 'RUNNING'))); await operation })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.actualMode).toBe('PAUSED')
  })
  it('workspace 전환 첫 paint에서 이전 RUNNING을 숨긴다', async () => {
    const pending = deferred<unknown>()
    vi.stubGlobal('fetch', vi.fn(url => String(url).includes('/A/') ? response(state('A', 'RUNNING')) : pending.promise))
    const { result, rerender } = renderHook(({ ws }) => useSoheeAutonomy(ws), { initialProps: { ws: 'A' } })
    await waitFor(() => expect(result.current.isRunning).toBe(true))
    rerender({ ws: 'B' })
    expect(result.current.isRunning).toBe(false)
    expect(result.current.actualMode).toBe('UNKNOWN')
    await act(async () => pending.resolve(await response(state('B', 'PAUSED'))))
  })
  it('응답이 영원히 오지 않아도 8초 뒤 확인 불가로 닫는다', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
      const { result, unmount } = renderHook(() => useSoheeAutonomy('A'))
      await act(async () => { await vi.advanceTimersByTimeAsync(8001) })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.actualMode).toBe('UNKNOWN')
      unmount()
    } finally { vi.useRealTimers() }
  })
  it('네트워크 실패 시 이전 RUNNING을 현재 정상으로 주장하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useSoheeAutonomy('A'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.actualMode).toBe('UNKNOWN')
    expect(result.current.isRunning).toBe(false)
  })
})
