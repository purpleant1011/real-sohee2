import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  cancelMessageAction: vi.fn(),
  retryMessageAction: vi.fn(),
  saveArtifactToWork: vi.fn(),
  loadConversationPublishing: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace, push: mocks.push }),
}))
vi.mock('./actions/cancel-message', () => ({ cancelMessageAction: mocks.cancelMessageAction }))
vi.mock('./actions/retry-message', () => ({ retryMessageAction: mocks.retryMessageAction }))
vi.mock('@/features/content/actions/save-artifact-to-work', () => ({
  saveArtifactToWork: mocks.saveArtifactToWork,
}))
vi.mock('./actions/load-conversation-publishing', () => ({
  loadConversationPublishingAction: mocks.loadConversationPublishing,
}))
vi.mock('./actions/partial-content-revision', () => ({ partialContentRevisionAction: vi.fn() }))
vi.mock('@/features/approvals/actions/approve-and-dispatch', () => ({ approveAndDispatchAction: vi.fn() }))

import { ConversationClient, parseEvent } from './conversation-client'
import type { TaskTimelineMessageArtifact } from './stream-events'

it('recovers the canonical thread URL after an uncertain first job response and a deduplicated retry', async () => {
  let attempts = 0
  const user = { id: userMessageId, workspaceId, threadId, role: 'user', content: '연결 확인', status: 'completed', workItemId: null, createdAt: '2026-10-29T00:00:00Z', completedAt: '2026-10-29T00:00:00Z' }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.endsWith('/conversations')) return Response.json({ data: { thread, userMessage: user } })
    if (init?.method === 'POST' && url.endsWith('/jobs')) {
      attempts += 1
      if (attempts === 1) throw new TypeError('response lost after queue acceptance')
      return Response.json({ data: { job: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, userMessage: user,
        assistantMessage: { ...user, id: assistantId, role: 'sohee', content: '작업 접수', status: 'queued', completedAt: null } } }, { status: 202 })
    }
    return Response.json({ data: null })
  })
  vi.stubGlobal('fetch', fetchMock)
  const { unmount } = render(<ConversationClient backgroundJobs initialMessages={[]} workspaceId={workspaceId} threadId={null} />)
  fireEvent.change(screen.getByRole('textbox', { name: /메시지/ }), { target: { value: '연결 확인' } })
  fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '메시지 보내기' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
  await waitFor(() => expect(attempts).toBe(2))
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(`/app/conversations/${threadId}`))
  const requests = fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/jobs') && init?.method === 'POST')
  expect(JSON.parse(requests[0][1]!.body as string).clientMessageId).toBe(JSON.parse(requests[1][1]!.body as string).clientMessageId)
  unmount()
})

it('keeps selected work revision requests out of unrelated creation flows', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(<ConversationClient initialMessages={[]} workspaceId="11111111-1111-4111-8111-111111111111" threadId={null}
    workContext={{ workspaceId: '11111111-1111-4111-8111-111111111111', contentId: 'content', versionId: 'version', versionNumber: 3, fingerprint: 'a'.repeat(64), title: '선택 원고', channel: 'threads', summary: '원문', readOnly: true, returnHref: '/app/work/content' }} />)
  fireEvent.change(screen.getByRole('textbox', { name: /메시지/ }), { target: { value: '이 원고 수정해줘' } })
  fireEvent.click(screen.getByRole('button', { name: /메시지 보내기/ }))
  expect(fetchMock).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: /메시지/ })).toHaveValue('이 원고 수정해줘')
  expect(screen.getByRole('link', { name: /원래 원고 화면에서 직접 수정/ })).toHaveAttribute('href', '/app/work/content')
})

it('keeps viewer conversation input and starter actions read-only', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(<ConversationClient readOnly initialMessages={[]} workspaceId="11111111-1111-4111-8111-111111111111" threadId={null} />)
  expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '이번 주 포스팅 기획해줘' })).toBeDisabled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('loads server task progress for a queued background answer using GET only', async () => {
  const timeline: TaskTimelineMessageArtifact = { id: 'server-task', kind: 'task_timeline', title: '저장된 작업 계획', totalSteps: 1, completedSteps: 0,
    steps: [{ id: 'draft', title: '백그라운드 문안 작성', status: 'in_progress' }], isLive: true }
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes('view=tasks')
    ? Response.json({ data: [{ messageId: assistantId, status: 'streaming', timeline }] }) : Response.json({ data: null }))
  vi.stubGlobal('fetch', fetchMock)
  const { unmount } = render(<ConversationClient backgroundJobs workspaceId={workspaceId} threadId={threadId} initialMessages={[{
    id: assistantId, workspaceId, threadId, role: 'sohee', content: '작업 접수', status: 'streaming', workItemId: null,
    createdAt: '2026-10-28T00:00:00Z', completedAt: null,
  }]} />)
  expect(await screen.findByText('백그라운드 문안 작성')).toBeInTheDocument()
  expect(fetchMock.mock.calls.every(call => !(call[1] as RequestInit | undefined)?.method || (call[1] as RequestInit).method === 'GET')).toBe(true)
  unmount()
})

