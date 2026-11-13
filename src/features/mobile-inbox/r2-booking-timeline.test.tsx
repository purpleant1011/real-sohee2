vi.mock('@/features/pwa/network', async original => ({ ...await original<typeof import('@/features/pwa/network')>(), probeConnectivity: async () => true }))
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/inbox/c1',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))
import { R2BookingTimeline } from './r2-booking-timeline'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const CASE_ID = '11111111-1111-4111-8111-111111111111'
const THREAD_ID = '22222222-2222-4222-8222-222222222222'
const CASE_URL = `/api/workspaces/${WORKSPACE_ID}/booking-recovery/cases/${CASE_ID}`
const THREAD_URL = `/api/workspaces/${WORKSPACE_ID}/mobile-inbox/${encodeURIComponent(`dm:${THREAD_ID}`)}`

function caseView(overrides: Record<string, unknown> = {}) {
  return {
    case: {
      caseId: CASE_ID,
      missionId: '33333333-3333-4333-8333-333333333333',
      version: 2,
      stage: 'AWAITING_SEND_APPROVAL',
      statusLabel: '답변 전송 승인 대기',
      sourceThreadId: THREAD_ID,
      sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
      observedAt: '2026-10-23T05:00:00.000Z',
      reply: { text: '금요일 3시 어떠세요?', fingerprint: 'a'.repeat(64) },
      offer: null,
      acceptance: null,
      approval: { kind: 'send', fingerprint: 'a'.repeat(64) },
      proposal: {
        revision: 1,
        serviceId: 'svc-1',
        serviceName: '속눈썹펌',
        totalAmountKrw: 80000,
        depositKrw: 0,
        slotId: 'slot-1',
        startsAt: '2026-10-24T06:00:00.000Z',
        endsAt: '2026-10-24T07:00:00.000Z',
      },
      booking: null,
      nextAction: 'approve_send',
      revenue: { status: 'NOT_OBSERVED', amountKrw: null },
      ...overrides,
    },
  }
}

function threadDetail(overrides: Record<string, unknown> = {}) {
  return {
    thread: {
      id: `dm:${THREAD_ID}`,
      workspaceId: WORKSPACE_ID,
      channel: 'instagram_dm',
      customerName: '김민지',
      consent: 'granted',
      status: 'draft_ready',
      unread: true,
      lastMessage: { text: '이번 주 금요일 자리 있어요?', receivedAt: '2026-10-23T04:00:00.000Z', fromCustomer: true },
      draft: { text: '금요일 3시 어떠세요?', sources: ['예약표'] },
      sendBlockers: [],
    },
    messages: [
      { id: 'm1', fromCustomer: true, text: '안녕하세요', at: '2026-10-23T03:00:00.000Z' },
      { id: 'm2', fromCustomer: true, text: '이번 주 금요일 자리 있어요?', at: '2026-10-23T04:00:00.000Z' },
    ],
    targetLabel: '인스타그램 DM → 김민지',
    fingerprint: 'a'.repeat(64),
    version: 1,
    delivery: 'none',
    ...overrides,
  }
}

function routeFetch(handlers: { case?: () => Response; thread?: () => Response } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === CASE_URL) return handlers.case?.() ?? new Response(JSON.stringify(caseView()), { status: 200 })
    if (url === THREAD_URL) return handlers.thread?.() ?? new Response(JSON.stringify(threadDetail()), { status: 200 })
    return new Response('{}', { status: 500 })
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // 픽스처의 관측 시각을 '방금'으로 고정한다. 실제 시계에 따라 stale 칩이 붙으면 테스트가 흔들린다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-23T05:05:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

/** 조회가 끝나지 않은 상태를 만들기 위한 응답 지연. */
function pending(): Promise<Response> {
  return new Promise<Response>(() => {})
}

it('PC 호스트에서도 같은 케이스·대화를 읽으며 화면 열기만으로 명령을 실행하지 않는다', async () => {
  const mock = routeFetch()
  vi.stubGlobal('fetch', mock)
  const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} embedded />)
  expect(await screen.findByText('김민지')).toBeVisible()
  expect(container.querySelector('[data-mobile-shell]')).toBeNull()
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

it('회수 케이스와 대화 원문을 캐시 없이 기존 읽기 API 로만 조회한다', async () => {
  const fetchMock = routeFetch()
  vi.stubGlobal('fetch', fetchMock)
  render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

  expect(await screen.findByText('김민지')).toBeVisible()
  expect(fetchMock).toHaveBeenCalledWith(CASE_URL, expect.objectContaining({ cache: 'no-store' }))
  expect(fetchMock).toHaveBeenCalledWith(THREAD_URL, expect.objectContaining({ cache: 'no-store' }))
})

