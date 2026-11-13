import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CustomersPage from './customers-view'
const WS = '11111111-1111-4111-8111-111111111111'
const THREAD = '22222222-2222-4222-8222-222222222222'
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => '11111111-1111-4111-8111-111111111111' }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }))
vi.mock('@/components/agent-os/sohee-live-workboard', () => ({ SoheeLiveWorkboard: () => null }))
vi.mock('@/features/reporting/weekly-truth-summary', () => ({ WeeklyTruthSummary: () => null }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
beforeEach(() => {
  history.replaceState(null, '', '/app/customers')
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/customers/pipeline')
    ? Response.json({ datasetMode: 'ACTUAL', items: [{ id: THREAD, name: 'TEST 과거 문의', handle: '@synthetic', channel: 'instagram', channelLabel: '인스타 DM', channelColor: '', lastMessage: '지난 예약 문의', lastMessageTime: '482시간 전', urgency: 'high', bookingIntent: true, stage: 'inquiry', stageLabel: '상담 만료', stageColor: '', unread: false, dialogueHistory: [] }], reservations: [{ id: 'record', status: 'CONFIRMED' }] })
    : Response.json({ workspaceId: WS, cases: [] })))
})
it('replaces direct booking confirmation of an old DM with a read-only same-conversation handoff', async () => {
  render(<CustomersPage />)
  const link = await screen.findByRole('link', { name: '문의·예약 조건 검토' })
  expect(link).toHaveAttribute('href', `/app/engagement/${encodeURIComponent(`dm:${THREAD}`)}`)
  expect(screen.queryByRole('button', { name: /원클릭 예약 확정/ })).toBeNull()
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})
it('names the actual query denominator and never presents a reservation row as confirmed attendance', async () => {
  render(<CustomersPage />)
  expect(await screen.findByText('이번 조회 DM 대화')).toBeVisible()
  expect(screen.getByText(/전체 고객 수·최근 주간 성과와 다를 수 있어요/)).toBeVisible()
  expect(screen.queryByText('매장 방문 확정')).toBeNull()
  expect(screen.getByText('예약 원장 상태 기준 · 방문·결제는 별도 확인')).toBeVisible()
})

it('고객 0명이면 소통함 안내와 바로가기 버튼을 보여준다', async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/customers/pipeline')) {
      return Response.json({ datasetMode: 'ACTUAL', items: [], reservations: [] })
    }
    return Response.json({ workspaceId: WS, cases: [] })
  })
  render(<CustomersPage />)
  expect(await screen.findByText('문의 주신 손님은 소통함에서 볼 수 있어요')).toBeVisible()
  const link = screen.getByRole('link', { name: '소통함 열기' })
  expect(link).toHaveAttribute('href', '/app/engagement')
})

it('MasterDetail 구조로 고객 목록과 상세(기본 정보·최근 대화·예약 기록·메모)를 제공한다', async () => {
  render(<CustomersPage />)
  expect(await screen.findByRole('region', { name: '고객 목록' })).toBeVisible()
  expect(screen.getByRole('region', { name: '고객 상세' })).toBeVisible()
  expect(screen.getByPlaceholderText('손님 이름 또는 아이디 검색')).toBeVisible()
})

it('문의 전환율 카드의 안내 문구 "확인 근거 필요"에 font-mono text-2xl을 적용하지 않는다', async () => {
  render(<CustomersPage />)
  const text = await screen.findByText('확인 근거 필요')
  expect(text.className).not.toContain('text-2xl')
  expect(text.className).not.toContain('font-mono')
  expect(text.className).toContain('text-lg')
})

it('고객 목록 카드는 키보드로 탐색할 수 있도록 role="button"과 tabIndex=0을 갖는다', async () => {
  render(<CustomersPage />)
  const customerCard = await screen.findByRole('button', { name: /TEST 과거 문의/ })
  expect(customerCard).toBeInTheDocument()
  expect(customerCard).toHaveAttribute('tabIndex', '0')
})

