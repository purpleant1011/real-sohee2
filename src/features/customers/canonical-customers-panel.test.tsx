import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CanonicalCustomersPanel } from './canonical-customers-panel'
import type { CanonicalCustomerItem } from './canonical-contract'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'

describe('CanonicalCustomersPanel', () => {
  const workspaceId = 'ws-test-123'

  const mockCustomers: CanonicalCustomerItem[] = [
    {
      id: 'cust-uuid-1',
      displayName: '홍길동',
      phoneMasked: '010-****-4855',
      reservationCount: 3,
      lastBookingStartsAt: '2026-11-10T05:00:00.000Z',
    },
    {
      id: 'cust-uuid-2',
      displayName: '김영희',
      phoneMasked: '010-****-1234',
      reservationCount: 1,
      lastBookingStartsAt: null,
    },
  ]

  const mockKakaoHistory: KakaoHistoryItem[] = [
    {
      id: 'history-1',
      reservationId: 'res-1',
      event: 'BOOKING_CONFIRMED',
      eventLabel: '예약 확정 안내',
      status: 'DELIVERED',
      statusLabel: '도착 확인',
      detailLabel: null,
      dueAt: '2026-11-09T03:00:00.000Z',
      updatedAt: '2026-11-09T03:01:00.000Z',
    },
  ]

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('데이터 로딩 중에는 로딩 표시를 보여준다', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/불러오는 중/)).toBeInTheDocument()
  })

  it('API 오류 발생 시 "불러오지 못했어요"와 "다시 시도" 버튼을 보여주고 빈 목록으로 오도하지 않는다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    expect(screen.getByText(/불러오지 못했어요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /다시 시도/ })).toBeInTheDocument()
    expect(screen.queryByText(/번호가 있는 예약이 등록되면 여기에 모여요/)).not.toBeInTheDocument()
  })

  it('데이터가 비어있을 때는 "번호가 있는 예약이 등록되면 여기에 모여요" 빈 상태를 표시한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, items: [] }),
    } as Response)

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('번호가 있는 예약이 등록되면 여기에 모여요')).toBeInTheDocument()
    })
  })

  it('정본 고객 목록(이름, 마스킹 번호, 예약 n건, 마지막 예약 일시)을 올바르게 렌더링한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/workspaces/ws-test-123/customers/canonical')) {
        return {
          ok: true,
          json: async () => ({ ok: true, items: mockCustomers }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ok: true, items: [] }),
      } as Response
    })

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('홍길동')).toBeInTheDocument()
    })

    expect(screen.getByText('010-****-4855')).toBeInTheDocument()
    expect(screen.getByText(/3건/)).toBeInTheDocument()
    expect(screen.getByText('김영희')).toBeInTheDocument()
    expect(screen.getByText('010-****-1234')).toBeInTheDocument()
    expect(screen.getByText(/1건/)).toBeInTheDocument()
  })

  it('이름 검색(q) 입력 시 검색 파라미터를 포함해 fetch를 호출한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/workspaces/ws-test-123/customers/canonical')) {
        return {
          ok: true,
          json: async () => ({ ok: true, items: mockCustomers }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ok: true, items: [] }),
      } as Response
    })

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('홍길동')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/검색/)
    fireEvent.change(searchInput, { target: { value: '홍길동' } })

    await waitFor(() => {
      const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(calledUrls.some((u) => u.includes('q=%ED%99%8D%EA%B8%B8%EB%8F%99') || u.includes('q=홍길동'))).toBe(true)
    })
  })

  it('고객 항목을 클릭하면 우측/하단 상세 패널에 해당 고객의 customerUuid 기반 카카오 발송내역을 표시한다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/workspaces/ws-test-123/customers/canonical')) {
        return {
          ok: true,
          json: async () => ({ ok: true, items: mockCustomers }),
        } as Response
      }
      if (url.includes('/api/workspaces/ws-test-123/kakao/outbox?customerUuid=cust-uuid-1&limit=50')) {
        return {
          ok: true,
          json: async () => ({ ok: true, items: mockKakaoHistory }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ok: true, items: [] }),
      } as Response
    })

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('홍길동')).toBeInTheDocument()
    })

    // 홍길동 고객 클릭
    fireEvent.click(screen.getByText('홍길동'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/workspaces/ws-test-123/kakao/outbox?customerUuid=cust-uuid-1&limit=50'),
        expect.anything()
      )
      expect(screen.getByText('예약 확정 안내')).toBeInTheDocument()
      expect(screen.getByText('도착 확인')).toBeInTheDocument()
    })
  })

  it('발송내역 API 실패 시 발송내역 에러 알림과 다시 시도 버튼을 노출한다', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/workspaces/ws-test-123/customers/canonical')) {
        return {
          ok: true,
          json: async () => ({ ok: true, items: mockCustomers }),
        } as Response
      }
      if (url.includes('/api/workspaces/ws-test-123/kakao/outbox')) {
        return {
          ok: false,
          status: 500,
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ ok: true, items: [] }),
      } as Response
    })

    render(<CanonicalCustomersPanel workspaceId={workspaceId} />)

    await waitFor(() => {
      expect(screen.getByText('홍길동')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('홍길동'))

    await waitFor(() => {
      expect(screen.getByText('발송내역을 불러오지 못했어요')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    })
  })
})
