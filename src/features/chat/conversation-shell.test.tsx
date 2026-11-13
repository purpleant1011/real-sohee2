import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/features/content/actions/save-artifact-to-work', () => ({
  saveArtifactToWork: vi.fn(),
}))
vi.mock('./actions/load-conversation-publishing', () => ({ loadConversationPublishingAction: vi.fn() }))
vi.mock('./actions/partial-content-revision', () => ({ partialContentRevisionAction: vi.fn() }))
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))

import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { ConversationShell } from './conversation-shell'
import { buildConversationOperationCatalog } from './conversation-operation-catalog'
import { ChatPanelProvider, useChatPanel } from '@/features/agent-dock/chat-panel-store'

it('keeps request recovery guidance in the input dock rather than below unscrolled history', () => {
  render(<ConversationShell messages={[]} errorMessage="사진을 다시 확인해 주세요." onSubmit={vi.fn()} />)
  const input = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
  const dock = input.closest('form')!.parentElement!
  expect(within(dock).getByRole('alert')).toHaveTextContent('사진을 다시 확인해 주세요.')
})

function GlobalDraftTrigger() {
  const panel = useChatPanel()
  return <button onClick={() => panel.sendFromBar('사진으로 이번 주 홍보를 준비해줘')}>입력 인계</button>
}
import type { M01ProactiveReport } from './proactive-report'
import type { ContentInterviewView } from './content-interview'

const soheeMessage = {
  id: '66666666-6666-4666-8666-666666666666',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  threadId: '22222222-2222-4222-8222-222222222222',
  role: 'sohee' as const,
  content: '바이름 하네스로 이미지 초안을 준비했어요.',
  status: 'completed' as const,
  workItemId: null,
  createdAt: '2026-08-10T01:00:00.000Z',
  completedAt: '2026-08-10T01:01:00.000Z',
}

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

const proactiveReport: M01ProactiveReport = Object.freeze({
  checkedAt: '2026-08-10T09:30:00+09:00',
  conversationCount: 7,
  headline: '최근 콘텐츠 반응을 정리했어요.',
  insight: '확인된 고객 대화 7건이 있어요. 고객의 질문과 예약 연결은 리포트에서 확인할 수 있어요.',
  metrics: Object.freeze([
    { key: 'engagements', label: '관심 반응', value: 184 },
    { key: 'visits', label: '유입', value: 23 },
    { key: 'inquiries', label: '문의', value: 12 },
    { key: 'reservations', label: '예약', value: 7 },
  ] as const),
  periodLabel: '2026. 8. 3. – 2026. 8. 10.',
  screenId: 'M-01',
  sourceMessage: '확인된 기간의 실제 반응만 표시합니다.',
  sourceState: '표본 확인됨',
})

