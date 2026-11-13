import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UniversalAgentDock } from '../universal-agent-dock'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'
import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'

// 승인 카드의 '승인 및 실행'은 서버에서 외부 쓰기를 실행한다(ANI-1725).
// 오프라인이면 승인 POST 가 나가면 안 되고, 승인 완료로 보여서도 안 된다.
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

const APPROVAL_CARD = {
  decisionId: 'dec-1',
  title: '신메뉴 글 발행 승인',
  options: [{ id: 'opt-1', label: '지금 발행' }],
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
    if (url.endsWith('/booking-recovery/cases')) return jsonResponse(200, { cases: [] })
    if (url.endsWith('/agent/approvals')) {
      return jsonResponse(200, { approval: { actionRunId: 'run-1' }, executionResult: { evidence: { settledSC: 1, verifiedUrls: [] } } })
    }
    if (url.includes('/manifest.webmanifest')) return jsonResponse(200, {})
    return jsonResponse(200, { reply: '발행 전에 승인을 받아야 해요.', approvalCard: APPROVAL_CARD })
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

/** 승인 카드가 그려질 때까지 메시지를 보낸다. */
async function openApprovalCard() {
  render(tree())
  fireEvent.change(screen.getByPlaceholderText('예: 이번 주말 신메뉴 글 올려줘'), {
    target: { value: '신메뉴 글 발행해줘' },
  })
  fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }))
  return screen.findByRole('button', { name: '승인 및 실행' })
}

describe('UniversalAgentDock 승인 카드 가드', () => {
  it('오프라인이면 승인 요청을 보내지 않고 승인 카드에 이유를 보여 준다', async () => {
    const approve = await openApprovalCard()

    setOnLine(false)
    fireEvent.click(approve)

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/agent/approvals'))).toBe(false)
    // 거짓 성공 금지 — 승인 완료 상태로 바뀌면 안 된다.
    expect(screen.queryByText(/승인 완료/)).not.toBeInTheDocument()
  })

  it('온라인이면 승인 요청을 한 번 보내고 승인 완료를 보여 준다', async () => {
    const approve = await openApprovalCard()

    fireEvent.click(approve)

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/agent/approvals'))).toHaveLength(1),
    )
    expect(await screen.findByText(/승인 완료/)).toBeInTheDocument()
    expect(screen.queryByText(OFFLINE_WRITE_COPY)).not.toBeInTheDocument()
  })
})
