import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationMessage } from './types'
import type { ContentInterviewView } from './content-interview'

vi.mock('server-only', () => ({}))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => '20000000-0000-4000-8000-000000000001' }))

vi.mock('@/features/content/actions/save-artifact-to-work', () => ({
  saveArtifactToWork: vi.fn(),
}))
vi.mock('./actions/load-conversation-publishing', () => ({ loadConversationPublishingAction: vi.fn() }))
vi.mock('./actions/partial-content-revision', () => ({ partialContentRevisionAction: vi.fn() }))
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))
vi.mock('@/features/image-style/actions/load-style-summary', () => ({
  loadWorkspaceStyleSummaryAction: vi.fn().mockResolvedValue({
    data: {
      image: { configured: false, headline: '', referenceCount: 0, references: [], hasGuide: false, custom: false },
      text: { configured: false, voiceSummary: '' },
    },
  }),
}))
// 외부 쓰기 가드는 실제 연결 확인(probe)을 거친다. 이 스위트는 회수 카드 명령을 보는 것이므로
// probe 는 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다(ANI-1778).
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})

import { MessageCard } from './message-card'
import { UserProfileProvider } from '@/features/account/user-profile-context'
import { OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import type { RecoveryView } from '@/features/booking-recovery/contracts'

const messageBase = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  threadId: '30000000-0000-4000-8000-000000000001',
  content: '확인할 내용을 정리했어요.',
  status: 'completed',
  workItemId: null,
  createdAt: '2026-08-10T09:00:00+09:00',
  completedAt: '2026-08-10T09:00:01+09:00',
} as const

const clarification: ContentInterviewView = {
  kind: 'content_interview',
  status: 'collecting',
  step: 1,
  totalSteps: 4,
  question: '이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?',
  options: [{ value: 'consultation', label: '상담 문의를 늘리고 싶어요' }],
  optionGroups: [],
  previousAnswers: [],
}