it('고객 원문과 다음 할 일을 보여주고 지문은 노출하지 않는다', async () => {
  vi.stubGlobal('fetch', routeFetch())
  const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

  expect(await screen.findByText('이번 주 금요일 자리 있어요?')).toBeVisible()
  expect(screen.getByText(/다음 할 일 · 보낼 답변 검토하기/)).toBeVisible()
  expect(container.textContent).not.toContain('a'.repeat(64))
})

it('대화 조회가 실패해도 단계는 보여주되 이름·원문을 지어내지 않는다', async () => {
  vi.stubGlobal(
    'fetch',
    routeFetch({ thread: () => new Response('{}', { status: 500 }) }),
  )
  const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

  expect(await screen.findByText('예약 문의')).toBeVisible()
  expect(container.textContent).toContain('고객 이름과 원문은 대화에서 확인하지 못했어요.')
  expect(container.textContent).toContain('속눈썹펌')
})

it('케이스가 없으면 빈 목록이 아니라 확인된 빈 상태로 보여준다', async () => {
  vi.stubGlobal(
    'fetch',
    routeFetch({ case: () => new Response(JSON.stringify({ error: '없음' }), { status: 404 }) }),
  )
  render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

  expect(await screen.findByText('예약 문의를 찾지 못했어요')).toBeVisible()
})

it('권한·기능 게이트(403)는 조회 실패와 구분한다', async () => {
  vi.stubGlobal(
    'fetch',
    routeFetch({ case: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) }),
  )
  const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

  expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
  expect(container.textContent).not.toContain('다시 확인하기')
})

it('계약과 어긋난 응답은 빈 화면이 아니라 오류로 다룬다', async () => {
  vi.stubGlobal(
    'fetch',
    routeFetch({ case: () => new Response(JSON.stringify({ case: { caseId: 'other' } }), { status: 200 }) }),
  )
  render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

  expect(await screen.findByText('다시 확인하기')).toBeVisible()
})

describe('5상태 칩 — 실제 데이터가 없을 때 정직하게 표시한다', () => {
  it('조회 중에는 확인하는 중 칩을 보여 준다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => pending()))
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(container.querySelector('[data-state-chip="loading"]')).not.toBeNull()
  })

  it('조회 실패에는 확인 실패 칩과 다시 확인 행동을 함께 보여 준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('다시 확인하기')).toBeVisible()
    expect(container.querySelector('[data-state-chip="error"]')).not.toBeNull()
  })

  it('네트워크가 끊긴 실패는 확인 실패가 아니라 오프라인으로 알린다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      }),
    )
    vi.stubGlobal('navigator', { onLine: false })
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('다시 확인하기')).toBeVisible()
    expect(container.querySelector('[data-state-chip="offline"]')).not.toBeNull()
    expect(container.querySelector('[data-state-chip="error"]')).toBeNull()
  })

  it('빈 상태(404)에는 실패 칩을 붙이지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({ case: () => new Response(JSON.stringify({ error: '없음' }), { status: 404 }) }),
    )
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('예약 문의를 찾지 못했어요')).toBeVisible()
    expect(container.querySelector('[data-state-chip]')).toBeNull()
  })

  it('고객 정보를 확인하지 못하면 일부만 확인 칩을 붙인다', async () => {
    vi.stubGlobal('fetch', routeFetch({ thread: () => new Response('{}', { status: 500 }) }))
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('예약 문의')).toBeVisible()
    expect(container.querySelector('[data-state-chip="partial"]')?.textContent).toContain('고객 정보 일부만 확인')
  })

  it('전송 결과가 미확정인 단계는 성공으로 읽히지 않게 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        case: () =>
          new Response(
            JSON.stringify(caseView({ stage: 'RESULT_UNKNOWN', statusLabel: '전송 결과 미확인', nextAction: 'review' })),
            { status: 200 },
          ),
      }),
    )
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('김민지')).toBeVisible()
    expect(container.querySelector('[data-state-chip="partial"]')?.textContent).toContain('전송 결과 미확인')
    // 전송이 확인된 것처럼 '보냈어요' 같은 단정 문구를 쓰지 않는다.
    expect(container.textContent).not.toContain('보냈어요')
  })

  it('모두 확인된 타임라인에는 칩이 없고 서버 확인 시각만 남긴다', async () => {
    vi.stubGlobal('fetch', routeFetch())
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('김민지')).toBeVisible()
    expect(container.querySelector('[data-state-chip]')).toBeNull()
    expect(container.textContent).toContain('서버 확인')
  })
})

