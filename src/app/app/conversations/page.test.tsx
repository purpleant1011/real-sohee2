import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), list: vi.fn(), client: vi.fn(), redirect: vi.fn(), resolveWork: vi.fn() }))
vi.mock('@/features/auth/current-workspace', () => ({ resolveCurrentWorkspaceContext: mocks.workspace }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.client }))
vi.mock('@/features/chat/thread-repository', () => ({ listConversationThreads: mocks.list }))
vi.mock('@/features/chat/conversation-work-ref', () => ({ resolveConversationWorkRef: mocks.resolveWork }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/chat/conversation-client', () => ({ ConversationClient: (props: {
  workspaceId: string; initialThreads: readonly { title: string }[]; initialThreadLoadFailed?: boolean; readOnly?: boolean
}) => <section aria-label="정본 대화"><p>{props.workspaceId}</p>{props.initialThreads.map(t => <p key={t.title}>{t.title}</p>)}
  {props.initialThreadLoadFailed ? <p>목록 조회 실패</p> : null}{props.readOnly ? <p>읽기 전용</p> : null}</section> }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="full-app-shell">{children}</div> }))
vi.mock('@/features/chat/v086-conversation-workspace', () => ({ V086ConversationWorkspace: () => <p>기존 대화 작업 화면</p> }))
import ConversationsPage from './page'

const workspaceId = '11111111-1111-4111-8111-111111111111'

describe('canonical conversation entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CONVERSATION_WORKBENCH_ENABLED', '1')
    vi.stubEnv('CONVERSATION_WORKBENCH_WORKSPACE_ALLOWLIST', workspaceId)
    mocks.workspace.mockResolvedValue({ status: 'ready', context: { workspaceId, role: 'owner' } })
    mocks.list.mockResolvedValue({ items: [{ title: '이전에 맡긴 홍보' }], hasMore: true })
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: workspaceId } }, error: null }) } })
    mocks.resolveWork.mockResolvedValue(null)
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`) })
  })
  it('opens canonical conversation with existing history without creating a session', async () => {
    render(await ConversationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('region', { name: '정본 대화' })).toBeInTheDocument()
    expect(screen.getByTestId('full-app-shell')).toContainElement(screen.getByRole('region', { name: '정본 대화' }))
    expect(screen.getByText('이전에 맡긴 홍보')).toBeInTheDocument()
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, page: 0, limit: 20 }))
    expect(screen.queryByRole('link', { name: /기존 대화/ })).not.toBeInTheDocument()
    const legacyLink = screen.getByRole('link', { hidden: true })
    expect(legacyLink).toHaveAttribute('href', '/app/conversations?view=legacy')
    expect(legacyLink).toHaveClass('hidden')
  })
  it('기존 대화 작업 화면 열기 링크는 일반 사용자에게 숨김 처리된다', async () => {
    render(await ConversationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.queryByRole('link', { name: /기존 대화/ })).not.toBeInTheDocument()
    const legacyLink = screen.getByRole('link', { hidden: true })
    expect(legacyLink).toHaveClass('hidden')
    expect(legacyLink).toHaveAttribute('aria-hidden', 'true')
  })
  it('does not open a conversation for a stale or foreign selected work reference', async () => {
    render(await ConversationsPage({ searchParams: Promise.resolve({ workRef: workspaceId }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('선택한 원고')
    expect(screen.queryByRole('region', { name: '정본 대화' })).not.toBeInTheDocument()
  })
  it('keeps the previous entry when the server rollout is off', async () => {
    vi.stubEnv('CONVERSATION_WORKBENCH_ENABLED', '0')
    render(await ConversationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('기존 대화 작업 화면')).toBeInTheDocument()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('keeps legacy creative and session features explicitly accessible', async () => {
    render(await ConversationsPage({ searchParams: Promise.resolve({ view: 'legacy' }) }))
    expect(screen.getByText('기존 대화 작업 화면')).toBeInTheDocument()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('does not misrepresent list failure as an empty history', async () => {
    mocks.list.mockRejectedValue(new Error('unavailable'))
    render(await ConversationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('목록 조회 실패')).toBeInTheDocument()
  })
  it('does not permit a viewer to send new requests', async () => {
    mocks.workspace.mockResolvedValue({ status: 'ready', context: { workspaceId, role: 'viewer' } })
    render(await ConversationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('읽기 전용')).toBeInTheDocument()
  })
  it('requires authentication before loading any conversation history', async () => {
    mocks.workspace.mockResolvedValue({ status: 'expired' })
    await expect(ConversationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/login')
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('shows permission failure without reading history or creating a session', async () => {
    mocks.workspace.mockResolvedValue({ status: 'forbidden' })
    render(await ConversationsPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('alert')).toHaveTextContent('권한')
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
