// @vitest-environment jsdom
import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanonicalCustomers } from './use-canonical-customers'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WORKSPACE_ID = 'ws-test-123'

describe('useCanonicalCustomers', () => {
  it('성공 시 정본 고객 목록을 반환하고 load=ready 상태가 된다', async () => {
    const mockItems = [
      {
        id: 'c-uuid-1',
        displayName: '홍길동',
        phoneMasked: '010-****-4855',
        reservationCount: 3,
        lastBookingStartsAt: '2026-11-09T14:00:00+09:00',
      },
    ]

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, items: mockItems }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useCanonicalCustomers({ workspaceId: WORKSPACE_ID }),
    )

    expect(result.current.load).toBe('loading')

    await waitFor(() => {
      expect(result.current.load).toBe('ready')
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].displayName).toBe('홍길동')
    expect(result.current.items[0].phoneMasked).toBe('010-****-4855')
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WORKSPACE_ID}/customers/canonical?limit=50`,
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('API 실패 시(500) 빈 목록으로 바꾸지 않고 load=error 가 된다', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useCanonicalCustomers({ workspaceId: WORKSPACE_ID }),
    )

    await waitFor(() => {
      expect(result.current.load).toBe('error')
    })

    expect(result.current.items).toEqual([])
  })

  it('refresh 호출 시 다시 로딩하고 fetch를 재실행한다', async () => {
    let callCount = 0
    const fetchMock = vi.fn(async () => {
      callCount += 1
      return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useCanonicalCustomers({ workspaceId: WORKSPACE_ID }),
    )

    await waitFor(() => {
      expect(result.current.load).toBe('ready')
    })

    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(callCount).toBe(2)
    })
  })

  it('15초 동안 응답이 없으면 load=error 가 된다', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useCanonicalCustomers({ workspaceId: WORKSPACE_ID }),
    )

    expect(result.current.load).toBe('loading')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(result.current.load).toBe('error')
    vi.useRealTimers()
  })

  it('언마운트 시 조회를 취소하고 타이머를 정리한다', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal as AbortSignal)
      return new Promise(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() =>
      useCanonicalCustomers({ workspaceId: WORKSPACE_ID }),
    )

    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0].aborted).toBe(false)

    await act(async () => {
      unmount()
    })

    expect(signals[0].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