it('keeps foreground stream task progress authoritative over a stale background snapshot', async () => {
  const pending: TaskTimelineMessageArtifact = { id: 'tasks-live', kind: 'task_timeline', title: '응답 작업', totalSteps: 1, completedSteps: 0,
    steps: [{ id: 'answer', title: '답변 작성', status: 'pending' }], isLive: true }
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const send = (event: unknown) => stream.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'POST'
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'content-type': 'application/x-ndjson' } })
    : Response.json({ data: [{ messageId: assistantId, status: 'streaming', timeline: pending }] })))
  const { unmount } = render(<ConversationClient backgroundJobs initialMessages={[]} workspaceId={workspaceId} threadId={threadId} persistenceMode="stateless" />)
  fireEvent.change(screen.getByRole('textbox', { name: /메시지/ }), { target: { value: '가게 정보를 알려줘' } })
  fireEvent.click(screen.getByRole('button', { name: /보내기/ }))
  await waitFor(() => expect(stream).toBeDefined())
  send({ type: 'message.started', messageId: assistantId })
  send({ type: 'task_progress', messageId: assistantId, timeline: pending })
  await screen.findByText('0 / 1 완료')
  await act(async () => { await Promise.resolve() })
  send({ type: 'task_progress', messageId: assistantId, timeline: { ...pending, completedSteps: 1, isLive: false, steps: [{ ...pending.steps[0], status: 'completed' }] } })
  send({ type: 'message.delta', messageId: assistantId, delta: '확인했어요.' })
  send({ type: 'message.completed', messageId: assistantId })
  stream.close()
  expect(await screen.findByText('1 / 1 완료')).toBeInTheDocument()
  expect(screen.queryByText('0 / 1 완료')).not.toBeInTheDocument()
  unmount()
})

it('keeps the latest server task snapshot in the same answer and stops on transport loss', async () => {
  const timeline: TaskTimelineMessageArtifact = { id: 'task-1', kind: 'task_timeline', title: '실제 작업',
    totalSteps: 1, completedSteps: 0, steps: [{ id: 'write', title: '문안 작성 중', status: 'in_progress' }], isLive: true }
  const body = [
    { type: 'message.started', messageId: assistantId },
    { type: 'task_progress', messageId: assistantId, timeline },
  ].map(event => JSON.stringify(event)).join('\n') + '\n'
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'POST'
    ? new Response(body, { headers: { 'content-type': 'application/x-ndjson' } })
    : Response.json({ data: null })))
  render(<ConversationClient initialMessages={[]} workspaceId={workspaceId} threadId={threadId} />)
  fireEvent.change(screen.getByRole('textbox', { name: /메시지/ }), { target: { value: '문안 만들어줘' } })
  fireEvent.click(screen.getByRole('button', { name: /보내기/ }))
  expect(await screen.findByText('문안 작성 중')).toBeInTheDocument()
  expect((await screen.findAllByText('결과 확인 필요')).length).toBeGreaterThan(0)
  expect(screen.queryByText('작업 완료')).not.toBeInTheDocument()
})
import type { M01ProactiveReport } from './proactive-report'
import type { ConversationArtifact, ConversationMessage } from './types'
import type { ContentInterviewView } from './content-interview'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-4222-8222-222222222222'
const assistantId = '33333333-3333-4333-8333-333333333333'
const userMessageId = '44444444-4444-4444-8444-444444444444'
const clarification: ContentInterviewView = {
  kind: 'content_interview',
  status: 'collecting',
  step: 1,
  totalSteps: 4,
  question: '이번 게시물에서 가장 중요하게 얻고 싶은 결과는 무엇인가요?',
  options: [
    { value: 'consultation', label: '상담 문의를 늘리고 싶어요' },
    { value: 'custom', label: '직접 입력할게요' },
  ],
  optionGroups: [],
  previousAnswers: [],
}
const thread = Object.freeze({
  id: threadId,
  workspaceId,
  title: '이번 주 게시물을 제안해줘',
  status: 'active' as const,
  lastMessageAt: '2026-08-14T01:00:00.000Z',
  createdAt: '2026-08-14T01:00:00.000Z',
  updatedAt: '2026-08-14T01:00:00.000Z',
})
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

const artifact: ConversationArtifact = Object.freeze({
  id: '77777777-7777-4777-8777-777777777777',
  workspaceId,
  sourceMessageId: '88888888-8888-4888-8888-888888888888',
  type: 'instagram_post',
  status: 'ready_for_review',
  caption: '자연스러운 눈썹 디자인을 소개합니다.',
  hashtags: Object.freeze(['#눈썹']),
  cta: '상담 전 원하는 분위기를 알려 주세요.',
  disclosure: 'AI 초안이며 게시 전 검토가 필요합니다.',
  observations: Object.freeze([]),
  limitations: Object.freeze([]),
  evidence: Object.freeze([]),
  unresolvedQuestions: Object.freeze([]),
  idempotencyKey: '99999999-9999-4999-8999-999999999999',
  slides: Object.freeze([Object.freeze({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    position: 1,
    role: 'cover',
    status: 'succeeded',
    mediaAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    altText: '눈썹 디자인 표지',
    retryable: false,
    safeErrorCode: null,
  })]),
})