it('답변 입력창에 aria-label이 지정되어 스크린리더 접근성을 보장한다', async () => {
  render(<CustomersPage />)
  const input = await screen.findByRole('textbox', { name: '고객 답변 메시지 입력' })
  expect(input).toBeInTheDocument()
})

it('존재하지 않는 손님 ID로 진입 시 빈 화면 대신 안내 카드와 목록 복귀 링크를 렌더링한다', async () => {
  render(<CustomersPage initialCustomerId="unknown-id-123" />)
  expect(await screen.findByText('손님 정보를 찾을 수 없어요')).toBeVisible()
  const returnLink = screen.getByRole('link', { name: '고객 목록으로 돌아가기' })
  expect(returnLink).toHaveAttribute('href', '/app/customers')
})

it('고객 상세 영역에 "카카오 안내 발송내역" 섹션을 렌더링한다', async () => {
  render(<CustomersPage />)
  expect(await screen.findByText('카카오 안내 발송내역 (최근 예약)')).toBeVisible()
})

it('예약 원장 표에 "알림톡" 열이 존재하고 카카오 발송내역 배지 또는 "-"을 렌더링한다', async () => {
  render(<CustomersPage />)
  const toggleBtn = await screen.findByRole('button', { name: /고객 성과 상세 분석 & 예약금 원장 장부 보기/ })
  fireEvent.click(toggleBtn)

  expect(await screen.findByRole('columnheader', { name: '알림톡' })).toBeInTheDocument()
  const ledgerTable = screen.getByRole('table')
  expect(ledgerTable).toBeInTheDocument()
  const cells = screen.getAllByText('-')
  expect(cells.length).toBeGreaterThanOrEqual(1)
})

it('예약 원장에 발송내역이 있는 경우 해당 예약의 최신 알림톡 배지를 렌더링한다', async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/customers/pipeline')) {
      return Response.json({
        datasetMode: 'ACTUAL',
        items: [{ id: THREAD, name: 'TEST 고객', handle: '@test', channel: 'instagram', channelLabel: '인스타 DM', channelColor: '', lastMessage: '문의', lastMessageTime: '1시간 전', urgency: 'high', bookingIntent: true, stage: 'inquiry', stageLabel: '상담', stageColor: '', unread: false, dialogueHistory: [] }],
        reservations: [{ id: 'record-1', customer_name: 'TEST 고객', customer_phone: '010-1234-5678', channel_source: 'instagram', status: 'CONFIRMED' }],
      })
    }
    if (url.includes('/kakao/outbox')) {
      return Response.json({
        ok: true,
        items: [
          {
            id: 'job-1',
            reservationId: 'record-1',
            event: 'BOOKING_CONFIRMED',
            eventLabel: '예약 확정 안내',
            status: 'DELIVERED',
            statusLabel: '도착 확인',
            detailLabel: null,
            dueAt: '2026-11-09T05:00:00.000Z',
            updatedAt: '2026-11-09T05:00:00.000Z',
          },
        ],
      })
    }
    return Response.json({ workspaceId: WS, cases: [] })
  })

  render(<CustomersPage />)
  const toggleBtn = await screen.findByRole('button', { name: /고객 성과 상세 분석 & 예약금 원장 장부 보기/ })
  fireEvent.click(toggleBtn)

  const badges = await screen.findAllByText('도착 확인')
  expect(badges.length).toBeGreaterThanOrEqual(1)
})

