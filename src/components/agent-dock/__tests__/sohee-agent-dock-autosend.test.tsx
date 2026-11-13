import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SoheeAgentDock } from '../sohee-agent-dock'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({ balance: 5000, capacity: 5000, remainingPercentage: 100 }),
}))
const agentSession = {
  sessionId: 'sess-1' as string | null,
  threadId: 'thread-1' as string | null,
  isLoading: false,
}
vi.mock('@/hooks/use-agent-session', () => ({
  useAgentSession: () => agentSession,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app',
  useSearchParams: () => ({ get: () => null }),
}))

function chatCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/agent/chat'))
}

describe('SoheeAgentDock autoSendMessage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    agentSession.sessionId = 'sess-1'
    agentSession.threadId = 'thread-1'
    agentSession.isLoading = false
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ reply: '네, 준비할게요.', messages: [] }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const tree = (
    autoSendMessage: { id: string; text: string } | null,
    onAutoSendConsumed = vi.fn(),
  ) => (
    <SurfaceContextProvider>
      <ProposalBusProvider>
        <SoheeAgentDock
          workspaceId="ws-1"
          isOpen
          onClose={vi.fn()}
          autoSendMessage={autoSendMessage}
          onAutoSendConsumed={onAutoSendConsumed}
        />
      </ProposalBusProvider>
    </SurfaceContextProvider>
  )

  it('sends the pending message once and reports it as consumed', async () => {
    const onConsumed = vi.fn()
    const pending = { id: 'pm-1', text: '이번 주말 신메뉴 글 올려줘' }
    const { rerender } = render(tree(pending, onConsumed))
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1))
    const body = JSON.parse(chatCalls(fetchMock)[0][1].body as string)
    expect(body.currentUserMessage).toBe('이번 주말 신메뉴 글 올려줘')
    expect(onConsumed).toHaveBeenCalledWith('pm-1')
    expect(await screen.findByText('네, 준비할게요.')).toBeInTheDocument()

    rerender(tree(pending, onConsumed))
    expect(chatCalls(fetchMock)).toHaveLength(1)
  })

  it('does nothing when there is no pending message', async () => {
    const onConsumed = vi.fn()
    render(tree(null, onConsumed))
    await new Promise((r) => setTimeout(r, 30))
    expect(chatCalls(fetchMock)).toHaveLength(0)
    expect(onConsumed).not.toHaveBeenCalled()
  })

  it('waits for the session to load, shows a status hint, and never touches the input', async () => {
    agentSession.isLoading = true
    const pending = { id: 'pm-2', text: '후기 요청 문구 만들어줘' }
    const { rerender } = render(tree(pending))
    expect(await screen.findByRole('status')).toHaveTextContent('연결')
    expect(screen.getByPlaceholderText(/이번 주말 신메뉴/)).toHaveValue('')
    expect(chatCalls(fetchMock)).toHaveLength(0)

    agentSession.isLoading = false
    rerender(tree(pending))
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1))
  })

  it('still sends when the session has no thread (same as manual send)', async () => {
    agentSession.threadId = null
    agentSession.sessionId = null
    render(tree({ id: 'pm-3', text: '글 써줘' }))
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1))
  })

  it('does not expose the internal run id to the user', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ reply: '시작했어요.', runId: 'run_1234abcd', messages: [] }),
    }))
    render(tree({ id: 'pm-4', text: '글 써줘' }))
    await screen.findByText('시작했어요.')
    expect(screen.queryByText(/run_1234abcd/)).toBeNull()
    expect(screen.queryByText(/Run:/)).toBeNull()
    expect(screen.getByText('진행 중인 작업')).toBeInTheDocument()
  })

  it('has a 44px close button with a user-facing label', () => {
    render(tree(null))
    const close = screen.getByRole('button', { name: '대화창 닫기' })
    expect(close.className).toContain('min-h-11')
    expect(close.className).toContain('min-w-11')
  })
})
