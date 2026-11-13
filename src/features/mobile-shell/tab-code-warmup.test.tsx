import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTabCodePrewarmer, useR2TabCodeWarmup, warmR2TabCode } from './tab-code-warmup'
import type { TabId } from './types'

function loaders() {
  return {
    today: vi.fn(async () => ({})), work: vi.fn(async () => ({})),
    customers: vi.fn(async () => ({})), results: vi.fn(async () => ({})), more: vi.fn(async () => ({})),
  }
}

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('requestIdleCallback', undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('정적 R2 탭 코드만 준비', () => {
  it('생성 시 아무 것도 실행하지 않고 요청한 코드만 한 번 준비한다', async () => {
    const ports = loaders(), warm = createTabCodePrewarmer(ports)
    expect(ports.work).not.toHaveBeenCalled()
    const a = warm('work'), b = warm('work')
    expect(a).toBe(b)
    expect(await a).toBe(true)
    expect(ports.work).toHaveBeenCalledTimes(1)
    expect(ports.customers).not.toHaveBeenCalled()
    expect(await warm('work')).toBe(true)
    expect(ports.work).toHaveBeenCalledTimes(1)
  })
  it('실패는 화면 전환을 거절하지 않으며 다음 명시 요청에서 재시도할 수 있다', async () => {
    const ports = loaders()
    ports.results.mockRejectedValueOnce(new Error('static chunk unavailable'))
    const warm = createTabCodePrewarmer(ports)
    expect(await warm('results')).toBe(false)
    expect(await warm('results')).toBe(true)
    expect(ports.results).toHaveBeenCalledTimes(2)
  })
  it('실제 R2 코드 import는 API나 데이터 조회를 실행하지 않는다', async () => {
    const fetcher = vi.fn(() => { throw new Error('No data prefetch allowed') })
    vi.stubGlobal('fetch', fetcher)
    for (const tab of ['today', 'work', 'customers', 'results', 'more'] as const) {
      expect(await warmR2TabCode(tab)).toBe(true)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('유휴 코드 준비 스케줄', () => {
  it('인가된 탐색 화면에서 현재 탭을 제외하고 순서대로 준비한다', async () => {
    vi.useFakeTimers()
    const warm = vi.fn(async (tab: TabId) => Boolean(tab))
    renderHook(() => useR2TabCodeWarmup('workspace-a', 'today', warm))
    expect(warm).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_800) })
    expect(warm.mock.calls.map(call => call[0])).toEqual(['work', 'customers', 'results', 'more'])
  })
  it.each([
    { scope: null, navigator: { onLine: true } },
    { scope: 'workspace', navigator: { onLine: false } },
    { scope: 'workspace', navigator: { onLine: true, connection: { saveData: true } } },
    { scope: 'workspace', navigator: { onLine: true, connection: { effectiveType: '2g' } } },
  ])('무스코프·오프라인·절약 모드에서는 받지 않는다: %j', async ({ scope, navigator }) => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', navigator)
    const warm = vi.fn(async (tab: TabId) => Boolean(tab))
    renderHook(() => useR2TabCodeWarmup(scope, 'today', warm))
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(warm).not.toHaveBeenCalled()
  })
  it('앞 모듈이 끝나기 전에는 다음 모듈을 병렬로 받지 않는다', async () => {
    vi.useFakeTimers()
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>(resolve => { finish = resolve })
    const warm = vi.fn(() => pending)
    const view = renderHook(() => useR2TabCodeWarmup('workspace', 'today', warm))
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(warm).toHaveBeenCalledTimes(1)
    await act(async () => { finish(true); await vi.advanceTimersByTimeAsync(1_200) })
    expect(warm).toHaveBeenCalledTimes(2)
    view.unmount()
  })
  it('requestIdleCallback 예약도 취소하며 늦은 콜백이 실행돼도 받지 않는다', async () => {
    let run: IdleRequestCallback | undefined
    const request = vi.fn((callback: IdleRequestCallback) => { run = callback; return 41 })
    const cancel = vi.fn()
    vi.stubGlobal('requestIdleCallback', request)
    vi.stubGlobal('cancelIdleCallback', cancel)
    const warm = vi.fn(async (tab: TabId) => Boolean(tab))
    const view = renderHook(() => useR2TabCodeWarmup('workspace', 'today', warm))
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 })
    view.unmount()
    expect(cancel).toHaveBeenCalledWith(41)
    await act(async () => { run?.({ didTimeout: false, timeRemaining: () => 10 }) })
    expect(warm).not.toHaveBeenCalled()
  })
  it('언마운트하면 예약을 취소한다', async () => {
    vi.useFakeTimers()
    const warm = vi.fn(async (tab: TabId) => Boolean(tab))
    const view = renderHook(() => useR2TabCodeWarmup('workspace', 'today', warm))
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(warm).not.toHaveBeenCalled()
  })
})
