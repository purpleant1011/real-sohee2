// @vitest-environment jsdom
import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanonicalCustomerHistory } from './use-canonical-customer-history'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WORKSPACE_ID = 'ws-test-123'
const CUSTOMER_UUID = 'c-uuid-456'

describe('useCanonicalCustomerHistory', () => {
  it('성공 시 outbox 발송내역 목록을 반환하고 load=ready 상태가 된다', async () => {
    const mockItems = [
      {
        id: 'outbox-1',
        reservationId: 'res-1',
        event: 'BOOKING_CONFIRMED',
        eventLabel: '예약 확정 안내',
        status: 'DELIVERED',
        statusLabel: '도착 확인',
        detailLabel: null,
        dueAt: '2026-11-09T05:00:00Z',
        updatedAt: '2026-11-09T05:01:00Z',
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
      useCanonicalCustomerHistory({
        workspaceId: WORKSPACE_ID,
        customerUuid: CUSTOMER_UUID,
      }),
    )

    expect(result.current.load).toBe('loading')

    await waitFor(() => {
      expect(result.current.load).toBe('ready')
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].eventLabel).toBe('예약 확정 안내')
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WORKSPACE_ID}/kakao/outbox?customerUuid=${CUSTOMER_UUID}&limit=50`,
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('API 실패 시(500) 빈 목록으로 바꾸지 않고 load=error 가 된다', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useCanonicalCustomerHistory({
        workspaceId: WORKSPACE_ID,
        customerUuid: CUSTOMER_UUID,
      }),
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
      useCanonicalCustomerHistory({
        workspaceId: WORKSPACE_ID,
        customerUuid: CUSTOMER_UUID,
      }),
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

  it('workspaceId 나 customerUuid 가 없으면 fetch 하지 않는다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() =>
      useCanonicalCustomerHistory({
        workspaceId: '',
        customerUuid: '',
      }),
    )

    expect(result.current.load).toBe('loading')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