function streamResponse(events: readonly object[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

const messageFetch = vi.fn<typeof fetch>()

describe('ConversationClient', () => {
  it('starts the first Naver request as a content interview without requiring an existing job or goal', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/blog-strategy')) return Response.json({ data: null })
      if (String(url).endsWith('/conversations')) {
        const body = JSON.parse(String(options?.body))
        return Response.json({ data: { thread, userMessage: { id: body.firstMessage.clientMessageId, workspaceId, threadId,
          role: 'user', content: body.firstMessage.content, status: 'completed', workItemId: null,
          createdAt: '2026-10-28T00:00:00Z', completedAt: '2026-10-28T00:00:01Z' } } })
      }
      if (String(url).endsWith('/messages')) return streamResponse([
        { type: 'message.started', messageId: assistantId }, { type: 'message.clarification', messageId: assistantId, clarification },
        { type: 'message.completed', messageId: assistantId },
      ])
      throw new Error('unexpected background job before content questions')
    })
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={null} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '네이버 블로그 글 작성해줘.' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(true))
    expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith('/jobs'))).toBe(true)
    const sent = fetcher.mock.calls.find(([url]) => String(url).endsWith('/messages'))!
    expect(JSON.parse(String(sent[1]?.body)).marketingStrategy).toBeUndefined()
  })

  it('resumes a persisted content question on the foreground route after reentry', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).endsWith('/blog-strategy')
      ? Response.json({ data: null })
      : streamResponse([{ type: 'message.started', messageId: assistantId }, { type: 'message.completed', messageId: assistantId }]))
    render(<ConversationClient backgroundJobs workspaceId={workspaceId} threadId={threadId} initialMessages={[{
      id: assistantId, workspaceId, threadId, role: 'sohee', content: '원고 준비 질문', status: 'completed', workItemId: null,
      createdAt: '2026-10-28T00:00:00Z', completedAt: '2026-10-28T00:00:01Z', clarification,
    }]} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '가게 정보 안내를 준비해요' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url, options]) => options?.method === 'POST')).toBe(true))
    const posted = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(String(posted[0])).toBe(`/api/workspaces/${workspaceId}/conversations/${threadId}/messages`)
    expect(JSON.parse(String(posted[1]?.body)).marketingStrategy).toBeUndefined()
  })

  it('leaves the foreground interview after a durable cancellation reply', async () => {
    let posts = 0
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/blog-strategy')) return Response.json({ data: null })
      if (options?.method === 'POST' && ++posts === 1) return streamResponse([
        { type: 'message.started', messageId: assistantId },
        { type: 'message.clarification', messageId: assistantId, clarification: { ...clarification, status: 'cancelled' } },
        { type: 'message.failed', messageId: assistantId, code: 'CHAT_CANCELLED', message: '원하실 때 같은 대화에서 이어갈 수 있어요.' },
      ])
      return Response.json({ error: { code: 'TEST_STOP_AT_JOB_BOUNDARY' } }, { status: 500 })
    })
    render(<ConversationClient backgroundJobs workspaceId={workspaceId} threadId={threadId} initialMessages={[{
      id: '66666666-6666-4666-8666-666666666666', workspaceId, threadId, role: 'sohee', content: '원고 준비 질문', status: 'completed', workItemId: null,
      createdAt: '2026-10-28T00:00:00Z', completedAt: '2026-10-28T00:00:01Z', clarification,
    }]} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '취소' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(posts).toBe(1))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).not.toBeDisabled())
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '다음 업무를 계획해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(posts).toBe(2))
    expect(String(fetcher.mock.calls.at(-1)![0])).toBe(`/api/workspaces/${workspaceId}/conversations/${threadId}/jobs`)
  })

  it.each([null, '55555555-5555-4555-8555-555555555555'])('preserves input when CHAT_CANCELLED has no matching stored interview clarification: %s', async clarificationMessageId => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).endsWith('/blog-strategy')
      ? Response.json({ data: null })
      : streamResponse([
        { type: 'message.started', messageId: assistantId },
        ...(clarificationMessageId ? [{ type: 'message.clarification', messageId: clarificationMessageId,
          clarification: { ...clarification, status: 'cancelled' } }] : []),
        { type: 'message.failed', messageId: assistantId, code: 'CHAT_CANCELLED', message: '응답 생성을 중단했습니다.' },
      ]))
    render(<ConversationClient backgroundJobs workspaceId={workspaceId} threadId={threadId} initialMessages={[{
      id: assistantId, workspaceId, threadId, role: 'sohee', content: '원고 준비 질문', status: 'completed', workItemId: null,
      createdAt: '2026-10-28T00:00:00Z', completedAt: '2026-10-28T00:00:01Z', clarification,
    }]} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '취소' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('응답 생성을 중단했습니다.')
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('취소')
  })

  it('starts goal-unlinked preparation through the existing foreground interview, not a job or an approved strategy', async () => {
    let requests = 0
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).endsWith('/blog-strategy')) return options?.method === 'GET'
        ? Response.json({ data: null })
        : Response.json({ error: { code: 'MARKETING_STRATEGY_GOAL_REQUIRED' } }, { status: 409 })
      if (!String(url).endsWith('/messages')) throw new Error('unexpected background or business write')
      requests += 1
      return streamResponse([{ type: 'message.started', messageId: assistantId },
        ...(requests === 1 ? [{ type: 'message.clarification', messageId: assistantId, clarification }] : []),
        { type: 'message.completed', messageId: assistantId }])
    })
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    fireEvent.click(await screen.findByRole('button', { name: '목표 없이 원고 준비 질문 시작' }))
    await waitFor(() => expect(requests).toBe(1))
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/messages'))!
    const body = JSON.parse(String(call[1]?.body))
    expect(body.content).toBe('네이버 블로그 글 작성해줘.')
    expect(body.marketingStrategy).toBeUndefined()
    expect(body.marketingStrategyApproval).toBeUndefined()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).not.toBeDisabled())
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '가게 정보 안내를 준비해요' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(requests).toBe(2))
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/messages') || String(url).endsWith('/blog-strategy'))).toBe(true)
  })
  it('opens blog topic decisions in the existing thread instead of enqueueing a replacement run', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ error: { code: 'MARKETING_STRATEGY_FACTS_REQUIRED' } }, { status: 409 }))
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '네이버 블로그 글 작성해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    expect(String(fetcher.mock.calls[0][0])).toBe(`/api/workspaces/${workspaceId}/conversations/${threadId}/blog-strategy`)
    expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith('/jobs'))).toBe(true)
    expect(await screen.findByRole('alert')).toHaveTextContent('승인된 가게 정보')
    fetcher.mockRestore()
  })
  it.each(['2번, 할인 내용 제외', '2번으로 써, 할인 내용 제외'])('saves %s without generation or implicit approval', async text => {
    const proposal = { id: '10000000-0000-4000-8000-000000000001', revision: 1, status: 'proposed', selectedIndex: null,
      goal: { description: '서비스 문의' }, audience: '처음 이용하는 분', constraints: '', unknowns: [],
      topics: ['이용 안내', '상담 준비', '선택 안내'].map(title => ({ title, evidence: ['승인된 사실'], questionSource: 'inferred' })) }
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      if (options?.method === 'GET') return Response.json({ data: null })
      const body = JSON.parse(String(options?.body))
      return Response.json({ data: body.action === 'respond'
        ? { ...proposal, revision: 2, selectedIndex: 1, constraints: '할인 내용 제외' } : proposal })
    })
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.click(screen.getByRole('button', { name: '블로그 주제 정하기' }))
    await screen.findByRole('radio', { name: '상담 준비' })
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(screen.getByRole('radio', { name: '상담 준비' })).toBeChecked())
    expect(screen.getByLabelText('반영할 조건')).toHaveValue('할인 내용 제외')
    expect(screen.getByRole('button', { name: '이 전략 승인' })).toBeDisabled()
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/blog-strategy'))).toBe(true)
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toMatchObject({ action: 'respond', expectedRevision: 1, text })
    fetcher.mockRestore()
  })
  it('sends the approved server reference to messages and keeps interview replies on the same run', async () => {
    const reference = { missionId: '40000000-0000-4000-8000-000000000001', runId: '50000000-0000-4000-8000-000000000001',
      briefId: '10000000-0000-4000-8000-000000000001', revision: 1 }
    const approved = { id: reference.briefId, revision: 3, status: 'approved', reference, selectedIndex: 0,
      goal: { description: '서비스 문의' }, audience: '처음 이용하는 분', constraints: '', unknowns: [],
      topics: ['이용 안내', '상담 준비', '선택 안내'].map(title => ({ title, evidence: ['승인된 사실'], questionSource: 'inferred' })) }
    let messageRequests = 0
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (String(url).endsWith('/blog-strategy')) return Response.json({ data: approved, generationCredits: 30 })
      messageRequests += 1
      return streamResponse([{ type: 'message.started', messageId: assistantId },
        ...(messageRequests === 1 ? [{ type: 'message.clarification', messageId: assistantId, clarification }] : []),
        { type: 'message.completed', messageId: assistantId }])
    })
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.click(await screen.findByRole('button', { name: '승인한 전략으로 원고 준비' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(String(fetcher.mock.calls[1][0])).toBe(`/api/workspaces/${workspaceId}/conversations/${threadId}/messages`)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).marketingStrategy).toEqual(reference)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).not.toBeDisabled())
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '상담 문의를 늘리고 싶어요' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(String(fetcher.mock.calls[2][0])).toBe(`/api/workspaces/${workspaceId}/conversations/${threadId}/messages`)
    expect(fetcher.mock.calls.every(([url]) => !String(url).endsWith('/jobs'))).toBe(true)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).not.toBeDisabled())
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), { target: { value: '다음 업무를 계획해줘' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
    expect(String(fetcher.mock.calls[3][0])).toBe(`/api/workspaces/${workspaceId}/conversations/${threadId}/jobs`)
    fetcher.mockRestore()
  })
  it('shows schedule context and a safe return link without sending a message automatically', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<ConversationClient
      initialMessages={[]}
      scheduleEntryContext={{
        intent: 'review_context',
        returnTo: '/app/schedule?date=2026-08-23',
        scheduleId: '60000000-0000-4000-8000-000000000001',
        contentId: '30000000-0000-4000-8000-000000000001',
        contentVersionId: '40000000-0000-4000-8000-000000000001',
      }}
      threadId={null}
      workspaceId={workspaceId}
    />)

    expect(screen.getByRole('heading', { name: '일정에서 이어온 대화' })).toBeVisible()
    expect(screen.getByRole('link', { name: '일정으로 돌아가기' })).toHaveAttribute(
      'href',
      '/app/schedule?date=2026-08-23',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  it('shows persisted report context without sending a message automatically', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<ConversationClient
      initialMessages={[]}
      reportDecisionContext={{
        id: '60000000-0000-4000-8000-000000000001',
        title: '저장 반응은 늘었지만 문의 전환은 멈췄어요',
        hypothesis: '첫 문장이 관심을 만들었을 가능성이 있어요.',
        changeVariable: 'opening',
        invariants: ['본문 구조'],
        evidenceVersionIds: ['40000000-0000-4000-8000-000000000001'],
      }}
      threadId={null}
      workspaceId={workspaceId}
    />)

    expect(screen.getByRole('heading', { name: '리포트에서 가져온 개선 맥락' })).toBeVisible()
    expect(screen.getByText('첫 메시지는 아직 전송되지 않았어요.')).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.saveArtifactToWork.mockResolvedValue({
      data: {
        artifactId: artifact.id,
        workItemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        contentItemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        versionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        versionNumber: 1,
        next: '/app/work/dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      },
    })
    mocks.loadConversationPublishing.mockResolvedValue({ error: { message: '테스트에서는 게시 상태를 불러오지 않아요.' } })
    messageFetch.mockReset().mockImplementation(async () => streamResponse([
      { type: 'message.started', messageId: assistantId },
      { type: 'message.delta', messageId: assistantId, delta: '첫째, ' },
      { type: 'message.delta', messageId: assistantId, delta: '초안을 검토하세요.' },
      { type: 'message.completed', messageId: assistantId },
    ]))
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
      if (String(url).endsWith('/blog-strategy') && options?.method === 'GET') return Response.json({ data: null })
      return messageFetch(url, options)
    }))
  })

  it('parses pending and clarification events but rejects malformed clarification payloads', () => {
    expect(parseEvent({
      type: 'message.pending',
      messageId: assistantId,
      message: '응답을 준비하고 있어요.',
    })).toEqual({
      type: 'message.pending',
      messageId: assistantId,
      message: '응답을 준비하고 있어요.',
    })
    expect(parseEvent({
      type: 'message.clarification',
      messageId: assistantId,
      clarification,
    })).toEqual(expect.objectContaining({ type: 'message.clarification', clarification }))
    expect(parseEvent({
      type: 'message.clarification',
      messageId: assistantId,
      clarification: null,
    })).toBeNull()
  })

  it('renders an optimistic user message and ordered Sohee stream deltas', async () => {
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '오늘 우선순위를 알려줘' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(screen.getByText('오늘 우선순위를 알려줘')).toBeInTheDocument()
    expect(await screen.findByText('첫째, 초안을 검토하세요.')).toBeInTheDocument()
    expect(screen.getByText('실제 대화 연결됨')).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('uses the native retry path instead of reusing a terminal background job', async () => {
    const original = { id: userMessageId, workspaceId, threadId, role: 'user' as const, content: '원래 질문', status: 'completed' as const,
      workItemId: null, createdAt: '2026-10-30T00:00:00Z', completedAt: '2026-10-30T00:00:00Z' }
    mocks.retryMessageAction.mockResolvedValueOnce({ data: { content: original.content,
      clientMessageId: '60000000-0000-4000-8000-000000000001', retryAssistantMessageId: assistantId } })
    messageFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message.started', messageId: assistantId },
      { type: 'message.delta', messageId: assistantId, delta: '다시 조회했어요.' },
      { type: 'message.completed', messageId: assistantId },
    ]))
    render(<ConversationClient backgroundJobs initialMessages={[original, { ...original, id: assistantId, role: 'sohee', status: 'failed', content: '조회 실패' }]} threadId={threadId} workspaceId={workspaceId} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '응답 다시 시도' })) })
    expect(messageFetch).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/conversations/${threadId}/messages`, expect.objectContaining({ method: 'POST' }))
    expect(messageFetch.mock.calls.some(call => String(call[0]).endsWith('/jobs'))).toBe(false)
    expect(await screen.findByText('다시 조회했어요.')).toBeInTheDocument()
    expect(screen.getAllByText('원래 질문')).toHaveLength(1)
  })

  it('accepts persisted work as a background job without waiting for the provider result', async () => {
    const statusRefresh = vi.fn()
    window.addEventListener('sohee:work-status-refresh', statusRefresh, { once: true })
    messageFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: {
        job: { id: '55555555-5555-4555-8555-555555555555' },
        userMessage: {
          id: userMessageId, workspaceId, threadId, role: 'user', content: '게시물을 만들어줘',
          status: 'completed', workItemId: null, createdAt: '2026-08-22T09:35:28.495Z',
          completedAt: '2026-08-22T09:35:28.495Z',
        },
        assistantMessage: {
          id: assistantId, workspaceId, threadId, role: 'sohee', content: '작업을 준비하고 있습니다.',
          status: 'queued', workItemId: null, createdAt: '2026-08-22T09:35:29.495Z', completedAt: null,
        },
      },
    }), { status: 202, headers: { 'content-type': 'application/json' } }))
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '게시물을 만들어줘' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(messageFetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/conversations/${threadId}/jobs`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(screen.getByText('작업을 준비하고 있습니다.')).toBeInTheDocument()
    expect(screen.getByText('작업을 접수했어요. 실행 순서에 따라 진행하며 다른 대화로 이동해도 상태를 확인할 수 있어요.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeEnabled()
    expect(statusRefresh).toHaveBeenCalledTimes(1)
  })

  it('removes an optimistic user message after the refreshed server message confirms the same client id', async () => {
    const view = render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '바이름의 전문성과 신뢰를 알리고 싶어요' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    const request = messageFetch.mock.calls[0]?.[1]
    const clientMessageId = JSON.parse(String(request?.body)).clientMessageId as string
    const persistedMessage = {
      id: userMessageId,
      clientMessageId,
      workspaceId,
      threadId,
      role: 'user',
      content: '바이름의 전문성과 신뢰를 알리고 싶어요',
      status: 'completed',
      workItemId: null,
      createdAt: '2026-08-22T09:35:28.495Z',
      completedAt: '2026-08-22T09:35:28.495Z',
    } as ConversationMessage

    view.rerender(
      <ConversationClient initialMessages={[persistedMessage]} threadId={threadId} workspaceId={workspaceId} />,
    )

    await waitFor(() => {
      expect(screen.getAllByText('바이름의 전문성과 신뢰를 알리고 싶어요')).toHaveLength(1)
    })
  })

  it('projects a clarification event onto the existing assistant message', async () => {
    messageFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message.started', messageId: assistantId },
      { type: 'message.delta', messageId: assistantId, delta: '방향을 함께 확인할게요.' },
      { type: 'message.clarification', messageId: assistantId, clarification },
      { type: 'message.completed', messageId: assistantId },
    ]))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '인스타 게시물을 기획해줘' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(await screen.findByText('1 / 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '상담 문의를 늘리고 싶어요' })).toBeInTheDocument()
  })

  it.each([
    ['CHAT_SOURCE_PHOTO_REQUIRED', '원본으로 사용할 사진을 먼저 첨부해 주세요. 새 AI 이미지로 대신 만들지 않았어요.'],
    ['CHAT_PHOTO_PLAN_CHANGED', '첨부 사진 수가 검토한 제작안과 달라요. 사용할 사진을 다시 첨부해 새 제작안을 요청해 주세요.'],
    ['CHAT_ATTACHED_MEDIA_COUNT_UNSUPPORTED', '인스타그램·스레드 원본 사진은 한 번에 3장까지 준비할 수 있어요. 사진 수를 줄여 다시 요청해 주세요.'],
  ])('keeps the composer and shows safe photo recovery guidance for %s', async (code, copy) => {
    const messageRequest = vi.fn<typeof fetch>(async () => Response.json({ error: { code } }, { status: 422 }))
    render(<ConversationClient backgroundJobs initialMessages={[]} threadId={threadId} workspaceId={workspaceId} messageRequest={messageRequest} />)
    const input = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(input, { target: { value: '원본 사진으로 인스타그램 게시물 만들어줘' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.queryByText('소희가 확인된 자료를 살펴보고 있어요.')).toBeNull()
    expect(input).toHaveValue('원본 사진으로 인스타그램 게시물 만들어줘')
    expect(screen.queryByText(code)).toBeNull()
    expect(messageRequest).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/conversations/${threadId}/messages`, expect.objectContaining({ method: 'POST' }))
    expect(messageFetch.mock.calls.some(([url]) => String(url).endsWith('/jobs'))).toBe(false)
  })

  it('clears working status after a fact-review failure and keeps its safe guidance', async () => {
    const message = '확인되지 않은 정보가 있어 원고 생성을 멈췄어요. 나의 지식에서 출처를 확인해 주세요.'
    messageFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message.started', messageId: assistantId },
      { type: 'message.failed', messageId: assistantId, code: 'CHAT_FACT_REVIEW_REQUIRED', message },
    ]))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '원고 정보를 확인해줘' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0)
    expect(screen.queryByText('소희가 확인된 자료를 살펴보고 있어요.')).not.toBeInTheDocument()
    expect(screen.queryByText('CHAT_FACT_REVIEW_REQUIRED')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메시지 보내기' })).not.toBeDisabled()
  })

  it('shows a pending replay as a non-terminal status without adding a second assistant message', async () => {
    messageFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message.started', messageId: assistantId },
      { type: 'message.pending', messageId: assistantId, message: '응답을 준비하고 있어요.' },
    ]))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '중복 요청 복구' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(await screen.findByText('처리 중인 응답을 확인하고 있어요')).toBeInTheDocument()
    expect(screen.getAllByRole('article', { name: '소희 메시지' })).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('returns false after a started stream fails so composer text and attachments remain reusable', async () => {
    messageFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { assetId: '30000000-0000-4000-8000-000000000006', rightsStatus: 'confirmed' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(streamResponse([
        { type: 'message.started', messageId: assistantId },
        { type: 'message.failed', messageId: assistantId, code: 'CHAT_PROVIDER_FAILED', message: '응답을 생성하지 못했어요.' },
      ]))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)

    fireEvent.click(screen.getByRole('button', { name: '이미지 첨부 열기' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '첨부 이미지 사용 권리를 확인했습니다' }))
    fireEvent.change(screen.getByLabelText('이미지 첨부'), {
      target: { files: [new File(['image'], 'asset.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(screen.getByText('1장 첨부됨')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '실패해도 보존할 답변' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect((await screen.findAllByText('응답을 생성하지 못했어요.')).length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toHaveValue('실패해도 보존할 답변')
    expect(screen.getByText('1장 첨부됨')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '상담 문의를 늘리고 싶어요' })).not.toBeInTheDocument()
  })

  it('keeps clarification from refresh-shaped initial props when the client is rerendered', async () => {
    const view = render(
      <ConversationClient
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '다음 질문을 확인할게요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
          clarification,
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    view.rerender(
      <ConversationClient
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '다음 질문을 확인할게요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
          clarification: { ...clarification, step: 2 },
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    await waitFor(() => expect(screen.getByText('2 / 4')).toBeInTheDocument())
  })

  it('treats refreshed server props without clarification as authoritative', async () => {
    const view = render(
      <ConversationClient
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '다음 질문을 확인할게요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
          clarification,
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    view.rerender(
      <ConversationClient
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '일반 답변으로 복구됐어요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    await waitFor(() => expect(screen.queryByText('1 / 4')).not.toBeInTheDocument())
  })

  it('creates the unsaved thread on first send and then streams against that thread', async () => {
    messageFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          thread,
          userMessage: {
            id: userMessageId,
            workspaceId,
            threadId,
            role: 'user',
            content: '이번 주 게시물을 제안해줘',
            status: 'completed',
            workItemId: null,
            createdAt: '2026-08-14T01:00:00.000Z',
            completedAt: '2026-08-14T01:00:00.000Z',
          },
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(streamResponse([
        { type: 'message.started', messageId: assistantId },
        { type: 'message.delta', messageId: assistantId, delta: '제안할게요.' },
        { type: 'message.completed', messageId: assistantId },
      ]))
    render(
      <ConversationClient
        canManageThreads
        initialMessages={[]}
        initialThreads={[]}
        threadId={null}
        workspaceId={workspaceId}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '이번 주 게시물을 제안해줘' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(await screen.findByText('제안할게요.')).toBeInTheDocument()
    expect(messageFetch).toHaveBeenNthCalledWith(
      1,
      `/api/workspaces/${workspaceId}/conversations`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(messageFetch).toHaveBeenNthCalledWith(
      2,
      `/api/workspaces/${workspaceId}/conversations/${threadId}/messages`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mocks.replace).toHaveBeenCalledWith(`/app/conversations/${threadId}`)
  })

  it('keeps the first draft when atomic conversation start fails', async () => {
    messageFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'CONVERSATION_CREATE_UNAVAILABLE' },
    }), { status: 503, headers: { 'content-type': 'application/json' } }))
    render(
      <ConversationClient
        canManageThreads
        initialMessages={[]}
        initialThreads={[]}
        threadId={null}
        workspaceId={workspaceId}
      />,
    )
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '입력을 보존해줘' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('입력을 보존했으니 다시 시도해 주세요')
    expect(textbox).toHaveValue('입력을 보존해줘')
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('blocks duplicate submissions while a stream is in progress and offers cancellation', async () => {
    let release: (() => void) | undefined
    messageFetch.mockImplementationOnce(async () => new Promise<Response>((resolve) => {
      release = () => resolve(streamResponse([
        { type: 'message.started', messageId: assistantId },
        { type: 'message.delta', messageId: assistantId, delta: '완료' },
        { type: 'message.completed', messageId: assistantId },
      ]))
    }))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '중복 방지' } })
    fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))

    expect(screen.getByRole('button', { name: '응답 생성 중단' })).toBeInTheDocument()
    expect(textbox).toBeDisabled()
    expect(screen.getByRole('button', { name: '메시지 보내기' })).toBeDisabled()

    await act(async () => release?.())
    await waitFor(() => expect(screen.queryByRole('button', { name: '응답 생성 중단' })).not.toBeInTheDocument())
    expect(messageFetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the input and exposes a safe alert when the request fails before streaming', async () => {
    messageFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'CHAT_UNAVAILABLE' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    const textbox = screen.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    fireEvent.change(textbox, { target: { value: '입력 복구' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('응답을 시작하지 못했습니다')
    expect(textbox).toHaveValue('입력 복구')
  })

  it('labels stateless compatibility without claiming that messages are persisted', async () => {
    render(
      <ConversationClient
        initialMessages={[]}
        persistenceMode="stateless"
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByText('AI 대화 연결됨 · DB 저장 대기')).toBeInTheDocument()
    expect(screen.getByText(/새로고침 후 대화가 유지되지 않아요/)).toBeInTheDocument()
  })

  it('restores a persisted image draft after the conversation page reloads', () => {
    const assetId = '77777777-7777-4777-8777-777777777777'
    render(
      <ConversationClient
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '바이름 이미지 하네스를 적용해 초안을 만들었어요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
          artifact: { type: 'media_asset', id: assetId },
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByRole('img', { name: 'AI 생성 이미지 초안' })).toHaveAttribute(
      'src',
      expect.stringContaining(`/api/workspaces/${workspaceId}/media/${assetId}`),
    )
    expect(screen.getByText('게시 승인 대기')).toBeInTheDocument()
  })

  it('keeps the verified M-01 proactive report visible above persisted conversation messages', () => {
    render(
      <ConversationClient
        initialMessages={[]}
        proactiveReport={proactiveReport}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByRole('article', { name: '최근 콘텐츠 반응 보고' })).toHaveAttribute(
      'data-v07-screen',
      'M-01',
    )
  })

  it('opens the history dialog when client navigation adds the deep-link query', () => {
    const view = render(
      <ConversationClient
        initialMessages={[]}
        initialThreads={[thread]}
        openThreadPanel={false}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.queryByRole('dialog', { name: '과거 대화' })).not.toBeInTheDocument()

    view.rerender(
      <ConversationClient
        initialMessages={[]}
        initialThreads={[thread]}
        openThreadPanel
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByRole('dialog', { name: '과거 대화' })).toBeInTheDocument()
  })

  it('consumes artifact progress and exposes the completed structured result once', async () => {
    messageFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message.started', messageId: assistantId },
      { type: 'message.delta', messageId: assistantId, delta: '초안을 만들었어요.' },
      {
        type: 'artifact_created',
        messageId: assistantId,
        artifactId: artifact.id,
        requestedCount: 1,
      },
      {
        type: 'slide_progress',
        messageId: assistantId,
        slideId: artifact.slides[0].id,
        position: 1,
        status: 'succeeded',
      },
      { type: 'artifact_ready', messageId: assistantId, artifact },
      { type: 'artifact_ready', messageId: assistantId, artifact },
      { type: 'message.completed', messageId: assistantId },
    ]))
    render(<ConversationClient initialMessages={[]} threadId={threadId} workspaceId={workspaceId} />)
    fireEvent.change(screen.getByRole('textbox', { name: '소희에게 메시지 보내기' }), {
      target: { value: '인스타 이미지 한 장 만들어줘' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '메시지 보내기' }))
    })

    expect(await screen.findByText('Instagram 게시물 제안')).toBeInTheDocument()
    expect(screen.getAllByText('Instagram 게시물 제안')).toHaveLength(1)
    expect(screen.getByText('소희가 답변을 완료했어요.')).toBeInTheDocument()
  })

  it('restores structured artifacts from server-loaded refresh data', () => {
    render(
      <ConversationClient
        initialConversationArtifacts={{ [assistantId]: [artifact] }}
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '구조화된 초안을 만들었어요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
          artifacts: [{ type: 'conversation_artifact', id: artifact.id }],
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.getByText('Instagram 게시물 제안')).toBeInTheDocument()
  })

  it('shows a background-generated artifact when router refresh updates the server props', async () => {
    const completedMessage: ConversationMessage = {
      id: assistantId,
      workspaceId,
      threadId,
      role: 'sohee',
      content: '채널에 실제로 올라갈 결과물을 준비했어요.',
      status: 'completed',
      workItemId: null,
      createdAt: '2026-08-10T01:00:00.000Z',
      completedAt: '2026-08-10T01:01:00.000Z',
      artifacts: [{ type: 'conversation_artifact', id: artifact.id }],
    }
    const view = render(
      <ConversationClient
        initialMessages={[completedMessage]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(screen.queryByText('Instagram 게시물 제안')).not.toBeInTheDocument()

    view.rerender(
      <ConversationClient
        initialConversationArtifacts={{ [assistantId]: [artifact] }}
        initialMessages={[completedMessage]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    expect(await screen.findByText('Instagram 게시물 제안')).toBeInTheDocument()
  })

  it('replaces failed images in the same artifact without creating chat messages', async () => {
    const failedSlideId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
    const partialArtifact: ConversationArtifact = Object.freeze({
      ...artifact,
      status: 'partial',
      slides: Object.freeze([
        artifact.slides[0],
        Object.freeze({
          id: failedSlideId,
          position: 2,
          role: 'action',
          status: 'failed',
          mediaAssetId: null,
          altText: '',
          retryable: true,
          safeErrorCode: 'IMAGE_RETRYABLE',
        }),
      ]),
    })
    const completedArtifact = Object.freeze({
      ...partialArtifact,
      status: 'ready_for_review' as const,
      slides: Object.freeze([
        partialArtifact.slides[0],
        Object.freeze({
          ...partialArtifact.slides[1],
          status: 'succeeded' as const,
          mediaAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          altText: '다시 생성된 눈썹 이미지',
          retryable: false,
          safeErrorCode: null,
        }),
      ]),
    })
    messageFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { artifact: completedArtifact } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    render(
      <ConversationClient
        initialConversationArtifacts={{ [assistantId]: [partialArtifact] }}
        initialMessages={[{
          id: assistantId,
          workspaceId,
          threadId,
          role: 'sohee',
          content: '이미지 일부를 만들었어요.',
          status: 'completed',
          workItemId: null,
          createdAt: '2026-08-10T01:00:00.000Z',
          completedAt: '2026-08-10T01:01:00.000Z',
          artifacts: [{ type: 'conversation_artifact', id: partialArtifact.id }],
        }]}
        threadId={threadId}
        workspaceId={workspaceId}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '실패 이미지 1장 한 번에 다시 생성' }))
    })

    expect(messageFetch).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/conversations/${threadId}/artifacts/${partialArtifact.id}/retry-slide`,
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    )
    const request = JSON.parse(messageFetch.mock.calls[0]?.[1]?.body as string)
    expect(request).toMatchObject({
      replyToMessageId: assistantId,
      slideId: failedSlideId,
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(screen.queryByText('실패한 이미지만 다시 만들어줘')).not.toBeInTheDocument()
    expect(await screen.findByRole('img', { name: '다시 생성된 눈썹 이미지' })).toBeInTheDocument()
  })

  it('reports the safe provider reason when a retried image remains failed', async () => {
    const failedSlideId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac'
    const failedArtifact: ConversationArtifact = Object.freeze({
      ...artifact,
      status: 'failed',
      slides: Object.freeze([{ ...artifact.slides[0], id: failedSlideId, status: 'failed' as const, mediaAssetId: null, altText: '', retryable: false, safeErrorCode: 'IMAGE_QUOTA_EXHAUSTED' as const }]),
    })
    messageFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { artifact: failedArtifact } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    render(<ConversationClient
      initialConversationArtifacts={{ [assistantId]: [{ ...failedArtifact, slides: [{ ...failedArtifact.slides[0], status: 'failed' as const, retryable: true, safeErrorCode: 'IMAGE_RETRYABLE' as const }] }] }}
      initialMessages={[{
        id: assistantId, workspaceId, threadId, role: 'sohee', content: '이미지를 다시 확인해 주세요.', status: 'completed', workItemId: null,
        createdAt: '2026-08-10T01:00:00.000Z', completedAt: '2026-08-10T01:01:00.000Z', artifacts: [{ type: 'conversation_artifact', id: failedArtifact.id }],
      }]}
      threadId={threadId}
      workspaceId={workspaceId}
    />)

    fireEvent.click(screen.getByRole('button', { name: '실패 이미지 1장 한 번에 다시 생성' }))

    expect(await screen.findByRole('status')).toHaveTextContent('이미지 생성이 중단되었어요. 완료된 이미지는 그대로 보존했습니다.')
  })
})
