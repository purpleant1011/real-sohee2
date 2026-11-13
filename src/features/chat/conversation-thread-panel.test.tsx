import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => mocks }))

import { ConversationThreadPanel } from './conversation-thread-panel'
import { ConversationWorkStatusContext } from './conversation-work-status-context'
import type { ConversationThreadSummary } from './thread-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const currentThreadId = '20000000-0000-4000-8000-000000000001'
const threads: readonly ConversationThreadSummary[] = [
  {
    id: currentThreadId,
    workspaceId,
    title: '주간 콘텐츠 계획',
    status: 'active',
    lastMessageAt: '2026-08-14T02:00:00.000Z',
    createdAt: '2026-08-14T01:00:00.000Z',
    updatedAt: '2026-08-14T02:00:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    workspaceId,
    title: '지난달 프로모션',
    status: 'archived',
    lastMessageAt: '2026-07-13T02:00:00.000Z',
    createdAt: '2026-07-13T01:00:00.000Z',
    updatedAt: '2026-07-13T02:00:00.000Z',
  },
]

describe('ConversationThreadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders the desktop history inline and groups conversations by month', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={threads}
        variant="sidebar"
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByRole('navigation', { name: '최근 대화' })).toBeInTheDocument()
    expect(screen.getByText('2026년 8월')).toBeInTheDocument()
    expect(screen.getByText('2026년 7월')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /주간 콘텐츠 계획/ })).toBeInTheDocument()
    fireEvent.click(screen.getByText('2026년 7월'))
    expect(screen.getByRole('link', { name: /지난달 프로모션/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '과거 대화' })).not.toBeInTheDocument()

    const currentMonth = screen.getByText('2026년 8월').closest('details')
    expect(currentMonth).toHaveAttribute('open')
    fireEvent.click(screen.getByText('2026년 8월'))
    expect(currentMonth).not.toHaveAttribute('open')
  })

  it('shows 작업 중 only for a thread with confirmed active API work', () => {
    render(
      <ConversationWorkStatusContext.Provider value={{
        activeJobCount: 1,
        attentionThreadCount: 0,
        threads: [{ threadId: currentThreadId, displayStatus: 'working', activeJobCount: 1, latestJobUpdatedAt: '2026-08-22T14:00:00.000Z' }],
        creditBalance: { available: 1253, weeklyLimit: 2000, consumed: 700, reserved: 47, policyVersion: 'v08-test-2000-1' },
        observedAt: '2026-08-22T14:00:00.000Z',
      }}>
        <ConversationThreadPanel
          canManageThreads
          currentThreadId={currentThreadId}
          hasMore={false}
          initialThreads={threads}
          variant="sidebar"
          workspaceId={workspaceId}
        />
      </ConversationWorkStatusContext.Provider>,
    )

    expect(screen.getByText('작업 중')).toBeInTheDocument()
    expect(screen.queryByText('사용 중')).not.toBeInTheDocument()
  })

  it('keeps the full history list out of the desktop sidebar until the user opens it', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.queryByRole('complementary', { name: '과거 대화' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '대화 스레드 목록' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '과거 대화' }))

    const dialog = screen.getByRole('dialog', { name: '과거 대화' })
    expect(within(dialog).getByRole('list', { name: '2026년 8월 대화 목록' })).toBeInTheDocument()
  })

  it('uses an existing surface shadow token for the desktop history dialog', () => {
    const css = readFileSync(join(process.cwd(), 'src/features/chat/conversation-shell.module.css'), 'utf8')

    expect(css).toContain('box-shadow: var(--v07-shadow-md);')
    expect(css).not.toContain('var(--v07-shadow-lg)')
  })

  it('returns to the canonical conversation entry after archiving the current thread', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { thread: { ...threads[0], status: 'archived' } } })))
    render(<ConversationThreadPanel canManageThreads currentThreadId={currentThreadId} hasMore={false} initialThreads={threads} variant="sidebar" workspaceId={workspaceId} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '주간 콘텐츠 계획 보관' })))
    expect(mocks.push).toHaveBeenCalledWith('/app/conversations')
  })

  it('opens an accessible mobile drawer, identifies threads, and restores focus when closed', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )
    const trigger = screen.getByRole('button', { name: '과거 대화' })
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: '과거 대화' })).toBeInTheDocument()
    expect(screen.getAllByText('주간 콘텐츠 계획')[0]).toBeInTheDocument()
    expect(screen.getAllByText('지난달 프로모션')[0]).toBeInTheDocument()
    expect(screen.getAllByText('보관됨')[0]).toBeInTheDocument()
    expect(screen.getAllByText('8월 14일 11:00')[0]).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '과거 대화 닫기' }))
    expect(trigger).toHaveFocus()
  })

  it('opens the full conversation list from the app shell deep link', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initiallyOpen
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByRole('dialog', { name: '과거 대화' })).toBeInTheDocument()
  })

  it('keeps new conversation, history, and inbox inside the conversation surface without a workbox menu', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={threads}
        unreadInboxCount={3}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getAllByRole('button', { name: '새 대화' })[0]).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '과거 대화' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '작업함' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '소희 문의답변 3' })[0]).toHaveAttribute('href', '/app/inbox')
  })

  it('opens an unsaved new conversation without inserting a thread', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: '새 대화' })[0])

    expect(mocks.push).toHaveBeenCalledWith('/app/conversations')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows a real load error and retries the same next page', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE' } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: [], hasMore: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore
        initiallyOpen
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '이전 대화 더 보기' })[0])
    })
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('대화 목록을 불러오지 못했어요')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '다시 시도' })[0])
    })
    expect(fetch).toHaveBeenLastCalledWith(
      `/api/workspaces/${workspaceId}/conversations?page=1`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('최초 서버 목록 조회가 실패하면 대화가 없다고 표시하지 않고 0페이지를 자동 복구한다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      data: { items: threads, hasMore: false },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    render(<ConversationThreadPanel {...({
      canManageThreads: true,
      currentThreadId,
      hasMore: false,
      initialLoadFailed: true,
      initialThreads: [],
      variant: 'sidebar',
      workspaceId,
    } as Parameters<typeof ConversationThreadPanel>[0])} />)

    expect(screen.queryByText('아직 저장된 대화가 없어요')).not.toBeInTheDocument()
    expect(screen.getByText('최근 대화를 다시 연결하고 있어요')).toBeInTheDocument()

    await act(async () => undefined)

    expect(fetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/conversations?page=0`,
      expect.objectContaining({ method: 'GET' }),
    )
    expect(await screen.findByRole('link', { name: /주간 콘텐츠 계획/ })).toBeInTheDocument()
  })

  it('reconciles the server title after the first message refreshes the current thread', () => {
    const view = render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initiallyOpen
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )

    view.rerender(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initiallyOpen
        initialThreads={[{ ...threads[0], title: '인스타그램 가을 콘텐츠를 준비해 줘' }, threads[1]]}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getAllByText('인스타그램 가을 콘텐츠를 준비해 줘')[0]).toBeInTheDocument()
    expect(screen.queryByText('주간 콘텐츠 계획')).not.toBeInTheDocument()
  })

  it('keeps keyboard focus inside the modal drawer while it is open', () => {
    render(
      <ConversationThreadPanel
        canManageThreads
        currentThreadId={currentThreadId}
        hasMore={false}
        initialThreads={threads}
        workspaceId={workspaceId}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '과거 대화' }))
    const dialog = screen.getByRole('dialog', { name: '과거 대화' })
    within(dialog).getByRole('link', { name: '소희 문의답변 0' }).focus()

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(screen.getByRole('button', { name: '새 대화 시작' })).toHaveFocus()
  })
})
