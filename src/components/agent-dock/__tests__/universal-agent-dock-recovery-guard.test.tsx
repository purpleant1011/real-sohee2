import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UniversalAgentDock } from '../universal-agent-dock'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'
import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import type { RecoveryView } from '@/features/booking-recovery/contracts'

// 회수 카드의 답변 전송 승인은 외부 쓰기다(ANI-1778). 오프라인이면 명령 POST 가 나가면 안 된다.
vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: false,
    actualMode: 'IDLE',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({ balance: 5000, capacity: 5000, remainingPercentage: 100 }),
}))
vi.mock('@/hooks/use-agent-session', () => ({
  useAgentSession: () => ({ sessionId: 'sess-1', threadId: 'thread-1', isLoading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app',
  useSearchParams: () => ({ get: () => null }),
}))

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

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setOnLine(true)
  resetPageActionGuardForTests()
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/booking-recovery/cases')) return jsonResponse(200, { cases: [RECOVERY_VIEW] })
    if (url.endsWith('/commands')) return jsonResponse(200, { view: RECOVERY_VIEW })
    if (url.includes('/manifest.webmanifest')) return jsonResponse(200, {})
    return jsonResponse(200, { reply: '네, 확인했어요.', messages: [], proposals: [] })
  })
})

afterEach(() => vi.unstubAllGlobals())

function tree() {
  return (
    <SurfaceContextProvider>
      <ProposalBusProvider>
        <UniversalAgentDock workspaceId="ws-1" isOpen onClose={vi.fn()} />
      </ProposalBusProvider>
    </SurfaceContextProvider>
  )
}

/** 회수 카드가 그려질 때까지 "예약 문의 확인" 명령을 보낸다. */
async function openRecoveryCard() {
  render(tree())
  fireEvent.change(screen.getByPlaceholderText('예: 이번 주말 신메뉴 글 올려줘'), {
    target: { value: '예약 문의 확인해줘' },
  })
  fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))
  return screen.findByRole('button', { name: '답변 전송 승인' })
}

describe('UniversalAgentDock 회수 카드 가드', () => {
  it('오프라인이면 회수 승인 명령을 보내지 않고 이유를 카드에 보여 준다', async () => {
    const approve = await openRecoveryCard()

    setOnLine(false)
    fireEvent.click(approve)

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/commands'))).toBe(false),
    )
  })

  it('온라인이면 회수 승인 명령을 한 번 보낸다', async () => {
    const approve = await openRecoveryCard()

    fireEvent.click(approve)

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/commands'))).toHaveLength(1),
    )
    expect(screen.queryByText(OFFLINE_WRITE_COPY)).not.toBeInTheDocument()
  })
})