describe('MessageCard', () => {
  it('renders known internal source keys as human-readable provenance without changing user messages', () => {
    const content = '바이름 청라점 [businessContext] · [approvedFacts] · [knowledgeJournal]'
    const { rerender } = render(<MessageCard message={{ ...messageBase, role: 'sohee', content }} />)
    expect(screen.queryByText(/\[businessContext\]/)).not.toBeInTheDocument()
    expect(screen.getByText(/등록된 가게 정보/)).toBeInTheDocument()
    expect(screen.getByText(/승인된 지식/)).toBeInTheDocument()
    rerender(<MessageCard message={{ ...messageBase, role: 'user', content }} />)
    expect(screen.getByText(content)).toBeInTheDocument()
  })
  it('renders the canonical reply draft beside its originating assistant message', () => {
    render(<MessageCard message={{ ...messageBase, role: 'sohee', interactionDrafts: [{
      id: '40000000-0000-4000-8000-000000000001', kind: 'interaction_draft', workspaceId: messageBase.workspaceId,
      targetKind: 'comment', targetId: '60000000-0000-4000-8000-000000000001', draftId: '70000000-0000-4000-8000-000000000001',
      draftText: '저장된 검토용 답안입니다.', fingerprint: 'a'.repeat(64), sourceRef: 'b'.repeat(64), channel: 'threads',
      customerLabel: '문의 고객', preparedAt: '2026-10-29T12:00:00Z', reused: false, requiresUserApproval: true,
    }] }} />)
    expect(screen.getByText('저장된 검토용 답안입니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '최신 원문과 답안 확인' })).toBeEnabled()
  })
  it('shows an unavailable result lookup instead of pretending there were no saved drafts', () => {
    render(<MessageCard message={{ ...messageBase, role: 'sohee', interactionDraftsUnavailable: true }} />)
    expect(screen.getByText('저장된 답안 결과를 불러오지 못했어요. 소통함에서 최신 답안을 확인해 주세요.')).toBeInTheDocument()
  })
  it('renders a server and browser stable 24-hour Korea time label', () => {
    render(<MessageCard message={{ ...messageBase, role: 'sohee' }} />)

    expect(screen.getByText('09:00', { selector: 'time' })).toHaveAttribute(
      'dateTime',
      messageBase.createdAt,
    )
  })

  it('removes internal identifiers and raw Markdown markers from assistant text', () => {
    const internalId = '4b506fb3-150a-40b6-886b-60c8b1e5b475'
    render(<MessageCard message={{
      ...messageBase,
      role: 'sohee',
      content: `## 관찰\n**확인된 내용** [근거: \`${internalId}\`]\n> 사람 검토 필요`,
    }} />)

    const message = screen.getByRole('article', { name: '소희 메시지' })
    expect(message).toHaveTextContent('관찰')
    expect(message).toHaveTextContent('확인된 내용')
    expect(message).toHaveTextContent('확인된 자료')
    expect(message).toHaveTextContent('사람 검토 필요')
    expect(message).not.toHaveTextContent(internalId)
    expect(message).not.toHaveTextContent(/##|\*\*|`|^>/u)
  })

  it.each([
    ['sohee', '소희 메시지'],
    ['user', '내 메시지'],
    ['system_event', '운영 알림'],
  ] as const)('labels a %s message as %s', (role, accessibleName) => {
    render(<MessageCard message={{ ...messageBase, role } satisfies ConversationMessage} />)
    expect(screen.getByRole('article', { name: accessibleName })).toBeInTheDocument()
  })

  it('shows Sohee on assistant messages and the signed user photo on user messages', () => {
    const { rerender } = render(
      <UserProfileProvider avatarUrl="https://signed.example/user.png">
        <MessageCard message={{ ...messageBase, role: 'sohee' }} />
      </UserProfileProvider>,
    )
    expect(screen.getByRole('img', { name: '소희' })).toHaveAttribute(
      'src',
      expect.stringContaining('sohee-character-v1.png'),
    )

    rerender(
      <UserProfileProvider avatarUrl="https://signed.example/user.png">
        <MessageCard message={{ ...messageBase, role: 'user' }} />
      </UserProfileProvider>,
    )
    expect(screen.getByRole('img', { name: '내 프로필 사진' })).toHaveAttribute(
      'src',
      'https://signed.example/user.png',
    )
  })

  it('offers an accessible retry action for a failed message', () => {
    const retry = vi.fn()
    render(
      <MessageCard
        message={{ ...messageBase, role: 'sohee', status: 'failed' }}
        onRetry={retry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '응답 다시 시도' }))
    expect(retry).toHaveBeenCalledWith(messageBase.id)
  })

  it('shows an interview question once while preserving the surrounding assistant explanation', () => {
    render(<MessageCard message={{ ...messageBase, role: 'sohee', clarification,
      content: `요청하신 방향을 확인할게요.\n\n1 / 4 ${clarification.question}`,
    }} onSubmit={vi.fn()} />)
    expect(screen.getAllByText(clarification.question, { exact: false })).toHaveLength(1)
    expect(screen.getByText('요청하신 방향을 확인할게요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeEnabled()
  })

  it('renders the interview card only for a Sohee message with clarification', () => {
    render(
      <MessageCard
        message={{ ...messageBase, role: 'sohee', clarification }}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: '콘텐츠 방향 질문' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeInTheDocument()
  })

  it('does not render an interview card on a user message even if malformed props include clarification', () => {
    render(
      <MessageCard
        message={{ ...messageBase, role: 'user', clarification }}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.queryByRole('region', { name: '콘텐츠 방향 질문' })).not.toBeInTheDocument()
  })

  it('passes workspaceId to ContentInterviewCard so style summary can be loaded', async () => {
    const { loadWorkspaceStyleSummaryAction } = await import(
      '@/features/image-style/actions/load-style-summary'
    )
    render(
      <MessageCard
        message={{ ...messageBase, role: 'sohee', clarification }}
        onSubmit={vi.fn()}
        workspaceId="test-ws-456"
      />,
    )

    await waitFor(() => {
      expect(loadWorkspaceStyleSummaryAction).toHaveBeenCalledWith({
        workspaceId: 'test-ws-456',
      })
    })
  })
})

describe('MessageCard 예약 문의 회수 외부 쓰기 가드 (ANI-1778)', () => {
  const recoveryView: RecoveryView = {
    caseId: '50000000-0000-4000-8000-000000000001',
    missionId: '20000000-0000-4000-8000-000000000001',
    version: 2,
    stage: 'AWAITING_SEND_APPROVAL',
    statusLabel: '전송 승인 대기',
    sourceThreadId: '30000000-0000-4000-8000-000000000001',
    sourceInboundMessageId: '60000000-0000-4000-8000-000000000001',
    observedAt: '2026-08-10T09:00:00.000Z',
    reply: { text: '예약 가능합니다', fingerprint: 'a'.repeat(64) },
    offer: null,
    acceptance: null,
    approval: { kind: 'send', fingerprint: 'a'.repeat(64) },
    proposal: null,
    booking: null,
    nextAction: 'approve_send',
    revenue: { status: 'NOT_OBSERVED', amountKrw: null },
  }
  const recoveryArtifact = {
    id: 'artifact-1',
    kind: 'booking_recovery' as const,
    title: '예약 문의',
    href: '/app/customers',
    requiresConfirmation: true as const,
    caseId: recoveryView.caseId,
    missionId: recoveryView.missionId,
    version: recoveryView.version,
    view: recoveryView,
  }
  const commandUrl = `/api/workspaces/ws-test/booking-recovery/cases/${recoveryView.caseId}/commands`

  function setOnLine(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
  }

  function renderRecoveryCard() {
    return render(
      <MessageCard message={{ ...messageBase, role: 'sohee' }} artifacts={[recoveryArtifact]} />,
    )
  }

  beforeEach(() => {
    resetPageActionGuardForTests()
    setOnLine(true)
    window.history.pushState({}, '', '/workspaces/ws-test/conversations/thread-1')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
  })

  it('오프라인이면 고객에게 나가는 전송 승인 명령을 보내지 않고 이유를 보여준다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderRecoveryCard()

    setOnLine(false)
    fireEvent.click(screen.getByRole('button', { name: '답변 전송 승인' }))

    expect(await screen.findByText(OFFLINE_WRITE_COPY)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('연결되어 있으면 전송 승인 명령을 보낸다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    renderRecoveryCard()

    fireEvent.click(screen.getByRole('button', { name: '답변 전송 승인' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(commandUrl, expect.objectContaining({ method: 'POST' })))
    expect(screen.queryByText(OFFLINE_WRITE_COPY)).not.toBeInTheDocument()
  })

  it('renders task_timeline artifact using ConversationTaskTimeline', () => {
    const timelineArtifact = {
      id: 'timeline-1',
      kind: 'task_timeline' as const,
      title: '블로그 마케팅 계획',
      totalSteps: 2,
      completedSteps: 1,
      steps: [
        { id: 's-1', title: '승인 사실 대조', status: 'completed' as const },
        { id: 's-2', title: '원고 초안 작성', status: 'in_progress' as const },
      ],
      isLive: true,
    }

    render(
      <MessageCard
        message={{ ...messageBase, role: 'sohee' }}
        artifacts={[timelineArtifact]}
      />
    )

    expect(screen.getByText('블로그 마케팅 계획')).toBeInTheDocument()
    expect(screen.getByText('1 / 2 완료')).toBeInTheDocument()
    expect(screen.getByText('승인 사실 대조')).toBeInTheDocument()
    expect(screen.getByText('원고 초안 작성')).toBeInTheDocument()
  })
})