describe('ConversationShell', () => {
  it('keeps the existing composer mounted and appends an operation without submitting it', async () => {
    const onSubmit = vi.fn()
    const catalog = buildConversationOperationCatalog({ workspaceId: soheeMessage.workspaceId, role: 'owner',
      workbenchEnabled: true, agentEnabled: true, modelConfigured: true, connectedChannels: [], observedAt: '2026-10-29T12:00:00Z' })
    render(<ConversationShell workspaceId={soheeMessage.workspaceId} operationCatalog={catalog} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '작성하던 내용' } })
    fireEvent.click(screen.getByRole('button', { name: '소희가 할 수 있는 일 열기' }))
    fireEvent.click(await screen.findByRole('button', { name: '기획·프로모션 대화에 담기' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue(`작성하던 내용\n${catalog.items.find(item => item.id === 'marketing-plan')!.prompt}`))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('receives a scoped global draft without automatically submitting it', async () => {
    const onSubmit = vi.fn()
    render(<ChatPanelProvider onOpenConversation={vi.fn()} workspaceId="workspace-a">
      <GlobalDraftTrigger />
      <ConversationShell workspaceId="workspace-a" onSubmit={onSubmit} />
    </ChatPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: '입력 인계' }))
    expect(await screen.findByDisplayValue('사진으로 이번 주 홍보를 준비해줘')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveFocus()
  })

  it('never transfers a draft to another workspace or a read-only conversation', () => {
    const { rerender } = render(<ChatPanelProvider onOpenConversation={vi.fn()} workspaceId="workspace-a">
      <GlobalDraftTrigger /><ConversationShell workspaceId="workspace-b" onSubmit={vi.fn()} />
    </ChatPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: '입력 인계' }))
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('')
    rerender(<ChatPanelProvider onOpenConversation={vi.fn()} workspaceId="workspace-a">
      <GlobalDraftTrigger /><ConversationShell composerDisabled workspaceId="workspace-a" onSubmit={vi.fn()} />
    </ChatPanelProvider>)
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('')
  })

  it('does not transfer an unscoped draft into a conversation without a verified workspace', () => {
    render(<ChatPanelProvider onOpenConversation={vi.fn()}>
      <GlobalDraftTrigger /><ConversationShell onSubmit={vi.fn()} />
    </ChatPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: '입력 인계' }))
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('')
  })

  it('offers an explicit return to direct work without submitting a message', () => {
    const onSubmit = vi.fn()
    render(<ConversationShell onSubmit={onSubmit} directWorkHref="/app/content" />)
    expect(screen.getByRole('navigation', { name: '업무 방식' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /화면에서 직접/ })).toHaveAttribute('href', '/app/content')
    expect(screen.getByText('대화로 맡기기')).toHaveAttribute('aria-current', 'page')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('uses the shared viewport calculation to keep the composer above the keyboard', async () => {
    vi.stubGlobal('visualViewport', { height: 500, offsetTop: 0, scale: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('innerHeight', 800)
    const { unmount } = render(<ConversationShell />)
    expect(screen.getByRole('region', { name: '소희와의 대화' }).style.getPropertyValue('--conversation-keyboard-inset')).toBe('300px')
    unmount()
    vi.unstubAllGlobals()
  })

  it('keeps the existing draft when another global instruction is handed over', async () => {
    render(<ChatPanelProvider onOpenConversation={vi.fn()} workspaceId="workspace-a">
      <GlobalDraftTrigger /><ConversationShell workspaceId="workspace-a" onSubmit={vi.fn()} />
    </ChatPanelProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '작성 중이던 요청' } })
    fireEvent.click(screen.getByRole('button', { name: '입력 인계' }))
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('작성 중이던 요청\n사진으로 이번 주 홍보를 준비해줘')
  })

  it('applies composer and keyboard scroll clearance on mobile viewports', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('759'), media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })))
    vi.stubGlobal('visualViewport', { height: 500, offsetTop: 0, scale: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('innerHeight', 800)
    const { unmount } = render(<ConversationShell />)
    expect(document.documentElement.style.getPropertyValue('--conversation-scroll-clearance')).not.toBe('')
    unmount()
    vi.unstubAllGlobals()
  })

  it('starts with the owners request instead of unobserved marketing signals', () => {
    render(<ConversationShell />)
    const conversation = within(screen.getByRole('list', { name: '대화 메시지' }))
    expect(conversation.getAllByRole('heading')[0]).toHaveTextContent('무엇부터 함께 해볼까요?')
    expect(conversation.queryByText('미응답 고객 문의')).not.toBeInTheDocument()
  })

  it('allows actions only on the latest interview card', () => {
    const laterClarification: ContentInterviewView = {
      ...clarification,
      step: 2,
      question: '이번 콘텐츠가 어떤 사람의 어떤 고민에 닿으면 좋을까요?',
      options: [{ value: 'local', label: '인천 청라와 주변 지역에서 상담할 사람' }],
      previousAnswers: [{ step: 1, label: '상담 문의를 늘리고 싶어요' }],
    }
    render(<ConversationShell
      messages={[
        { ...soheeMessage, id: '66666666-6666-4666-8666-666666666661', clarification },
        { ...soheeMessage, id: '66666666-6666-4666-8666-666666666662', clarification: laterClarification },
      ]}
      onSubmit={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '인천 청라와 주변 지역에서 상담할 사람' })).toBeEnabled()
  })

  it.each(['cancelled', 'completed'] as const)('does not revive an earlier question after the latest interview is %s', status => {
    const onSubmit = vi.fn()
    render(<ConversationShell messages={[
      { ...soheeMessage, clarification },
      { ...soheeMessage, id: '66666666-6666-4666-8666-666666666667', clarification: { ...clarification, status } },
    ]} onSubmit={onSubmit} />)
    const answer = screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })
    expect(answer).toBeDisabled()
    fireEvent.click(answer)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps prior questions read-only after a later assistant reply without an interview', () => {
    render(<ConversationShell messages={[
      { ...soheeMessage, clarification },
      { ...soheeMessage, id: '66666666-6666-4666-8666-666666666667', content: '이전 준비는 종료했어요.' },
    ]} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeDisabled()
  })

  it('starts a new conversation from the same suggested command shown in the approved prototype', () => {
    const onSubmit = vi.fn(() => true)

    render(<ConversationShell connectionState="connected" onSubmit={onSubmit} />)

    expect(screen.getByRole('heading', { name: '무엇부터 함께 해볼까요?' })).toBeInTheDocument()
    expect(screen.getByText('가게와 함께하는 소희')).toBeInTheDocument()
    expect(screen.getByText('기획부터 문의 답변까지, 필요한 일을 말씀해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('게시·발송은 검토 후 승인해요').tagName).toBe('SUMMARY')

    const postPlan = screen.getByRole('button', { name: '이번 주 포스팅 기획해줘' })
    expect(screen.getByRole('button', { name: '받은 문의를 예약까지 이어줘' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '지난 게시 성과를 정리해줘' })).toBeInTheDocument()

    fireEvent.click(postPlan)

    expect(onSubmit).toHaveBeenCalledWith({
      attachmentIds: [],
      clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      message: '이번 주 포스팅 기획해줘',
    })
  })

  it('keeps conversation available while explaining the unconnected server boundary honestly', () => {
    render(<ConversationShell onSubmit={vi.fn()} />)

    expect(screen.getByRole('region', { name: '소희와의 대화' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '대화 메시지' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeEnabled()
    expect(screen.getByText('서버 대화 연결 전')).toBeInTheDocument()
    expect(screen.getByText(/현재 입력은 서버에 전송되지 않아요/)).toBeInTheDocument()
  })

  it('renders a generated image draft inside the conversation with its approval boundary', () => {
    const imageUrl = '/api/workspaces/11111111-1111-4111-8111-111111111111/media/77777777-7777-4777-8777-777777777777'
    render(
      <ConversationShell
        messages={[soheeMessage]}
        messageDetails={{
          [soheeMessage.id]: {
            evidence: [],
            artifacts: [{
              id: '77777777-7777-4777-8777-777777777777',
              kind: 'image_draft',
              title: '바이름 인스타그램 이미지 초안',
              href: imageUrl,
              previewUrl: imageUrl,
              statusLabel: '승인 대기',
              requiresConfirmation: true,
            }],
          },
        }}
      />,
    )

    expect(screen.getByRole('img', { name: '바이름 인스타그램 이미지 초안' })).toHaveAttribute('src', imageUrl)
    expect(screen.getByText('승인 대기')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '원본 초안 열기' })).toHaveAttribute('href', imageUrl)
  })

  it('renders the M-01 proactive report as the first connected work surface', () => {
    render(<ConversationShell proactiveReport={proactiveReport} />)

    const report = screen.getByRole('article', { name: '최근 콘텐츠 반응 보고' })
    expect(report).toHaveAttribute('data-v07-screen', 'M-01')
    expect(screen.getByRole('heading', { name: '최근 콘텐츠 반응을 정리했어요.' })).toBeInTheDocument()
    expect(screen.getByText('2026. 8. 3. – 2026. 8. 10.')).toBeInTheDocument()
    expect(screen.getByText('관심 반응').closest('div')).toHaveTextContent('184')
    expect(screen.getByText('유입').closest('div')).toHaveTextContent('23')
    expect(screen.getByText('문의').closest('div')).toHaveTextContent('12')
    expect(screen.getByText('예약').closest('div')).toHaveTextContent('7')
    expect(screen.getByRole('link', { name: '고객 대화 7건' })).toHaveAttribute(
      'href',
      '/app/reports?view=reactions',
    )
    expect(screen.getByRole('link', { name: '리포트 전체 보기' })).toHaveAttribute(
      'href',
      '/app/reports',
    )
    expect(screen.queryByText('대화 화면을 준비했어요.')).not.toBeInTheDocument()
  })

  it('turns a period plan decision into the next conversation message without external execution', () => {
    const onSubmit = vi.fn(() => true)
    render(
      <ConversationShell
        messages={[soheeMessage]}
        messageDetails={{
          [soheeMessage.id]: {
            evidence: [],
            artifacts: [{
              id: '10000000-0000-4000-8000-000000000001',
              kind: 'period_plan',
              requiresConfirmation: true,
              originalRequest: '다음 2주 계획을 만들어줘',
              periodStart: '2026-08-21',
              periodEnd: '2026-09-03',
              timezone: 'Asia/Seoul',
              goal: '신규 상담',
              catalogVersion: 1,
              estimatedCredits: 68,
              expectedRemainingCredits: 56,
              status: 'ready',
              channels: [
                { channel: 'instagram', postCount: 4, imagesPerPost: 3 },
                { channel: 'threads', postCount: 2, imagesPerPost: 0 },
              ],
            }],
          },
        }}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '이 계획으로 시작' }))

    expect(onSubmit).toHaveBeenCalledWith({
      attachmentIds: [],
      clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      message: '기간, 목표, 채널, 작업 수를 확인했어요. 이 계획으로 시작해줘.',
    })
    expect(screen.queryByRole('button', { name: '지금 게시' })).not.toBeInTheDocument()
  })

  it('모바일에서는 같은 기간 계획을 "이 방향으로 진행할게요" 승인 카드로 보여 주고 같은 전송 경로를 쓴다', () => {
    const onSubmit = vi.fn(() => true)
    render(
      <MobileR2Provider enabled forceMobile>
        <ConversationShell
          messages={[soheeMessage]}
          messageDetails={{ [soheeMessage.id]: { evidence: [], artifacts: [{
            id: '10000000-0000-4000-8000-000000000001', kind: 'period_plan', requiresConfirmation: true,
            originalRequest: '다음 2주 계획을 만들어줘', periodStart: '2026-08-21', periodEnd: '2026-09-03', timezone: 'Asia/Seoul',
            goal: '신규 상담', catalogVersion: 1, estimatedCredits: 68, expectedRemainingCredits: 56, status: 'ready',
            channels: [{ channel: 'instagram', postCount: 4, imagesPerPost: 3 }],
          }] } }}
          onSubmit={onSubmit}
        />
      </MobileR2Provider>,
    )
    expect(screen.getByText('이 방향으로 진행할게요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이대로 시작' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ message: '기간, 목표, 채널, 작업 수를 확인했어요. 이 계획으로 시작해줘.' }))
    expect(screen.queryByRole('button', { name: '지금 게시' })).not.toBeInTheDocument()
  })

  it('connects interview card answers to the same composer submit path and disables it while busy', () => {
    const onSubmit = vi.fn(() => true)
    render(
      <ConversationShell
        busy
        messages={[{ ...soheeMessage, clarification }]}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeDisabled()
  })

  it('renders cancel generation as an inline chip above the composer when busy with onCancel', () => {
    const onCancel = vi.fn()
    render(<ConversationShell busy onCancel={onCancel} />)
    const cancelBtn = screen.getByRole('button', { name: '응답 생성 중단' })
    expect(cancelBtn).toBeInTheDocument()
    const composer = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }).closest('form')
    // cancelBtn is before composer in DOM order
    expect(cancelBtn.compareDocumentPosition(composer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