it('예약 원장 표에서 CONFIRMED 상태인 행에는 변경·취소 버튼이 표시되고, 취소된 행(CANCELLED)에는 표시되지 않는다', async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/customers/pipeline')) {
      return Response.json({
        datasetMode: 'ACTUAL',
        items: [{ id: THREAD, name: 'TEST 고객', handle: '@test', channel: 'instagram', channelLabel: '인스타 DM', channelColor: '', lastMessage: '문의', lastMessageTime: '1시간 전', urgency: 'high', bookingIntent: true, stage: 'inquiry', stageLabel: '상담', stageColor: '', unread: false, dialogueHistory: [] }],
        reservations: [
          { id: 'res-confirmed', customer_name: '확정 고객', customer_phone: '010-1111-2222', channel_source: 'instagram', status: 'CONFIRMED' },
          { id: 'res-cancelled', customer_name: '취소 고객', customer_phone: '010-3333-4444', channel_source: 'instagram', status: 'CANCELLED' },
        ],
      })
    }
    return Response.json({ workspaceId: WS, cases: [] })
  })

  render(<CustomersPage />)
  const toggleBtn = await screen.findByRole('button', { name: /고객 성과 상세 분석 & 예약금 원장 장부 보기/ })
  fireEvent.click(toggleBtn)

  // 확정 고객 행에는 변경/취소 버튼이 존재
  const confirmedRow = document.getElementById('reservation-res-confirmed')
  expect(confirmedRow).not.toBeNull()
  expect(confirmedRow?.querySelector('button[data-action="reschedule"]')).toBeInTheDocument()
  expect(confirmedRow?.querySelector('button[data-action="cancel"]')).toBeInTheDocument()

  // 취소된 고객 행에는 변경/취소 버튼이 없음
  const cancelledRow = document.getElementById('reservation-res-cancelled')
  expect(cancelledRow).not.toBeNull()
  expect(cancelledRow?.querySelector('button[data-action="reschedule"]')).toBeNull()
  expect(cancelledRow?.querySelector('button[data-action="cancel"]')).toBeNull()
})

it('선택된 고객 상세 상단에 44px "고객 목록으로 돌아가기" 버튼이 있고 클릭 시 선택을 해제한다', async () => {
  render(<CustomersPage initialCustomerId={THREAD} />)

  const backButton = await screen.findByRole('button', { name: '고객 목록으로 돌아가기' })
  expect(backButton).toBeInTheDocument()
  expect(backButton.className).toMatch(/min-h-(?:11|\[44px\])/)

  const customerCard = screen.getByRole('button', { name: /TEST 과거 문의/ })
  expect(customerCard).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(backButton)

  expect(customerCard).toHaveAttribute('aria-pressed', 'false')
})

it('예약 원장의 "취소" 버튼 클릭 시 다이얼로그가 열리고 취소 완료 후 목록이 새로고침된다', async () => {
  let pipelineFetchCount = 0
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/customers/pipeline')) {
      pipelineFetchCount++
      return Response.json({
        datasetMode: 'ACTUAL',
        items: [{ id: THREAD, name: 'TEST 고객', handle: '@test', channel: 'instagram', channelLabel: '인스타 DM', channelColor: '', lastMessage: '문의', lastMessageTime: '1시간 전', urgency: 'high', bookingIntent: true, stage: 'inquiry', stageLabel: '상담', stageColor: '', unread: false, dialogueHistory: [] }],
        reservations: [
          { id: 'res-confirmed', customer_name: '확정 고객', customer_phone: '010-1111-2222', channel_source: 'instagram', status: 'CONFIRMED' },
        ],
      })
    }
    if (url.includes('/reservations/res-confirmed') && init?.method === 'PATCH') {
      return Response.json({ ok: true, status: 'cancelled', reservationId: 'res-confirmed' })
    }
    return Response.json({ workspaceId: WS, cases: [] })
  })

  render(<CustomersPage />)
  const toggleBtn = await screen.findByRole('button', { name: /고객 성과 상세 분석 & 예약금 원장 장부 보기/ })
  fireEvent.click(toggleBtn)

  const confirmedRow = document.getElementById('reservation-res-confirmed')
  const cancelBtn = confirmedRow?.querySelector('button[data-action="cancel"]') as HTMLButtonElement
  expect(cancelBtn).not.toBeNull()
  fireEvent.click(cancelBtn)

  // 다이얼로그 열림
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('예약 취소')).toBeInTheDocument()

  // 사유 입력 후 제출
  const reasonTextarea = screen.getByLabelText(/취소 사유/i)
  fireEvent.change(reasonTextarea, { target: { value: '고객 사정으로 취소' } })

  const initialFetchCount = pipelineFetchCount
  const confirmBtn = screen.getByRole('button', { name: '예약 취소 확인' })
  fireEvent.click(confirmBtn)

  // 취소 완료 후 fetchPipeline 재호출 확인
  await screen.findByRole('button', { name: /고객 성과 상세 분석 & 예약금 원장 장부 보기/ })
  expect(pipelineFetchCount).toBeGreaterThan(initialFetchCount)
})

