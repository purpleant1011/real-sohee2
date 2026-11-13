import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngagementDmView } from './engagement-dm-view'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import type { InstagramDmThreadsResponse } from './dm/types'
import type { RecoveryView } from '@/features/booking-recovery/contracts'

// 가드는 실제 연결 확인(probe)을 거친다. 이 테스트는 전송 흐름을 보는 것이므로
// 연결 확인은 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다.
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

const mockData: InstagramDmThreadsResponse = {
  items: [
    {
      id: 'th-1',
      workspace_id: 'ws-1',
      channel_connection_id: 'conn-1',
      channel: 'instagram',
      provider_thread_id: 'prov-th-1',
      customer_id: 'cust-1',
      customer_handle: 'active_cust',
      customer_name: '고객1',
      last_message_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
      status: 'NEEDS_REPLY',
      last_message_text: '내일 예약 가능한가요?',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      channel_label: 'Instagram',
      account_label: '@sohee_store',
      status_label: '답장 필요',
      countdown_text: '10시간 남음',
      is_expired: false,
      remaining_seconds: 36000,
      messages: [{ id: 'message-1', workspace_id: 'ws-1', thread_id: 'th-1', provider_message_id: 'provider-message-1', sender_type: 'customer', sender_id: 'cust-1', text: '내일 예약 가능한가요?', sent_at: '2026-10-28T00:00:00Z', created_at: '2026-10-28T00:00:00Z' }],
      draft: {
        id: 'dr-1',
        workspace_id: 'ws-1',
        thread_id: 'th-1',
        selected_option_id: 'opt_1',
        options: [
          { id: 'opt_1', label: '방문 및 예약 안내', draftText: '예약 안내드립니다.' },
        ],
        draft_text: '예약 안내드립니다.',
        approved_fingerprint: null,
        approved_by: null,
        approved_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    },
    {
      id: 'th-2',
      workspace_id: 'ws-1',
      channel_connection_id: 'conn-1',
      channel: 'instagram',
      provider_thread_id: 'prov-th-2',
      customer_id: 'cust-2',
      customer_handle: 'sent_cust',
      customer_name: '고객2',
      last_message_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      status: 'SENT',
      last_message_text: '감사합니다!',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      channel_label: 'Instagram',
      account_label: '@sohee_store',
      status_label: '완료',
      countdown_text: '5시간 남음',
      is_expired: false,
      remaining_seconds: 18000,
      draft: null,
    },
  ],
  send_enabled: true,
}

// 회수 카드가 그리는 최소 형태 — 답변 전송 승인 대기 건 하나.
const RECOVERY_VIEW: RecoveryView = {
  caseId: '11111111-1111-4111-8111-111111111111',
  missionId: '22222222-2222-4222-8222-222222222222',
  version: 3,
  stage: 'AWAITING_SEND_APPROVAL',
  statusLabel: '답변 전송 승인 대기',
  sourceThreadId: '33333333-3333-4333-8333-333333333333',
  sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
  observedAt: '2026-10-24T01:00:00.000Z',
  reply: { text: '예약 안내드립니다.', fingerprint: 'a'.repeat(64) },
  offer: {
    slotId: '55555555-5555-4555-8555-555555555555',
    serviceId: '66666666-6666-4666-8666-666666666666',
    serviceName: '컷',
    startsAt: '2026-10-25T05:00:00.000Z',
    endsAt: '2026-10-25T06:00:00.000Z',
    timezone: 'Asia/Seoul',
    totalAmountKrw: 50000,
    depositKrw: 10000,
    validUntil: '2026-10-24T12:00:00.000Z',
    proposalRevision: 1,
  },
  acceptance: null,
  approval: { kind: 'send', fingerprint: 'a'.repeat(64) },
  booking: null,
  nextAction: 'approve_send',
  revenue: { status: 'NOT_OBSERVED', amountKrw: null },
}

const originalFetch = global.fetch

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

describe('EngagementDmView UI Component', () => {
  beforeEach(() => {
    setOnLine(true)
    resetPageActionGuardForTests()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders filter tabs with counts and initial "답장 필요" thread', () => {
    render(<EngagementDmView workspaceId="ws-1" initialData={mockData} />)

    expect(screen.getByRole('tab', { name: /답장 필요/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /확인 필요/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /완료/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /만료됨/ })).toBeInTheDocument()

    // MasterDetail empty state initially before selection
    expect(screen.getByText('왼쪽에서 하나를 골라 보세요.')).toBeInTheDocument()

    // th-1 should be visible in active tab list
    const threadItem = screen.getByRole('button', { name: /active_cust/ })
    expect(threadItem).toBeInTheDocument()

    // Clicking the item opens the detail pane
    fireEvent.click(threadItem)
    expect(screen.getByRole('article', { name: '@active_cust 고객과의 1:1 메시지' })).toBeInTheDocument()

    // th-2 is SENT, so not in '답장 필요' tab
    expect(screen.queryByText('@sent_cust')).not.toBeInTheDocument()
  })

  it('switches to "완료" tab and shows completed threads', () => {
    render(<EngagementDmView workspaceId="ws-1" initialData={mockData} />)

    const sentTab = screen.getByRole('tab', { name: /완료/ })
    fireEvent.click(sentTab)

    expect(screen.getByText('@sent_cust')).toBeInTheDocument()
    expect(screen.queryByText('@active_cust')).not.toBeInTheDocument()
  })

  it('shows empty message when tab has no threads', () => {
    render(<EngagementDmView workspaceId="ws-1" initialData={mockData} />)

    const checkTab = screen.getByRole('tab', { name: /확인 필요/ })
    fireEvent.click(checkTab)

    expect(screen.getByText('확인이 필요한 메시지가 없어요')).toBeInTheDocument()
  })

  it('오프라인이면 전송 API 를 부르지 않고 이유를 보여 준다', async () => {
    setOnLine(false)
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    render(<EngagementDmView workspaceId="ws-1" initialData={mockData} />)

    // Select the thread item first
    fireEvent.click(screen.getByRole('button', { name: /active_cust/ }))

    fireEvent.click(screen.getByRole('button', { name: /답장 보내기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '보내기' }))

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('보내기를 두 번 눌러도 전송 요청은 한 번만 나간다', async () => {
    const calls: string[] = []
    let releaseSend: (() => void) | null = null
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/send')) {
        return new Promise<Response>((resolve) => {
          releaseSend = () => resolve(new Response(JSON.stringify({ ok: true, status: 'SENT' }), { status: 200 }))
        })
      }
      return Promise.resolve(new Response(JSON.stringify({ draft: { approved_fingerprint: 'fp' } }), { status: 200 }))
    }) as unknown as typeof fetch

    render(<EngagementDmView workspaceId="ws-1" initialData={mockData} />)
    fireEvent.click(screen.getByRole('button', { name: /active_cust/ }))
    fireEvent.click(screen.getByRole('button', { name: /답장 보내기/ }))
    const confirm = await screen.findByRole('button', { name: '보내기' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    const sendCalls = () => calls.filter((call) => call.endsWith('/send'))
    await waitFor(() => expect(sendCalls()).toHaveLength(1))

    releaseSend!()
    await waitFor(() => expect(screen.queryByText('이 메시지를 보낼까요?')).not.toBeInTheDocument())
    expect(sendCalls()).toHaveLength(1)
  })

  it('회수 카드의 전송 승인도 오프라인이면 명령을 보내지 않는다', async () => {
    const calls: string[] = []
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/engagement/dm/threads')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], send_enabled: true }), { status: 200 }))
      }
      if (url.endsWith('/booking-recovery/cases')) {
        return Promise.resolve(new Response(JSON.stringify({ cases: [RECOVERY_VIEW] }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }) as unknown as typeof fetch

    render(<EngagementDmView workspaceId="ws-1" />)
    const approve = await screen.findByRole('button', { name: '답변 전송 승인' })

    setOnLine(false)
    fireEvent.click(approve)

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    expect(calls.some((call) => call.endsWith('/commands'))).toBe(false)
  })

  it('같은 회수 건이 화면 두 곳에 있어도 승인 명령은 한 번만 나간다', async () => {
    const calls: string[] = []
    let releaseCommand: (() => void) | null = null
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/engagement/dm/threads')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [], send_enabled: true }), { status: 200 }))
      }
      if (url.endsWith('/booking-recovery/cases')) {
        return Promise.resolve(new Response(JSON.stringify({ cases: [RECOVERY_VIEW] }), { status: 200 }))
      }
      if (url.endsWith('/commands')) {
        return new Promise<Response>((resolve) => {
          releaseCommand = () => resolve(new Response(JSON.stringify({ view: RECOVERY_VIEW }), { status: 200 }))
        })
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }) as unknown as typeof fetch

    // 가드는 페이지 단위 싱글턴이다 — 같은 회수 건을 그리는 두 진입점이 한 번만 실행한다.
    render(
      <>
        <EngagementDmView workspaceId="ws-1" />
        <EngagementDmView workspaceId="ws-1" />
      </>,
    )
    const [first, second] = await screen.findAllByRole('button', { name: '답변 전송 승인' })

    fireEvent.click(first)
    await waitFor(() => expect(calls.filter((call) => call.endsWith('/commands'))).toHaveLength(1))
    fireEvent.click(second)

    expect(await screen.findByText(DUPLICATE_WRITE_COPY)).toBeInTheDocument()
    expect(calls.filter((call) => call.endsWith('/commands'))).toHaveLength(1)

    releaseCommand!()
  })
})
