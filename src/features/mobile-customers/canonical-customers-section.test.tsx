// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanonicalCustomersSection, formatBookingTime } from './canonical-customers-section'

afterEach(() => {
  vi.unstubAllGlobals()
})

const WORKSPACE_ID = 'ws-test-123'

describe('formatBookingTime', () => {
  it('KST 기준으로 한국어 일시를 반환한다', () => {
    // 2026-11-09T05:00:00Z -> KST 2026-11-09 14:00
    const formatted = formatBookingTime('2026-11-09T05:00:00Z')
    expect(formatted).toBe('2026년 11월 9일 14:00')
  })

  it('잘못된 형식이거나 null이면 빈 문자열을 반환한다', () => {
    expect(formatBookingTime(null)).toBe('')
    expect(formatBookingTime('invalid-date')).toBe('')
    expect(formatBookingTime('')).toBe('')
  })
})

describe('CanonicalCustomersSection', () => {
  it('로딩 중일 때 로딩 상태를 표시한다', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<CanonicalCustomersSection workspaceId={WORKSPACE_ID} />)

    expect(screen.getByText('예약 고객 목록을 불러오는 중이에요...')).toBeVisible()
  })

  it('조회 실패 시 오류 메시지와 다시 시도 버튼을 표시하고 빈 목록으로 취급하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })))
    render(<CanonicalCustomersSection workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('예약 고객을 불러오지 못했어요')).toBeVisible()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible()
    expect(screen.queryByText('아직 등록된 예약 고객이 없어요')).toBeNull()
  })

  it('성공 시 고객 이름, 마스킹 번호, 예약 건수, 마지막 예약 일시를 표시하고 링크를 연결한다', async () => {
    const items = [
      {
        id: 'c-uuid-1',
        displayName: '홍길동',
        phoneMasked: '010-****-4855',
        reservationCount: 3,
        lastBookingStartsAt: '2026-11-09T05:00:00Z',
      },
    ]
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, items }), { status: 200 }),
    ))

    render(<CanonicalCustomersSection workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('홍길동')).toBeVisible()
    expect(screen.getByText('010-****-4855')).toBeVisible()
    expect(screen.getByText('예약 3건')).toBeVisible()
    expect(screen.getByText(/2026년 11월 9일 14:00/)).toBeVisible()

    const link = screen.getByRole('link', { name: /자세히 보기|홍길동/i })
    expect(link.getAttribute('href')).toBe('/app/customers/person/c-uuid-1')
  })

  it('고객 목록이 비어있을 때 빈 상태 메시지를 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 }),
    ))

    render(<CanonicalCustomersSection workspaceId={WORKSPACE_ID} />)

    expect(await screen.findByText('아직 등록된 예약 고객이 없어요')).toBeVisible()
    expect(screen.queryByText('예약 고객을 불러오지 못했어요')).toBeNull()
  })

  it('canonicalState props 를 넘기면 중복 fetch 없이 해당 상태를 즉시 렌더한다', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const items = [
      {
        id: 'c-uuid-props',
        displayName: '이영희',
        phoneMasked: '010-****-9999',
        reservationCount: 1,
        lastBookingStartsAt: '2026-11-09T05:00:00Z',
      },
    ]

    render(
      <CanonicalCustomersSection
        workspaceId={WORKSPACE_ID}
        canonicalState={{ load: 'ready', items, refresh: vi.fn() }}
      />,
    )

    expect(screen.getByText('이영희')).toBeVisible()
    expect(screen.getByText('010-****-9999')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hideWhenEmpty 가 true 이고 목록이 비어 있으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(
      <CanonicalCustomersSection
        workspaceId={WORKSPACE_ID}
        canonicalState={{ load: 'ready', items: [], refresh: vi.fn() }}
        hideWhenEmpty
      />,
    )

    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('예약 고객')).toBeNull()
    expect(screen.queryByText('아직 등록된 예약 고객이 없어요')).toBeNull()
  })
})