describe('고객 수락 타이밍 — 서버 확인 근거가 있을 때만 시각을 그린다', () => {
  const OFFER = {
    slotId: '55555555-5555-4555-8555-555555555555',
    serviceId: '66666666-6666-4666-8666-666666666666',
    serviceName: '속눈썹펌',
    startsAt: '2026-10-24T06:00:00.000Z',
    endsAt: '2026-10-24T07:00:00.000Z',
    timezone: 'Asia/Seoul',
    totalAmountKrw: 80000,
    depositKrw: 0,
    validUntil: '2026-10-24T05:00:00.000Z',
    proposalRevision: 1,
  }
  const ACCEPTANCE = {
    inboundMessageId: '77777777-7777-4777-8777-777777777777',
    receivedAt: '2026-10-23T05:00:00.000Z',
  }

  it('확인된 인바운드 메시지가 있으면 가게 시간대 기준 수락 시각을 보여 준다', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        case: () =>
          new Response(
            JSON.stringify(
              caseView({
                stage: 'CUSTOMER_ACCEPTED',
                statusLabel: '고객 수락 확인',
                offer: OFFER,
                acceptance: ACCEPTANCE,
                nextAction: 'approve_booking',
              }),
            ),
            { status: 200 },
          ),
      }),
    )
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    // 오전/오후 토큰 표기는 실행 환경 ICU 에 따라 달라진다(오후 ↔ PM). 날짜·시각·문구만 잠근다.
    expect(await screen.findByText(/10\. 23\..*2:00에 고객이 수락했어요/)).toBeVisible()
    // 근거 메시지 ID 는 화면에 노출하지 않는다.
    expect(container.textContent).not.toContain(ACCEPTANCE.inboundMessageId)
  })

  it('수락 근거가 없으면 수락 시각을 만들지 않고, 예약표 확정 전에는 확정 문구도 없다', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        case: () =>
          new Response(
            JSON.stringify(
              caseView({
                stage: 'CUSTOMER_ACCEPTED',
                statusLabel: '고객 수락 확인',
                offer: OFFER,
                acceptance: null,
                nextAction: 'approve_booking',
              }),
            ),
            { status: 200 },
          ),
      }),
    )
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('김민지')).toBeVisible()
    expect(container.textContent).not.toContain('고객이 수락했어요')
    expect(container.textContent).not.toContain('확정됐어요')
  })

  it('다음 행동은 한 번에 하나만 보여 준다(죽은 버튼 없음)', async () => {
    vi.stubGlobal('fetch', routeFetch())
    const { container } = render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)

    expect(await screen.findByText('김민지')).toBeVisible()
    expect(screen.getAllByText(/다음 할 일 · /)).toHaveLength(1)
    // 새 명령 포트에 실제 연결된 현재 단계의 승인만 열린다. 예약 확정은 앞당기지 않는다.
    expect(screen.queryByRole('button', { name: /보낼 답변 검토하기/ })).toBeNull()
    expect(screen.getByRole('button', { name: '답변 전송 승인' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '예약 확정 승인' })).toBeNull()
    expect(container.querySelectorAll('button[type="button"]:not([aria-label="뒤로"])')).toHaveLength(1)
  })
})

it('명령 응답의 가짜 완료를 믿지 않고 GET readback 단계만 표시한다', async () => {
  let sent = false
  const fetcher = vi.fn(async (input, init) => {
    if (init?.method === 'POST') { sent = true; return Response.json(caseView({ stage: 'BOOKING_CONFIRMED' })) }
    if (String(input) === CASE_URL) return Response.json(sent ? caseView({ stage: 'PROVIDER_ACCEPTED', statusLabel: '채널 접수 · 결과 확인 중', nextAction: null, approval: null, version: 3 }) : caseView())
    return Response.json(threadDetail())
  })
  vi.stubGlobal('fetch', fetcher)
  render(<R2BookingTimeline workspaceId={WORKSPACE_ID} caseId={CASE_ID} />)
  fireEvent.click(await screen.findByRole('button', { name: '답변 전송 승인' }))
  await waitFor(() => expect(screen.getAllByText('채널 접수 · 결과 확인 중').length).toBeGreaterThan(0))
  expect(screen.queryByText('예약 장부 등록 완료')).toBeNull()
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})