it('예약 고객(번호 기준) 섹션이 화면에 렌더링된다', async () => {
  render(<CustomersPage />)
  expect(await screen.findByRole('region', { name: '예약 고객(번호 기준)' })).toBeInTheDocument()
  expect(screen.getByText('예약 고객(번호 기준)')).toBeInTheDocument()
})

it('대화가 0건이어도 예약 고객(번호 기준) 패널과 인스타그램 문의 손님 빈 안내가 함께 보인다', async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/customers/pipeline')) {
      return Response.json({ datasetMode: 'ACTUAL', items: [], reservations: [] })
    }
    if (url.includes('/customers/canonical')) {
      return Response.json({
        ok: true,
        items: [
          {
            id: 'cust-uuid-1',
            displayName: '홍길동',
            phoneMasked: '010-****-4855',
            reservationCount: 1,
            lastBookingStartsAt: '2026-11-10T05:00:00.000Z',
          },
        ],
      })
    }
    return Response.json({ workspaceId: WS, cases: [] })
  })

  render(<CustomersPage />)

  // 1. 인스타그램 문의 손님 영역에 빈 안내 유지 확인
  expect(await screen.findByText('인스타그램 문의 손님')).toBeVisible()
  expect(screen.getByText('문의 주신 손님은 소통함에서 볼 수 있어요')).toBeVisible()
  expect(screen.getByRole('link', { name: '소통함 열기' })).toBeVisible()

  // 2. 대화 0건이어도 예약 고객(번호 기준) 패널 렌더 및 고객 표시 확인
  expect(await screen.findByRole('region', { name: '예약 고객(번호 기준)' })).toBeVisible()
  expect(await screen.findByText('홍길동')).toBeVisible()
  expect(screen.getByText('010-****-4855')).toBeVisible()
})

it('대화가 0건이어도 예약 원장 장부 보기 토글 버튼이 노출되고 펼치면 예약 목록을 확인할 수 있다', async () => {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/customers/pipeline')) {
      return Response.json({
        datasetMode: 'ACTUAL',
        items: [],
        reservations: [
          {
            id: 'res-only-1',
            customer_name: '예약전용손님',
            customer_phone: '010-9999-8888',
            channel_source: 'naver',
            status: 'CONFIRMED',
          },
        ],
      })
    }
    if (url.includes('/customers/canonical')) {
      return Response.json({ ok: true, items: [] })
    }
    return Response.json({ workspaceId: WS, cases: [] })
  })

  render(<CustomersPage />)

  // 대화 빈 안내 노출
  expect(await screen.findByText('인스타그램 문의 손님')).toBeVisible()

  // 장부 보기 토글 버튼 노출 및 클릭 시 예약 원장 표시
  const toggleBtn = await screen.findByRole('button', { name: /고객 성과 상세 분석 & 예약금 원장 장부 보기/ })
  expect(toggleBtn).toBeInTheDocument()
  fireEvent.click(toggleBtn)

  expect(await screen.findByText('고객 예약 기록 (1건)')).toBeVisible()
  expect(screen.getByText('예약전용손님')).toBeVisible()
  expect(screen.getByText('010-9999-8888')).toBeVisible()
})







