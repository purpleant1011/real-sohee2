// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanonicalCustomerDetailView } from './canonical-customer-detail-view'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WORKSPACE_ID = 'ws-test-123'
const CUSTOMER_UUID = 'c-uuid-1'

describe('CanonicalCustomerDetailView', () => {
  it('고객 정보와 알림톡 발송내역을 정상적으로 렌더링한다', async () => {
    const canonicalCustomer = {
      id: CUSTOMER_UUID,
      displayName: '홍길동',
      phoneMasked: '010-****-4855',
      reservationCount: 2,
      lastBookingStartsAt: '2026-11-09T05:00:00Z',
    }
    const historyItems = [
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

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/customers/canonical')) {
        return new Response(JSON.stringify({ ok: true, items: [canonicalCustomer] }), { status: 200 })
      }
      if (url.includes('/kakao/outbox')) {
        return new Response(JSON.stringify({ ok: true, items: historyItems }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }))

    render(
      <CanonicalCustomerDetailView
        workspaceId={WORKSPACE_ID}
        customerUuid={CUSTOMER_UUID}
      />,
    )

    expect(await screen.findByText('홍길동')).toBeVisible()
    expect(screen.getByText('010-****-4855')).toBeVisible()
    expect(screen.getByText(/예약 2건/)).toBeVisible()

    // 발송내역 확인
    expect(await screen.findByText('예약 확정 안내')).toBeVisible()
    expect(screen.getByText('도착 확인')).toBeVisible()
  })

  it('알림톡 발송내역 로딩 중일 때 로딩 텍스트를 표시한다', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    render(
      <CanonicalCustomerDetailView
        workspaceId={WORKSPACE_ID}
        customerUuid={CUSTOMER_UUID}
      />,
    )

    expect(screen.getByText('발송내역을 불러오는 중이에요...')).toBeVisible()
  })

  it('알림톡 발송내역 조회 실패 시 "발송내역을 불러오지 못했어요"와 다시 시도 버튼을 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/customers/canonical')) {
        return new Response(
          JSON.stringify({
            ok: true,
            items: [
              {
                id: CUSTOMER_UUID,
                displayName: '홍길동',
                phoneMasked: '010-****-4855',
                reservationCount: 1,
                lastBookingStartsAt: null,
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('error', { status: 500 })
    }))

    render(
      <CanonicalCustomerDetailView
        workspaceId={WORKSPACE_ID}
        customerUuid={CUSTOMER_UUID}
      />,
    )

    expect(await screen.findByText('발송내역을 불러오지 못했어요')).toBeVisible()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible()
    expect(screen.queryByText('아직 보낸 안내가 없어요')).toBeNull()
  })

  it('알림톡 발송내역이 비어있을 때 "아직 보낸 안내가 없어요"를 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/customers/canonical')) {
        return new Response(
          JSON.stringify({
            ok: true,
            items: [
              {
                id: CUSTOMER_UUID,
                displayName: '홍길동',
                phoneMasked: '010-****-4855',
                reservationCount: 0,
                lastBookingStartsAt: null,
              },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 })
    }))

    render(
      <CanonicalCustomerDetailView
        workspaceId={WORKSPACE_ID}
        customerUuid={CUSTOMER_UUID}
      />,
    )

    expect(await screen.findByText('아직 보낸 안내가 없어요')).toBeVisible()
    expect(screen.queryByText('발송내역을 불러오지 못했어요')).toBeNull()
  })
})
