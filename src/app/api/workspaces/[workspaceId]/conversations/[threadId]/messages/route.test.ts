import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatProvider } from '@/lib/providers/chat-provider'
import type { ConversationArtifact, ConversationMessage } from '@/features/chat/types'
import {
  advanceContentInterview,
  createInitialContentInterview,
  serializeContentInterviewControl,
  type ContentInterviewState,
} from '@/features/chat/content-interview'
import {
  createMessagesPostHandler,
  productionMessagesDependencies,
  type MessagesRouteDependencies,
} from './route'
import {
  postRequestFromInterviewState,
  withoutManualOnlyChannels,
} from '@/features/chat/conversation-post-intent'

const recoveryMock = vi.hoisted(() => ({ handle: vi.fn() }))
vi.mock('@/features/booking-recovery/conversation-adapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/booking-recovery/conversation-adapter')>(),
  handleRecoveryConversation: recoveryMock.handle,
}))
vi.mock('@/features/booking-recovery/production', () => ({ createProductionBookingRecoveryService: () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({}) }))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const threadId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const clientMessageId = '44444444-4444-4444-8444-444444444444'
const userMessageId = '55555555-5555-4555-8555-555555555555'
const soheeMessageId = '66666666-6666-4666-8666-666666666666'
const conversationArtifactId = '77777777-7777-4777-8777-777777777777'
const selectedSlideId = '88888888-8888-4888-8888-888888888882'

const conversationArtifact: ConversationArtifact = Object.freeze({
  id: conversationArtifactId,
  workspaceId,
  sourceMessageId: userMessageId,
  type: 'instagram_post',
  status: 'ready_for_review',
  caption: '자연스러운 눈썹 디자인을 소개합니다.',
  hashtags: Object.freeze(['#눈썹']),
  cta: '상담 전 원하는 분위기를 알려 주세요.',
  disclosure: 'AI 초안이며 게시 전 검토가 필요합니다.',
  observations: Object.freeze(['자연스러운 결과를 요청했습니다.']),
  limitations: Object.freeze([]),
  evidence: Object.freeze(['현재 작업공간의 브랜드 말투']),
  unresolvedQuestions: Object.freeze([]),
  idempotencyKey: clientMessageId,
  slides: Object.freeze([
    Object.freeze({
      id: '88888888-8888-4888-8888-888888888881',
      position: 1,
      role: 'cover',
      status: 'succeeded',
      mediaAssetId: '99999999-9999-4999-8999-999999999991',
      altText: '눈썹 디자인 표지',
      retryable: false,
      safeErrorCode: null,
    }),
    Object.freeze({
      id: selectedSlideId,
      position: 2,
      role: 'action',
      status: 'succeeded',
      mediaAssetId: '99999999-9999-4999-8999-999999999992',
      altText: '상담 행동 유도',
      retryable: false,
      safeErrorCode: null,
    }),
  ]),
})

const userMessage: ConversationMessage = {
  id: userMessageId,
  workspaceId,
  threadId,
  role: 'user',
  content: '오늘 우선순위를 알려줘',
  status: 'completed',
  workItemId: null,
  createdAt: '2026-08-10T01:00:00.000Z',
  completedAt: '2026-08-10T01:00:00.000Z',
}

const soheeMessage: ConversationMessage = {
  ...userMessage,
  id: soheeMessageId,
  role: 'sohee',
  content: '응답을 준비하고 있습니다.',
  status: 'streaming',
  completedAt: null,
}

const context = {
  workspace: { id: workspaceId, name: '소희 테스트', timezone: 'Asia/Seoul' },
  approvedFacts: [],
  activeHarnessRules: [],
  currentWork: [],
  currentSchedules: [],
  recentMessages: [userMessage],
} as const

function provider(events: readonly object[]): ChatProvider {
  return {
    mode: 'openai',
    async *stream() {
      for (const event of events) yield event as never
    },
  }
}

function dependencies(overrides: Partial<MessagesRouteDependencies> = {}): MessagesRouteDependencies {
  const createAssistantMessage = overrides.createAssistantMessage ?? vi.fn(async () => soheeMessage)
  const createAssistantMessageAtomic = overrides.createAssistantMessageAtomic ?? vi.fn(async (input) => ({
    message: await createAssistantMessage(input),
    created: true,
  }))
  return {
    prepareRetry: vi.fn(async () => ({ attachmentIds: [] })),
    authenticate: vi.fn(async () => userId),
    authorizeThread: vi.fn(async () => true),
    createUserMessage: vi.fn(async () => ({ message: userMessage, created: true })),
    findAssistantReply: vi.fn(async () => null),
    findLatestContentInterview: vi.fn(async () => null),
    validateInterviewAttachments: vi.fn(async ({ attachmentIds }) => attachmentIds),
    createAssistantMessage,
    createAssistantMessageAtomic,
    buildContext: vi.fn(async () => context),
    createProvider: vi.fn(() => ({
      model: 'gpt-5.6-luna',
      provider: provider([
        { type: 'text.delta', delta: '첫째, ' },
        { type: 'text.delta', delta: '초안을 검토하세요.' },
        { type: 'completed' },
      ]),
    })),
    finalizeAssistantMessage: vi.fn(async () => undefined),
    forceFinalizeAssistantMessage: vi.fn(async () => undefined),
    saveEvidence: vi.fn(async () => undefined),
    ...overrides,
  }
}

function collectingInterview(): ContentInterviewState {
  let state = createInitialContentInterview({
    originalPrompt: '인스타 게시물 만들어줘',
    channels: ['instagram'],
    requestedImageCounts: { instagram: 3 },
    referenceMediaIds: [],
  })
  state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
  return state
}

function interviewReadyAfterThreeAnswers(): ContentInterviewState {
  let state = createInitialContentInterview({
    originalPrompt: '네이버 블로그 게시물 만들어줘',
    channels: ['naver_blog'],
    requestedImageCounts: { naver_blog: 1 },
    referenceMediaIds: [],
  })
  state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
  state = advanceContentInterview(state, { value: 'local', source: 'option' })
  return advanceContentInterview(state, { value: 'empathy_info_consult', source: 'option' })
}

function interviewReadyWithReferenceMedia(): ContentInterviewState {
  const state = interviewReadyAfterThreeAnswers()
  return Object.freeze({
    ...state,
    referenceMediaIds: Object.freeze(['60000000-0000-4000-8000-000000000001']),
  })
}

function interviewReadyState(): ContentInterviewState {
  return advanceContentInterview(interviewReadyAfterThreeAnswers(), {
    image: { value: 'detail', source: 'option' },
    callToAction: { value: 'consult', source: 'option' },
  })
}

function request(body: unknown = {
  content: '오늘 우선순위를 알려줘',
  clientMessageId,
  attachmentIds: [],
}) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/conversations/${threadId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const routeContext = { params: Promise.resolve({ workspaceId, threadId }) }

describe('POST conversation messages', () => {
  it('rejects an unresolved background retry before any intake or provider call, including direct POST', async () => {
    const deps = dependencies({ prepareRetry: async () => { throw new Error('CHAT_RETRY_RECONCILIATION_REQUIRED') } })
    const response = await createMessagesPostHandler(deps)(request({ content: '다시 확인해줘', clientMessageId, attachmentIds: [], retryAssistantMessageId: soheeMessageId }), routeContext)
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('CHAT_RETRY_RECONCILIATION_REQUIRED')
    expect(deps.createUserMessage).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })
  it('uses persisted retry attachments instead of accepting a dropped or substituted client list', async () => {
    const prepareRetry = vi.fn(async () => ({ attachmentIds: [selectedSlideId] }))
    const validateInterviewAttachments = vi.fn(async ({ attachmentIds }) => attachmentIds)
    const deps = dependencies({ prepareRetry, validateInterviewAttachments })
    const response = await createMessagesPostHandler(deps)(request({ content: '네이버 블로그 글 작성해줘', clientMessageId, attachmentIds: [], retryAssistantMessageId: soheeMessageId }), routeContext)
    await response.text()
    expect(prepareRetry).toHaveBeenCalledWith({ workspaceId, threadId, assistantMessageId: soheeMessageId, clientMessageId })
    expect(validateInterviewAttachments).toHaveBeenCalledWith({ workspaceId, attachmentIds: [selectedSlideId] })
  })
  it('does not promote a viewer into a booking recovery owner', async () => {
    recoveryMock.handle.mockReset().mockResolvedValue({ type: 'recovery.empty', message: '조회 결과 없음' })
    const deps = dependencies({ resolveActorRole: async () => 'viewer' })
    const response = await createMessagesPostHandler(deps)(request({ content: '미응답 예약 문의 회수해줘', clientMessageId, attachmentIds: [] }), routeContext)
    expect(response.status).toBe(403)
    expect(recoveryMock.handle).not.toHaveBeenCalled()
  })
  it('claims the assistant before recovery and preserves the actual manager role', async () => {
    const order: string[] = []
    recoveryMock.handle.mockReset().mockImplementation(async () => { order.push('domain'); return { type: 'recovery.empty', message: '조회 결과 없음' } })
    const deps = dependencies({ resolveActorRole: async () => 'manager', createAssistantMessageAtomic: async () => {
      order.push('claim'); return { message: soheeMessage, created: true }
    } })
    const response = await createMessagesPostHandler(deps)(request({ content: '미응답 예약 문의 회수해줘', clientMessageId, attachmentIds: [] }), routeContext)
    await response.text()
    expect(order).toEqual(['claim', 'domain'])
    expect(recoveryMock.handle).toHaveBeenCalledWith(expect.objectContaining({ actor: { workspaceId, userId, role: 'manager' } }), expect.anything())
  })
  it('does not call a recovery domain when another request already claimed the assistant', async () => {
    recoveryMock.handle.mockReset().mockResolvedValue({ type: 'recovery.empty', message: '조회 결과 없음' })
    const deps = dependencies({ resolveActorRole: async () => 'owner', createAssistantMessageAtomic: async () => ({ message: { ...soheeMessage, status: 'completed' }, created: false }) })
    const response = await createMessagesPostHandler(deps)(request({ content: '미응답 예약 문의 회수해줘', clientMessageId, attachmentIds: [] }), routeContext)
    await response.text()
    expect(recoveryMock.handle).not.toHaveBeenCalled()
  })

  it('rejects stale or foreign selected work before creating a provider or message', async () => {
    const deps = dependencies({ resolveWorkRef: async () => null })
    const response = await createMessagesPostHandler(deps)(request({ content: '이 원고 내용 알려줘', clientMessageId, attachmentIds: [], workRef: conversationArtifactId }), routeContext)
    expect(response.status).toBe(409)
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.createUserMessage).not.toHaveBeenCalled()
  })
  it('does not convert a selected draft revision into a new unrelated generation', async () => {
    const deps = dependencies({ resolveWorkRef: async () => ({ workspaceId, contentId: conversationArtifactId, versionId: selectedSlideId, versionNumber: 3, fingerprint: 'a'.repeat(64), title: '선택 원고', channel: 'threads', summary: '원문', readOnly: true, returnHref: `/app/work/${conversationArtifactId}` }) })
    const response = await createMessagesPostHandler(deps)(request({ content: '이 원고 수정해줘', clientMessageId, attachmentIds: [], workRef: selectedSlideId }), routeContext)
    expect(response.status).toBe(409)
    expect(deps.createProvider).not.toHaveBeenCalled()
  })
  it('passes only the server-resolved selected version to read-only context', async () => {
    const selected = { workspaceId, contentId: conversationArtifactId, versionId: selectedSlideId, versionNumber: 3, fingerprint: 'a'.repeat(64), title: '선택 원고', channel: 'threads', summary: '원문', readOnly: true as const, returnHref: `/app/work/${conversationArtifactId}` }
    const stream = vi.fn(async function* (input: { context: { selectedContent?: unknown } }) {
      expect(input.context.selectedContent).toEqual(selected)
      yield { type: 'text.delta' as const, delta: '선택 원고의 내용이에요.' }
    })
    const deps = dependencies({ resolveWorkRef: async () => selected, createProvider: () => ({ model: 'test', provider: { mode: 'openai', stream } }) })
    const response = await createMessagesPostHandler(deps)(request({ content: '이 원고 내용 알려줘', clientMessageId, attachmentIds: [], workRef: selectedSlideId }), routeContext)
    await response.text()
    expect(response.status).toBe(200)
    expect(stream).toHaveBeenCalledOnce()
  })

  it('streams actual work boundaries and marks storage complete only after finalization', async () => {
    const deps = dependencies()
    const response = await createMessagesPostHandler(deps)(request(), routeContext)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    const tasks = events.filter(event => event.type === 'task_progress')
    expect(tasks.length).toBeGreaterThan(2)
    expect(tasks[0].timeline.steps[0].status).toBe('pending')
    expect(tasks[1].timeline.steps[0].status).toBe('in_progress')
    expect(tasks.at(-1).timeline).toMatchObject({ isLive: false, completedSteps: 2 })
    expect(deps.finalizeAssistantMessage).toHaveBeenCalled()
  })
  it('keeps failed model work failed without marking unexecuted steps complete', async () => {
    const deps = dependencies({ createProvider: () => ({ model: 'test', provider: { mode: 'openai',
      async *stream() { yield { type: 'text.delta', delta: '일부 응답' } as never; throw new Error('private error') } } }) })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    const latest = events.filter(event => event.type === 'task_progress').at(-1)
    expect(latest?.timeline).toMatchObject({ isLive: false, completedSteps: 0, steps: [{ status: 'failed' }, { status: 'pending' }] })
    expect(JSON.stringify(latest)).not.toContain('private error')
  })
  const strategyRef = { missionId: '40000000-0000-4000-8000-000000000001', runId: '50000000-0000-4000-8000-000000000001',
    briefId: '10000000-0000-4000-8000-000000000001', revision: 2 }

  it('passes a server-resolved strategy to the Naver generator, not client strategy JSON', async () => {
    const { marketingStrategyFixture } = await import('@/features/content/blog-strategy-brief.fixture')
    const strategy = { brief: { ...marketingStrategyFixture, workspaceId,
      lineage: { conversationId: threadId, missionId: strategyRef.missionId, runId: strategyRef.runId } },
      datasetMode: 'ACTUAL' as const, lineage: { conversationId: threadId, missionId: strategyRef.missionId, runId: strategyRef.runId } }
    let received: unknown
    const deps = dependencies({
      loadMarketingStrategy: async () => strategy,
      createConversationArtifact: async (input) => { received = input.marketingStrategy; return conversationArtifact },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '네이버 블로그 게시물 1건을 제목과 본문, 이미지 1장으로 만들어줘.',
      clientMessageId, attachmentIds: [], retryAssistantMessageId: soheeMessageId, marketingStrategy: strategyRef,
    }), routeContext)
    await response.text()
    expect(response.status).toBe(200)
    expect(received).toEqual(strategy)
  })

  it('fails closed before credit/provider/message writes if a strategy cannot be verified', async () => {
    const deps = dependencies({ loadMarketingStrategy: async () => { throw new Error('stale') } })
    const response = await createMessagesPostHandler(deps)(request({ content: '네이버 블로그 게시물 만들어줘',
      clientMessageId, attachmentIds: [], marketingStrategy: strategyRef }), routeContext)
    expect(response.status).toBe(409)
    expect(deps.createUserMessage).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('handles explicit owner strategy approval through the authenticated conversation API without generation', async () => {
    const { marketingStrategyFixture } = await import('@/features/content/blog-strategy-brief.fixture')
    const deps = dependencies({ approveMarketingStrategy: async () => marketingStrategyFixture })
    const response = await createMessagesPostHandler(deps)(request({ content: '전략 승인', clientMessageId, attachmentIds: [],
      marketingStrategyApproval: { missionId: strategyRef.missionId, runId: strategyRef.runId,
        expectedRevision: 0, brief: marketingStrategyFixture } }), routeContext)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ strategy: { briefId: strategyRef.briefId, revision: 2 } })
    expect(deps.createUserMessage).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('preserves strategy references in the persisted interview and reloads them at explicit generation', async () => {
    const { marketingStrategyFixture } = await import('@/features/content/blog-strategy-brief.fixture')
    const strategy = { brief: marketingStrategyFixture, datasetMode: 'ACTUAL' as const, lineage: marketingStrategyFixture.lineage }
    const loadMarketingStrategy = vi.fn(async () => strategy)
    const first = dependencies({ loadMarketingStrategy })
    const initial = await createMessagesPostHandler(first)(request({ content: '네이버 블로그 게시물 만들어줘',
      clientMessageId, attachmentIds: [], marketingStrategy: strategyRef }), routeContext)
    await initial.text()
    expect(first.createAssistantMessageAtomic).toHaveBeenCalledWith(expect.objectContaining({ usageMetadata: {
      soheeConversationInterview: expect.objectContaining({ marketingStrategy: strategyRef }),
    } }))
    let received: unknown
    const ready = { ...interviewReadyState(), marketingStrategy: strategyRef }
    const second = dependencies({ loadMarketingStrategy,
      findLatestReadyContentInterview: async () => ({ messageId: soheeMessageId, userMessageId, state: ready }),
      createConversationArtifact: async (input) => { received = input.marketingStrategy; return conversationArtifact },
    })
    const generated = await createMessagesPostHandler(second)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }), clientMessageId, attachmentIds: [],
    }), routeContext)
    await generated.text()
    expect(received).toEqual(strategy)
    expect(loadMarketingStrategy).toHaveBeenCalledTimes(2)
  })

  it('blocks an inherited stale strategy before reserving generation credit', async () => {
    const reserveChatTurn = vi.fn()
    const deps = dependencies({ loadMarketingStrategy: async () => { throw new Error('stale') },
      findLatestReadyContentInterview: async () => ({ messageId: soheeMessageId, userMessageId,
        state: { ...interviewReadyState(), marketingStrategy: strategyRef } }),
      credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }), clientMessageId, attachmentIds: [],
    }), routeContext)
    expect(response.status).toBe(409)
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('cannot switch strategy revision behind an existing reviewed interview', async () => {
    const { marketingStrategyFixture } = await import('@/features/content/blog-strategy-brief.fixture')
    const reserveChatTurn = vi.fn()
    const deps = dependencies({ loadMarketingStrategy: async () => ({ brief: marketingStrategyFixture,
      datasetMode: 'ACTUAL', lineage: marketingStrategyFixture.lineage }),
      findLatestReadyContentInterview: async () => ({ messageId: soheeMessageId, userMessageId,
        state: { ...interviewReadyState(), marketingStrategy: strategyRef } }),
      credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }), clientMessageId, attachmentIds: [],
      marketingStrategy: { ...strategyRef, revision: 3 },
    }), routeContext)
    expect(response.status).toBe(409)
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('rejects a non-Naver strategy operation before any paid generation', async () => {
    const { marketingStrategyFixture } = await import('@/features/content/blog-strategy-brief.fixture')
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({ loadMarketingStrategy: async () => ({ brief: marketingStrategyFixture,
      datasetMode: 'ACTUAL', lineage: marketingStrategyFixture.lineage }),
      credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() },
    })
    const response = await createMessagesPostHandler(deps)(request({ content: '인스타 게시물 만들어줘',
      clientMessageId, attachmentIds: [], marketingStrategy: strategyRef }), routeContext)
    expect(response.status).toBe(422)
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('stores friendly display content while using the structured interview payload for state changes', async () => {
    const createUserMessage = vi.fn(async (input) => ({
      message: { ...userMessage, content: input.content },
      created: true,
    }))
    const handler = createMessagesPostHandler(dependencies({
      createUserMessage,
      findLatestContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: collectingInterview(),
      })),
    }))
    const response = await handler(request({
      content: JSON.stringify({ value: 'local', source: 'option' }),
      displayContent: '인천 청라와 주변 지역에서 상담할 사람',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    expect(response.status).toBe(200)
    expect(createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: '인천 청라와 주변 지역에서 상담할 사람',
    }))
  })
  it('starts goal-unlinked Naver questions without reusing an old strategy, charging or generating', async () => {
    const loadMarketingStrategy = vi.fn()
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({
      loadMarketingStrategy, createConversationArtifact,
      findLatestReadyContentInterview: async () => ({ messageId: soheeMessageId, userMessageId,
        state: { ...interviewReadyState(), marketingStrategy: strategyRef } }),
      credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() },
    })
    const response = await createMessagesPostHandler(deps)(request({ content: '네이버 블로그 글 작성해줘.', clientMessageId, attachmentIds: [] }), routeContext)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    expect(response.status).toBe(200)
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.clarification', clarification: expect.objectContaining({ step: 1, status: 'collecting' }) }))
    expect(loadMarketingStrategy).not.toHaveBeenCalled()
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('holds the fourth answer at ready_to_generate review without credit, provider, or artifact work', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyAfterThreeAnswers(),
      })),
      createConversationArtifact,
      credits: { reserveChatTurn, settleChatTurn: vi.fn(async () => undefined), releaseChatTurn: vi.fn(async () => undefined) },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '{"value":"custom","customText":"이미지는 차분하게 보여 주세요.","source":"free_text"}',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.clarification',
      clarification: expect.objectContaining({ status: 'ready_to_generate' }),
    }))
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('질문 생략은 기존 생성·과금 경로로 결과 카드를 만들고 이전 질문을 종료한다', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const retireContentInterview = vi.fn(async () => true)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({
      findLatestContentInterview: async () => ({ messageId: soheeMessageId, userMessageId, state: interviewReadyAfterThreeAnswers() }),
      createConversationArtifact, retireContentInterview,
      credits: { reserveChatTurn, settleChatTurn: vi.fn(async () => undefined), releaseChatTurn: vi.fn(async () => undefined) },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'quick_generate' }), clientMessageId, attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    expect(createConversationArtifact).toHaveBeenCalledTimes(1)
    expect(reserveChatTurn).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(expect.objectContaining({ type: 'artifact_ready' }))
    expect(retireContentInterview).toHaveBeenCalledWith({ workspaceId, messageId: soheeMessageId })
  })

  it('starts generation only after the explicit review control', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyState(),
      })),
      createConversationArtifact,
      credits: { reserveChatTurn, settleChatTurn: vi.fn(async () => undefined), releaseChatTurn: vi.fn(async () => undefined) },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(createConversationArtifact).toHaveBeenCalledTimes(1)
    expect(reserveChatTurn).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(expect.objectContaining({ type: 'artifact_ready' }))
  })

  it('uses the reviewed interview image count instead of reparsing a vague image-style phrase as one image', async () => {
    let state = createInitialContentInterview({
      originalPrompt: '인스타그램 포스팅을 만들고 이미지 스타일 선택 화면도 보여줘.',
      channels: ['instagram'],
      requestedImageCounts: { instagram: 3 },
      referenceMediaIds: [],
    })
    state = advanceContentInterview(state, { value: 'expertise', source: 'option' })
    state = advanceContentInterview(state, { value: 'natural_design', source: 'option' })
    state = advanceContentInterview(state, { value: 'expertise_story', source: 'option' })
    state = advanceContentInterview(state, {
      image: { value: 'design_consult', source: 'option' },
      callToAction: { value: 'consult', source: 'option' },
    })
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state,
      })),
      createConversationArtifact,
    })

    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    expect(state.status).toBe('ready_to_generate')
    expect(response.status).toBe(200)
    await response.text()
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'instagram',
      count: 3,
    }))
  })

  it('prefers the ready review over a stale collecting message when generation starts', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({
        messageId: '66666666-6666-4666-8666-666666666661',
        userMessageId,
        state: interviewReadyAfterThreeAnswers(),
      })),
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyState(),
      })),
      completeContentInterview: vi.fn(async () => ({ ...interviewReadyState(), status: 'completed' as const })),
      createConversationArtifact,
    })

    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      displayContent: '이 방향으로 제작 시작',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(createConversationArtifact).toHaveBeenCalledTimes(1)
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      contentBrief: expect.objectContaining({ imageDirection: expect.objectContaining({ mood: { value: 'detail' } }) }),
    }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'artifact_ready' }))
  })

  it('prefers the ready review over a stale collecting message when an earlier step is edited', async () => {
    const retireContentInterview = vi.fn(async () => true)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({
        messageId: '66666666-6666-4666-8666-666666666661',
        userMessageId,
        state: interviewReadyAfterThreeAnswers(),
      })),
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyState(),
      })),
      retireContentInterview,
    })

    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'edit', step: 2 }),
      displayContent: '2단계 답변 수정',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(retireContentInterview).toHaveBeenCalledWith({ workspaceId, messageId: soheeMessageId })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.clarification',
      clarification: expect.objectContaining({ status: 'collecting', step: 2 }),
    }))
  })

  it('moves a reviewed interview back to the selected collecting step without generating', async () => {
    const createConversationArtifact = vi.fn()
    const retireContentInterview = vi.fn(async () => true)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyState(),
      })),
      createConversationArtifact,
      retireContentInterview,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'edit', step: 2 }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.clarification',
      clarification: expect.objectContaining({ status: 'collecting', step: 2 }),
    }))
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(retireContentInterview).toHaveBeenCalledWith({ workspaceId, messageId: soheeMessageId })
  })

  it('replays a pending event when the atomic assistant boundary reports an existing stream', async () => {
    const createAssistantMessageAtomic = vi.fn(async () => ({ message: soheeMessage, created: false }))
    const deps = Object.assign(dependencies(), { createAssistantMessageAtomic }) as MessagesRouteDependencies
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 게시물 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.pending', messageId: soheeMessageId }))
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(createAssistantMessageAtomic).toHaveBeenCalledTimes(1)
  })

  it('concurrent first questions create one assistant and only one question stream', async () => {
    let atomicCalls = 0
    const createAssistantMessageAtomic = vi.fn(async () => {
      atomicCalls += 1
      const created = atomicCalls === 1
      if (created) await Promise.resolve()
      return { message: soheeMessage, created }
    })
    const deps = Object.assign(dependencies(), { createAssistantMessageAtomic }) as MessagesRouteDependencies
    const handler = createMessagesPostHandler(deps)
    const responses = await Promise.all([
      handler(request({ content: '인스타 게시물 만들어줘', clientMessageId, attachmentIds: [] }), routeContext),
      handler(request({ content: '인스타 게시물 만들어줘', clientMessageId, attachmentIds: [] }), routeContext),
    ])
    const events = await Promise.all(responses.map(async (response) => (
      (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    )))

    expect(createAssistantMessageAtomic).toHaveBeenCalledTimes(2)
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledTimes(1)
    expect(events.flat().filter((event) => event.type === 'message.clarification')).toHaveLength(1)
    expect(events.flat().filter((event) => event.type === 'message.pending')).toHaveLength(1)
  })

  it('concurrent fourth answers create one ready review assistant without generation side effects', async () => {
    let atomicCalls = 0
    const createAssistantMessageAtomic = vi.fn(async () => {
      atomicCalls += 1
      const created = atomicCalls === 1
      if (created) await Promise.resolve()
      return { message: soheeMessage, created }
    })
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const settleChatTurn = vi.fn(async () => undefined)
    const releaseChatTurn = vi.fn(async () => undefined)
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const ready = interviewReadyAfterThreeAnswers()
    const deps = Object.assign(dependencies({
      findLatestContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: ready })),
      createConversationArtifact,
      credits: { reserveChatTurn, settleChatTurn, releaseChatTurn },
    }), { createAssistantMessageAtomic }) as MessagesRouteDependencies
    const handler = createMessagesPostHandler(deps)
    const body = {
      content: '저장하거나 나중에 다시 참고하기',
      clientMessageId,
      attachmentIds: [],
    }
    const responses = await Promise.all([handler(request(body), routeContext), handler(request(body), routeContext)])
    const events = await Promise.all(responses.map(async (response) => (
      (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    )))

    expect(createAssistantMessageAtomic).toHaveBeenCalledTimes(2)
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
    expect(settleChatTurn).not.toHaveBeenCalled()
    expect(events.flat().filter((event) => event.type === 'message.clarification' && event.clarification.status === 'ready_to_generate')).toHaveLength(1)
    expect(events.flat().filter((event) => event.type === 'message.pending')).toHaveLength(1)
  })

  it('uses the force terminal boundary when question finalization fails', async () => {
    const finalizeAssistantMessage = vi.fn(async () => { throw new Error('metadata race') })
    const forceFinalizeAssistantMessage = vi.fn(async () => undefined)
    const deps = Object.assign(dependencies({ finalizeAssistantMessage }), { forceFinalizeAssistantMessage }) as MessagesRouteDependencies
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 게시물 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.completed' }))
    expect(forceFinalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: soheeMessageId,
      status: 'completed',
    }))
  })

  it('releases a successful reservation exactly once when artifact generation fails', async () => {
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const releaseChatTurn = vi.fn(async () => undefined)
    const settleChatTurn = vi.fn(async () => undefined)
    const createConversationArtifact = vi.fn(async () => ({
      ...conversationArtifact,
      status: 'failed' as const,
      slides: [],
    }))
    const deps = dependencies({
      createConversationArtifact,
      credits: { reserveChatTurn, releaseChatTurn, settleChatTurn },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 이미지 2장 만들어줘',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed' }))
    expect(releaseChatTurn).toHaveBeenCalledTimes(1)
    expect(settleChatTurn).not.toHaveBeenCalled()
  })

  it('keeps a completed message when credit settlement fails', async () => {
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const settleChatTurn = vi.fn(async () => { throw new Error('settle unavailable') })
    const finalizeAssistantMessage = vi.fn(async () => undefined)
    const deps = dependencies({
      credits: { reserveChatTurn, settleChatTurn, releaseChatTurn: vi.fn(async () => undefined) },
      finalizeAssistantMessage,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '오늘 우선순위를 알려줘',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.completed' }))
    expect(events.some((event) => event.type === 'message.failed')).toBe(false)
    expect(finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('releases a successful reservation exactly once when generation is cancelled', async () => {
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const releaseChatTurn = vi.fn(async () => undefined)
    const settleChatTurn = vi.fn(async () => undefined)
    const deps = dependencies({
      createProvider: vi.fn(() => ({
        model: 'gpt-5.6-luna',
        provider: {
          mode: 'openai' as const,
          async *stream() {
            throw Object.assign(new Error('cancelled'), { code: 'OPENAI_CANCELLED' })
          },
        },
      })),
      credits: { reserveChatTurn, releaseChatTurn, settleChatTurn },
    })

    const response = await createMessagesPostHandler(deps)(request({
      content: '이번 주 콘텐츠 기획해줘',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code: 'CHAT_CANCELLED' }))
    expect(releaseChatTurn).toHaveBeenCalledTimes(1)
    expect(settleChatTurn).not.toHaveBeenCalled()
  })

  it('새 게시 요청은 첫 질문만 저장하고 provider·이미지·크레딧을 호출하지 않는다', async () => {
    const createConversationArtifact = vi.fn()
    const createImageArtifact = vi.fn()
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      createConversationArtifact,
      createImageArtifact,
      credits: {
        reserveChatTurn,
        settleChatTurn: vi.fn(async () => undefined),
        releaseChatTurn: vi.fn(async () => undefined),
      },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '스레드에 포스팅을 하고 싶어',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.clarification' }))
    expect(deps.createAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'content-interview-v1',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({
        step: 1,
        channels: ['threads'],
      }) },
    }))
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(createImageArtifact).not.toHaveBeenCalled()
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('이미지 수량을 포함한 새 Instagram 포스팅 요청도 이전 채널을 재사용하지 않고 인터뷰를 시작한다', async () => {
    const createConversationArtifact = vi.fn()
    const createImageArtifact = vi.fn()
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyState(),
      })),
      createConversationArtifact,
      createImageArtifact,
      credits: {
        reserveChatTurn,
        settleChatTurn: vi.fn(async () => undefined),
        releaseChatTurn: vi.fn(async () => undefined),
      },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타그램으로 이미지 3장짜리 새 포스팅을 만들고 싶어',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.clarification',
      clarification: expect.objectContaining({ status: 'collecting', step: 1 }),
    }))
    expect(deps.createAssistantMessageAtomic).toHaveBeenCalledWith(expect.objectContaining({
      model: 'content-interview-v1',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({
        step: 1,
        channels: ['instagram'],
        requestedImageCounts: { instagram: 3 },
      }) },
    }))
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(createImageArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('활성 인터뷰가 있으면 같은 원문을 새 게시 요청으로 재해석하지 않는다', async () => {
    const createConversationArtifact = vi.fn()
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: collectingInterview(),
      })),
      createConversationArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '상담 문의로 해줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.clarification' }))
  })

  it('네 번째 답변에서 같은 브리프와 누적 참고 미디어를 ready review에 보존한다', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyAfterThreeAnswers(),
      })),
      createConversationArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '이미지 분위기: 디테일과 결, 행동 유도: 상담 문의하기',
      clientMessageId,
      attachmentIds: ['60000000-0000-4000-8000-000000000001'],
    }), routeContext)

    await response.text()
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(deps.createAssistantMessageAtomic).toHaveBeenCalledWith(expect.objectContaining({
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'ready_to_generate' }) },
    }))
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('생성 실패 시 네 단계 답변과 ready_to_generate 브리프를 보존한다', async () => {
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: interviewReadyState(),
      })),
      createConversationArtifact: vi.fn(async () => {
        throw new Error('provider details must stay server-side')
      }),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    expect(await response.text()).toContain('CHAT_PROVIDER_FAILED')
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      usageMetadata: {
        soheeConversationInterview: expect.objectContaining({
          status: 'ready_to_generate',
          brief: expect.any(Object),
        }),
      },
    }))
  })

  it('실패한 ready assistant 재시도는 저장된 브리프와 원래 수량·미디어로 artifact를 재사용한다', async () => {
    const ready = interviewReadyWithReferenceMedia()
    const failed = {
      ...soheeMessage,
      status: 'failed' as const,
      content: '생성에 실패했습니다.',
      completedAt: '2026-08-10T01:01:00.000Z',
    }
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => failed),
      findLatestContentInterview: vi.fn(async () => null),
      createConversationArtifact,
      createProvider: vi.fn(),
    } as unknown as Partial<MessagesRouteDependencies> & {
      findContentInterviewByMessage: ReturnType<typeof vi.fn>
    })
    ;(deps as unknown as { findContentInterviewByMessage: ReturnType<typeof vi.fn> }).findContentInterviewByMessage = vi.fn(async () => ({
      messageId: soheeMessageId,
      userMessageId,
      state: ready,
    }))

    const response = await createMessagesPostHandler(deps)(request({
      content: '이미지 분위기: 디테일과 결, 행동 유도: 상담 문의하기',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    await response.text()

    expect(createConversationArtifact).toHaveBeenCalledTimes(1)
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      count: 1,
      contentBrief: ready.brief,
      referenceMediaIds: ['60000000-0000-4000-8000-000000000001'],
      attachmentIds: ['60000000-0000-4000-8000-000000000001'],
      idempotencyKey: clientMessageId,
    }))
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('연속 ready 재시도는 retry 대상별 새 assistant를 만들고 같은 retry 동시 요청은 pending replay한다', async () => {
    const active = interviewReadyAfterThreeAnswers()
    const ready = advanceContentInterview(active, {
      image: { value: 'detail', source: 'option' },
      callToAction: { value: 'check', source: 'option' },
    })
    let existingForRequest: ConversationMessage | null = null
    const assistantRows = new Map<string, ConversationMessage>()
    const createAssistantMessageAtomic = vi.fn(async (
      input: Parameters<NonNullable<MessagesRouteDependencies['createAssistantMessageAtomic']>>[0],
    ) => {
      const existing = assistantRows.get(input.assistantMessageId)
      if (existing) return { message: existing, created: false }
      const message = { ...soheeMessage, id: input.assistantMessageId }
      assistantRows.set(input.assistantMessageId, message)
      return { message, created: true }
    })
    const findAssistantReply = vi.fn(async () => existingForRequest)
    const findContentInterviewByMessage = vi.fn(async ({ messageId }: { messageId: string }) => ({
      messageId,
      userMessageId,
      state: ready,
    }))
    let artifactCalls = 0
    let releaseGeneration!: () => void
    const generationGate = new Promise<ConversationArtifact>((resolve) => {
      releaseGeneration = () => resolve(conversationArtifact)
    })
    const createConversationArtifact = vi.fn(async () => {
      artifactCalls += 1
      if (artifactCalls <= 2) throw new Error('provider unavailable')
      return generationGate
    })
    const deps = dependencies({
      findAssistantReply,
      findLatestContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: active })),
      findContentInterviewByMessage,
      createAssistantMessageAtomic,
      createConversationArtifact,
      createProvider: vi.fn(),
    })
    const handler = createMessagesPostHandler(deps)
    const body = {
      content: '저장하거나 나중에 다시 참고하기',
      clientMessageId,
      attachmentIds: [],
    }

    const initialResponse = await handler(request(body), routeContext)
    await initialResponse.text()
    const initialAssistantId = createAssistantMessageAtomic.mock.calls[0][0].assistantMessageId
    existingForRequest = { ...assistantRows.get(initialAssistantId)!, status: 'failed', completedAt: '2026-08-10T01:01:00.000Z' }

    const firstRetryResponse = await handler(request({ ...body, retryAssistantMessageId: initialAssistantId }), routeContext)
    await firstRetryResponse.text()
    const firstRetryAssistantId = createAssistantMessageAtomic.mock.calls[1][0].assistantMessageId
    existingForRequest = { ...assistantRows.get(firstRetryAssistantId)!, status: 'failed', completedAt: '2026-08-10T01:02:00.000Z' }

    const [secondRetryResponse, duplicateSecondRetryResponse] = await Promise.all([
      handler(request({ ...body, retryAssistantMessageId: firstRetryAssistantId }), routeContext),
      handler(request({ ...body, retryAssistantMessageId: firstRetryAssistantId }), routeContext),
    ])
    const duplicateEvents = (await duplicateSecondRetryResponse.text()).trim().split('\n').map((line) => JSON.parse(line))
    releaseGeneration()
    await secondRetryResponse.text()

    expect(createAssistantMessageAtomic).toHaveBeenCalledTimes(4)
    expect(new Set(createAssistantMessageAtomic.mock.calls.map(([input]) => input.assistantMessageId)).size).toBe(3)
    expect(createConversationArtifact).toHaveBeenCalledTimes(2)
    expect(createConversationArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      idempotencyKey: clientMessageId,
    }))
    expect(duplicateEvents).toContainEqual(expect.objectContaining({ type: 'message.pending' }))
  })

  it('취소 답변은 이전 collecting 인터뷰를 닫고 새 assistant도 cancelled로 저장한다', async () => {
    const cancelContentInterview = vi.fn(async () => undefined)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({
        messageId: soheeMessageId,
        userMessageId,
        state: collectingInterview(),
      })),
      cancelContentInterview,
    } as unknown as Partial<MessagesRouteDependencies>)
    const response = await createMessagesPostHandler(deps)(request({
      content: '나중에 할게요',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(cancelContentInterview).toHaveBeenCalledWith({ workspaceId, messageId: soheeMessageId })
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code: 'CHAT_CANCELLED' }))
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'cancelled' }) },
    }))
  })

  it('ready 준비 단계 예외는 assistant를 failed로 닫고 저장된 brief를 보존한다', async () => {
    const createGateway = vi.fn(async () => { throw new Error('gateway unavailable') })
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: interviewReadyState() })),
      credits: {
        createGateway,
        reserveChatTurn: vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId })),
        settleChatTurn: vi.fn(async () => undefined),
        releaseChatTurn: vi.fn(async () => undefined),
      },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    expect(response.status).toBe(503)
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'ready_to_generate', brief: expect.any(Object) }) },
    }))
  })

  it.each(['CHAT_IMAGE_HARNESS_UNAVAILABLE', 'IMAGE_AUTH_REQUIRED', 'IMAGE_QUOTA_EXHAUSTED', 'IMAGE_MODEL_UNAVAILABLE'])('preserves a safe image failure reason for the user and stored message: %s', async code => {
    const deps = dependencies({
      findLatestContentInterview: async () => null,
      findLatestReadyContentInterview: async () => ({ messageId: soheeMessageId, userMessageId, state: interviewReadyState() }),
      createConversationArtifact: async () => { throw new Error(code) },
    })
    const response = await createMessagesPostHandler(deps)(request({ content: serializeContentInterviewControl({ action: 'start_generation' }), clientMessageId, attachmentIds: [] }), routeContext)
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code, message: expect.not.stringContaining('응답을 생성하지 못했습니다') }))
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorCode: code }))
  })
  it('failed artifact는 인터뷰를 completed로 바꾸지 않고 failed 이벤트를 보낸다', async () => {
    const failedArtifact = { ...conversationArtifact, status: 'failed' as const }
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: interviewReadyState() })),
      createConversationArtifact: vi.fn(async () => failedArtifact),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code: 'CHAT_ARTIFACT_FAILED' }))
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'ready_to_generate' }) },
    }))
  })

  it.each([
    ['NAVER_CLAIMS_NEED_REVIEW', 'CHAT_FACT_REVIEW_REQUIRED', '확인되지 않은 정보가 있어 원고 생성을 멈췄어요. 나의 지식에서 가격·경력·후기 등의 출처와 유효기간을 확인하고 승인한 뒤 다시 작성해 주세요.'],
    ['FACT_SNAPSHOT_STALE', 'CHAT_FACTS_CHANGED', '작성 중 승인된 정보가 바뀌어 원고를 저장하지 않았어요. 나의 지식에서 최신 정보를 확인한 뒤 다시 작성해 주세요.'],
    ['NAVER_FACTS_UNAVAILABLE', 'CHAT_FACTS_UNAVAILABLE', '승인된 정보를 불러오지 못해 원고 생성을 멈췄어요. 잠시 후 다시 시도해 주세요.'],
  ])('원고 QA 오류 %s는 안전한 보완 안내를 저장하고 스트림으로 보낸다', async (reason, code, message) => {
    const releaseChatTurn = vi.fn(async () => undefined)
    const settleChatTurn = vi.fn(async () => undefined)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: interviewReadyState() })),
      createConversationArtifact: vi.fn(async () => { throw new Error(reason) }),
      credits: {
        reserveChatTurn: vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId })),
        releaseChatTurn,
        settleChatTurn,
      },
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code, message }))
    expect(events.some(event => event.type === 'artifact_created' || event.type === 'message.completed')).toBe(false)
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: message,
      status: 'failed',
      errorCode: code,
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'ready_to_generate' }) },
    }))
    expect(releaseChatTurn).toHaveBeenCalledTimes(1)
    expect(settleChatTurn).not.toHaveBeenCalled()
  })

  it('첨부 ID 검증 실패 시 active state를 바꾸지 않고 종료한다', async () => {
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: collectingInterview() })),
      validateInterviewAttachments: vi.fn(async () => { throw new Error('content_interview_attachment_forbidden') }),
    } as unknown as Partial<MessagesRouteDependencies>)
    const response = await createMessagesPostHandler(deps)(request({
      content: '상담 문의로 해줘',
      clientMessageId,
      attachmentIds: ['60000000-0000-4000-8000-000000000001'],
    }), routeContext)

    expect(response.status).toBe(422)
    expect(deps.createAssistantMessage).not.toHaveBeenCalled()
  })

  it('finder가 없으면 새 게시 요청을 generic provider로 우회하지 않는다', async () => {
    const createConversationArtifact = vi.fn()
    const deps = dependencies({ findLatestContentInterview: undefined, createConversationArtifact, createProvider: vi.fn() } as unknown as Partial<MessagesRouteDependencies>)
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 게시물 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    expect(response.status).toBe(503)
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('streaming assistant 중복 요청은 provider failure가 아닌 pending 이벤트를 replay한다', async () => {
    const deps = dependencies({
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => soheeMessage),
    })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.pending' }))
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'message.failed', code: 'CHAT_PROVIDER_FAILED' }))
  })

  it('질문 스트림 abort도 assistant와 interview metadata를 terminal cancelled로 닫는다', async () => {
    const controller = new AbortController()
    const deps = dependencies()
    const response = await createMessagesPostHandler(deps)(new Request(
      `http://localhost/api/workspaces/${workspaceId}/conversations/${threadId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '인스타 게시물 만들어줘', clientMessageId, attachmentIds: [] }),
        signal: controller.signal,
      },
    ), routeContext)
    controller.abort()
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({ type: 'message.failed', code: 'CHAT_CANCELLED' }))
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'cancelled' }) },
    }))
  })

  it('4단계 save CTA는 취소가 아니라 정상 ready 결정으로 저장한다', async () => {
    const ready = interviewReadyAfterThreeAnswers()
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: ready })),
      createConversationArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '저장하거나 나중에 다시 참고하기',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    await response.text()

    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      usageMetadata: { soheeConversationInterview: expect.objectContaining({ status: 'ready_to_generate' }) },
    }))
  })

  it('Naver original requestedImageCounts와 첨부 수가 다르면 명시적으로 실패한다', async () => {
    const createConversationArtifact = vi.fn()
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      findLatestReadyContentInterview: vi.fn(async () => ({ messageId: soheeMessageId, userMessageId, state: interviewReadyState() })),
      createConversationArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: serializeContentInterviewControl({ action: 'start_generation' }),
      clientMessageId,
      attachmentIds: [
        '60000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000002',
      ],
    }), routeContext)
    const body = await response.text()

    expect(body).toContain('CHAT_REFERENCE_MEDIA_COUNT_MISMATCH')
    expect(createConversationArtifact).not.toHaveBeenCalled()
  })

  it('compatibility 모드의 새 게시 요청은 저장 연결 오류로 닫힌다', async () => {
    const deps = dependencies({
      authorizeThread: vi.fn(async () => false),
      authorizeCompatibility: vi.fn(async () => true),
      createProvider: vi.fn(),
      createImageArtifact: vi.fn(),
      createConversationArtifact: vi.fn(),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 게시물 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.failed',
      code: 'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW',
    }))
    expect(deps.createProvider).not.toHaveBeenCalled()
    expect(deps.createImageArtifact).not.toHaveBeenCalled()
  })
  it('returns 401 before any write when authentication is missing', async () => {
    const deps = dependencies({ authenticate: vi.fn(async () => null) })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)

    expect(response.status).toBe(401)
    expect(deps.createUserMessage).not.toHaveBeenCalled()
  })

  it('returns 403 before any write for another workspace or thread', async () => {
    const deps = dependencies({ authorizeThread: vi.fn(async () => false) })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)

    expect(response.status).toBe(403)
    expect(deps.createUserMessage).not.toHaveBeenCalled()
  })

  it('creates and injects an admin credit gateway only after thread authorization', async () => {
    const adminGateway = { rpc: vi.fn() }
    const createGateway = vi.fn(async () => adminGateway)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const authorizeThread = vi.fn(async () => true)
    const credits = {
      createGateway,
      reserveChatTurn,
      settleChatTurn: vi.fn(async () => undefined),
      releaseChatTurn: vi.fn(async () => undefined),
    } as unknown as NonNullable<MessagesRouteDependencies['credits']>
    const deps = dependencies({ authorizeThread, credits })

    await (await createMessagesPostHandler(deps)(request(), routeContext)).text()

    expect(createGateway).toHaveBeenCalledTimes(1)
    expect(authorizeThread.mock.invocationCallOrder[0]).toBeLessThan(createGateway.mock.invocationCallOrder[0])
    expect(reserveChatTurn).toHaveBeenCalledWith(expect.objectContaining({ gateway: adminGateway }))
  })

  it('never creates an admin credit gateway before authentication or thread authorization', async () => {
    const createGateway = vi.fn(async () => ({ rpc: vi.fn() }))
    const credits = {
      createGateway,
      reserveChatTurn: vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId })),
      settleChatTurn: vi.fn(async () => undefined),
      releaseChatTurn: vi.fn(async () => undefined),
    } as unknown as NonNullable<MessagesRouteDependencies['credits']>

    await createMessagesPostHandler(dependencies({ authenticate: vi.fn(async () => null), credits }))(request(), routeContext)
    await createMessagesPostHandler(dependencies({ authorizeThread: vi.fn(async () => false), credits }))(request(), routeContext)

    expect(createGateway).not.toHaveBeenCalled()
  })

  it('keeps reserve, settle, and release failures safe for the client stream', async () => {
    const reserveSecret = 'reserve-secret-detail'
    const reserve = dependencies({ credits: {
      reserveChatTurn: vi.fn(async () => { throw new Error(reserveSecret) }),
      settleChatTurn: vi.fn(async () => undefined),
      releaseChatTurn: vi.fn(async () => undefined),
    } })
    const reserveResponse = await createMessagesPostHandler(reserve)(request(), routeContext)
    expect(await reserveResponse.text()).not.toContain(reserveSecret)

    const settleSecret = 'settle-secret-detail'
    const settle = dependencies({ credits: {
      reserveChatTurn: vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId })),
      settleChatTurn: vi.fn(async () => { throw new Error(settleSecret) }),
      releaseChatTurn: vi.fn(async () => undefined),
    } })
    const settleResponse = await createMessagesPostHandler(settle)(request(), routeContext)
    expect(await settleResponse.text()).not.toContain(settleSecret)

    const releaseSecret = 'release-secret-detail'
    const release = dependencies({
      createProvider: vi.fn(() => { throw new Error('provider unavailable') }),
      credits: {
        reserveChatTurn: vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId })),
        settleChatTurn: vi.fn(async () => undefined),
        releaseChatTurn: vi.fn(async () => { throw new Error(releaseSecret) }),
      },
    })
    const releaseResponse = await createMessagesPostHandler(release)(request(), routeContext)
    expect(await releaseResponse.text()).not.toContain(releaseSecret)
  })

  it('streams without persistence for the Byreum compatibility workspace when V0.7 tables are unavailable', async () => {
    const deps = dependencies({
      authorizeThread: vi.fn(async () => false),
      authorizeCompatibility: vi.fn(async () => true),
      buildCompatibilityContext: vi.fn(async () => ({
        ...context,
        approvedFacts: [{
          id: '77777777-7777-4777-8777-777777777777',
          category: 'image_generation_harness',
          content: '바이름 이미지 하네스 V1.0',
        }],
        activeHarnessRules: [{
          id: '88888888-8888-4888-8888-888888888888',
          ruleKey: 'byreum-recommended-image-v1',
          title: '바이름 추천 이미지 하네스 V1.0',
          description: '인스타그램, 스레드, 네이버 블로그용 이미지 규칙',
          version: 1,
        }],
      })),
    })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('message.completed')
    expect(deps.buildCompatibilityContext).toHaveBeenCalledWith({
      workspaceId,
      threadId,
    })
    expect(deps.createUserMessage).not.toHaveBeenCalled()
    expect(deps.createAssistantMessage).not.toHaveBeenCalled()
    expect(deps.finalizeAssistantMessage).not.toHaveBeenCalled()
  })

  it('generates an image artifact from a conversation request in compatibility mode', async () => {
    const imageUrl = `/api/workspaces/${workspaceId}/media/77777777-7777-4777-8777-777777777777`
    const createImageArtifact = vi.fn(async () => ({
      id: '77777777-7777-4777-8777-777777777777',
      kind: 'image_draft' as const,
      title: '바이름 인스타그램 이미지 초안',
      href: imageUrl,
      previewUrl: imageUrl,
      statusLabel: '승인 대기' as const,
      requiresConfirmation: true as const,
    }))
    const deps = dependencies({
      authorizeThread: vi.fn(async () => false),
      authorizeCompatibility: vi.fn(async () => true),
      buildCompatibilityContext: vi.fn(async () => context),
      createImageArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '자연스러운 눈썹 시술 이미지를 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.artifact',
      artifact: expect.objectContaining({ kind: 'image_draft', previewUrl: imageUrl }),
    }))
    expect(createImageArtifact).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'instagram',
      prompt: '자연스러운 눈썹 시술 이미지를 만들어줘',
      userId,
      workspaceId,
    }))
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('binds a generated image asset to the completed assistant message in persisted mode', async () => {
    const imageUrl = `/api/workspaces/${workspaceId}/media/77777777-7777-4777-8777-777777777777`
    const deps = dependencies({
      createImageArtifact: vi.fn(async () => ({
        id: '77777777-7777-4777-8777-777777777777',
        kind: 'image_draft' as const,
        title: '바이름 인스타그램 이미지 초안',
        href: imageUrl,
        previewUrl: imageUrl,
        statusLabel: '승인 대기' as const,
        requiresConfirmation: true as const,
      })),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타그램 이미지 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)

    expect(await response.text()).toContain('image_draft')
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: soheeMessageId,
      artifact: {
        type: 'media_asset',
        id: '77777777-7777-4777-8777-777777777777',
      },
    }))
  })

  it('returns 400 for invalid input', async () => {
    const deps = dependencies()
    const response = await createMessagesPostHandler(deps)(request({ content: ' ' }), routeContext)

    expect(response.status).toBe(400)
    expect(deps.createUserMessage).not.toHaveBeenCalled()
  })

  it('persists user then assistant and completes an ordered NDJSON stream', async () => {
    const deps = dependencies()
    const response = await createMessagesPostHandler(deps)(request(), routeContext)
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(lines.filter(event => event.type !== 'task_progress')).toEqual([
      { type: 'message.started', messageId: soheeMessageId },
      { type: 'message.delta', messageId: soheeMessageId, delta: '첫째, ' },
      { type: 'message.delta', messageId: soheeMessageId, delta: '초안을 검토하세요.' },
      { type: 'message.completed', messageId: soheeMessageId },
    ])
    expect(deps.createUserMessage).toHaveBeenCalledBefore(deps.createAssistantMessage as ReturnType<typeof vi.fn>)
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: soheeMessageId,
      content: '첫째, 초안을 검토하세요.',
      status: 'completed',
      errorCode: null,
    }))
  })

  it('replays an existing assistant reply for a duplicate client message id', async () => {
    const completed = { ...soheeMessage, content: '이미 만든 답변', status: 'completed' as const, completedAt: '2026-08-10T01:01:00.000Z' }
    const deps = dependencies({
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => completed),
    })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)

    expect(await response.text()).toContain('이미 만든 답변')
    expect(deps.createAssistantMessage).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('reserves and settles one chat turn for repeated clientMessageId requests', async () => {
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const settleChatTurn = vi.fn(async () => undefined)
    const first = dependencies({ credits: { reserveChatTurn, settleChatTurn, releaseChatTurn: vi.fn(async () => undefined) } })
    await (await createMessagesPostHandler(first)(request(), routeContext)).text()
    const replay = dependencies({
      credits: { reserveChatTurn, settleChatTurn, releaseChatTurn: vi.fn(async () => undefined) },
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => ({ ...soheeMessage, content: '이미 만든 답변', status: 'completed' as const, completedAt: '2026-08-10T01:01:00.000Z' })),
    })
    await (await createMessagesPostHandler(replay)(request(), routeContext)).text()
    expect(reserveChatTurn).toHaveBeenCalledTimes(1)
    expect(settleChatTurn).toHaveBeenCalledTimes(1)
  })

  it('replays the persisted image artifact for a duplicate image request', async () => {
    const assetId = '77777777-7777-4777-8777-777777777777'
    const completed = {
      ...soheeMessage,
      content: '이미 만든 이미지 초안',
      status: 'completed' as const,
      completedAt: '2026-08-10T01:01:00.000Z',
      artifact: { type: 'media_asset' as const, id: assetId },
    }
    const deps = dependencies({
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => completed),
      createImageArtifact: vi.fn(),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타그램 이미지 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.artifact',
      artifact: expect.objectContaining({
        id: assetId,
        kind: 'image_draft',
        previewUrl: `/api/workspaces/${workspaceId}/media/${assetId}`,
      }),
    }))
    expect(deps.createImageArtifact).not.toHaveBeenCalled()
  })

  it('retries a failed assistant without creating another user message', async () => {
    const failed = { ...soheeMessage, content: '응답 생성에 실패했습니다.', status: 'failed' as const, completedAt: '2026-08-10T01:01:00.000Z' }
    const deps = dependencies({
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => failed),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: userMessage.content,
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: failed.id,
    }), routeContext)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('message.completed')
    expect(deps.createUserMessage).toHaveBeenCalledTimes(1)
    expect(deps.createAssistantMessage).toHaveBeenCalledTimes(1)
  })

  it('persists a safe failed status without leaking the provider error', async () => {
    const secret = 'sk-proj-never-return-this'
    const deps = dependencies({
      createProvider: vi.fn(() => ({
        model: 'gpt-5.6-luna',
        provider: {
          mode: 'openai' as const,
          async *stream() {
            throw new Error(secret)
          },
        },
      })),
    })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)
    const body = await response.text()

    expect(body).toContain('message.failed')
    expect(body).not.toContain(secret)
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorCode: 'CHAT_PROVIDER_FAILED',
    }))
  })

  it('persists cancellation separately from failure', async () => {
    const deps = dependencies({
      createProvider: vi.fn(() => ({
        model: 'gpt-5.6-luna',
        provider: {
          mode: 'openai' as const,
          async *stream() {
            throw Object.assign(new Error('cancelled'), { code: 'OPENAI_CANCELLED' })
          },
        },
      })),
    })
    const response = await createMessagesPostHandler(deps)(request(), routeContext)

    expect(await response.text()).toContain('CHAT_CANCELLED')
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      errorCode: 'CHAT_CANCELLED',
    }))
  })

  it('does not leave a streaming assistant message when context construction fails', async () => {
    const deps = dependencies({
      buildContext: vi.fn(async () => {
        throw new Error('invalid persisted context')
      }),
    })

    const response = await createMessagesPostHandler(deps)(request(), routeContext)

    expect(response.status).toBe(503)
    expect(deps.createAssistantMessage).not.toHaveBeenCalled()
    expect(deps.finalizeAssistantMessage).not.toHaveBeenCalled()
  })

  it('persists and streams a structured multi-slide conversation artifact', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({ createConversationArtifact })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 이미지 2장 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      assistantMessageId: soheeMessageId,
      sourceMessageId: userMessageId,
      idempotencyKey: clientMessageId,
      prompt: '인스타 이미지 2장 만들어줘',
      count: 2,
    }))
    expect(createConversationArtifact).not.toHaveBeenCalledWith(expect.objectContaining({
      imageSubrequest: expect.anything(),
    }))
    expect(events).toContainEqual({
      type: 'artifact_created',
      messageId: soheeMessageId,
      artifactId: conversationArtifactId,
      requestedCount: 2,
    })
    expect(events.filter((event) => event.type === 'slide_progress').map((event) => event.slideId)).toEqual(
      conversationArtifact.slides.map((slide) => slide.id),
    )
    expect(events).toContainEqual({
      type: 'artifact_ready',
      messageId: soheeMessageId,
      artifact: conversationArtifact,
    })
  })

  it('이미지를 포함한 포스팅 제안도 생성보다 콘텐츠 인터뷰를 먼저 시작한다', async () => {
    const createConversationArtifact = vi.fn()
    const deps = dependencies({
      findLatestContentInterview: vi.fn(async () => null),
      createConversationArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '포스팅 작성해서 제안해줘. 이미지도 넣어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.clarification',
      clarification: expect.objectContaining({ status: 'collecting', step: 1 }),
    }))
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('routes a Naver Blog post with an image through one structured Naver artifact', async () => {
    const naverArtifact = {
      ...conversationArtifact,
      type: 'naver_blog_post' as const,
      slides: Object.freeze([conversationArtifact.slides[0]]),
    }
    const createConversationArtifact = vi.fn(async () => naverArtifact)
    const createImageArtifact = vi.fn()
    const deps = dependencies({ createConversationArtifact, createImageArtifact })

    const response = await createMessagesPostHandler(deps)(request({
      content: '네이버 블로그 게시물 1건을 제목과 본문, 이미지 1장으로 만들어줘.',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(createConversationArtifact).toHaveBeenCalledTimes(1)
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'naver_blog',
      count: 1,
    }))
    expect(createImageArtifact).not.toHaveBeenCalled()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'artifact_ready',
      artifact: naverArtifact,
    }))
  })

  it('keeps the explicit image count when a Naver post reuses existing media', async () => {
    const createConversationArtifact = vi.fn(async () => ({
      ...conversationArtifact,
      type: 'naver_blog_post' as const,
    }))
    const deps = dependencies({ createConversationArtifact })
    const content = '네이버 블로그에 기존 사용권 확인 이미지 12장을 재사용해 활용하고 새 이미지나 사진은 추가 생성하지 마. 게시물을 만들어줘.'

    const response = await createMessagesPostHandler(deps)(request({
      content,
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    await response.text()

    expect(createConversationArtifact).toHaveBeenCalledTimes(1)
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'naver_blog',
      count: 12,
      prompt: expect.stringContaining('기존 사용권 확인 이미지 12장'),
    }))
  })

  it.each(['인스타그램', '스레드'])('passes exact original photo ids and count into %s draft generation', async name => {
    const attachmentIds = ['60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002']
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({ createConversationArtifact, prepareRetry: async () => ({ attachmentIds }) })
    const response = await createMessagesPostHandler(deps)(request({
      content: `${name}에 첨부 사진 원본 2장을 그대로 사용해서 게시물을 만들어줘. 새 이미지는 생성하지 마.`,
      clientMessageId, attachmentIds, retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    await response.text()
    expect(createConversationArtifact).toHaveBeenCalled()
    for (const [input] of createConversationArtifact.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(input).toMatchObject({ count: 2, attachmentIds, generationMode: 'existing_media' })
    }
  })

  it('requires a new photo plan instead of silently changing the reviewed original photo count', async () => {
    let state = createInitialContentInterview({ originalPrompt: '인스타그램에 첨부 사진 원본을 그대로 사용해서 게시물을 만들어줘.', channels: ['instagram'], requestedImageCounts: { instagram: 3 }, referenceMediaIds: ['60000000-0000-4000-8000-000000000001'] })
    state = advanceContentInterview(state, { value: 'consultation', source: 'option' })
    state = advanceContentInterview(state, { value: 'local', source: 'option' })
    state = advanceContentInterview(state, { value: 'empathy_info_consult', source: 'option' })
    state = advanceContentInterview(state, { image: { value: 'detail', source: 'option' }, callToAction: { value: 'consult', source: 'option' } })
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const deps = dependencies({ createConversationArtifact, findLatestReadyContentInterview: async () => ({ messageId: soheeMessageId, userMessageId, state }), credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() } })
    const response = await createMessagesPostHandler(deps)(request({ content: serializeContentInterviewControl({ action: 'start_generation' }), clientMessageId, attachmentIds: [] }), routeContext)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'CHAT_PHOTO_PLAN_CHANGED' } })
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('does not substitute AI images when original photos were requested but none were attached', async () => {
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({ createConversationArtifact, credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() } })
    const response = await createMessagesPostHandler(deps)(request({ content: '인스타그램에 첨부 사진 원본을 그대로 사용해서 게시물을 만들어줘.', clientMessageId, attachmentIds: [], retryAssistantMessageId: soheeMessageId }), routeContext)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'CHAT_SOURCE_PHOTO_REQUIRED' } })
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('rejects more original social photos than the supported batch before generating or reserving credits', async () => {
    const attachmentIds = Array.from({ length: 4 }, (_, index) => `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
    const createConversationArtifact = vi.fn(async () => conversationArtifact)
    const reserveChatTurn = vi.fn(async () => ({ ok: true as const, reservationId: clientMessageId }))
    const deps = dependencies({ createConversationArtifact, prepareRetry: async () => ({ attachmentIds }), credits: { reserveChatTurn, settleChatTurn: vi.fn(), releaseChatTurn: vi.fn() } })
    const response = await createMessagesPostHandler(deps)(request({ content: '인스타그램에 첨부 사진 원본을 그대로 사용해서 게시물을 만들어줘.', clientMessageId, attachmentIds, retryAssistantMessageId: soheeMessageId }), routeContext)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'CHAT_ATTACHED_MEDIA_COUNT_UNSUPPORTED' } })
    expect(createConversationArtifact).not.toHaveBeenCalled()
    expect(reserveChatTurn).not.toHaveBeenCalled()
  })

  it('passes exact uploaded attachment ids to Naver artifact generation', async () => {
    const attachmentIds = [
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
    ]
    const createConversationArtifact = vi.fn(async () => ({
      ...conversationArtifact,
      type: 'naver_blog_post' as const,
    }))
    const deps = dependencies({ createConversationArtifact, prepareRetry: async () => ({ attachmentIds }) })

    const response = await createMessagesPostHandler(deps)(request({
      content: '네이버 블로그에 첨부 사진 2장을 순서대로 활용하고 새 이미지는 생성하지 마. 게시물을 만들어줘.',
      clientMessageId,
      attachmentIds,
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    await response.text()

    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'naver_blog',
      count: 2,
      attachmentIds,
    }))
  })

  it('streams three channel-complete candidates for a generic posting-plan request', async () => {
    const createConversationArtifact = vi.fn(async (
      input: Parameters<NonNullable<MessagesRouteDependencies['createConversationArtifact']>>[0],
    ) => ({
      ...conversationArtifact,
      id: input.idempotencyKey,
      idempotencyKey: input.idempotencyKey,
      type: input.channel === 'threads' ? 'threads_post' as const : 'instagram_post' as const,
    }))
    const deps = dependencies({ createConversationArtifact })

    const response = await createMessagesPostHandler(deps)(request({
      content: '이번 주 포스팅 기획해줘',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

    expect(createConversationArtifact).toHaveBeenCalledTimes(3)
    expect(createConversationArtifact.mock.calls.map(([input]) => ({
      channel: input.channel,
      count: input.count,
    }))).toEqual([
      { channel: 'instagram', count: 3 },
      { channel: 'threads', count: 1 },
      { channel: 'instagram', count: 2 },
    ])
    expect(new Set(createConversationArtifact.mock.calls.map(([input]) => input.idempotencyKey)).size).toBe(3)
    expect(events.filter((event) => event.type === 'artifact_ready')).toHaveLength(3)
    expect(deps.createProvider).not.toHaveBeenCalled()
  })

  it('keeps both requested social channels and automatically fits their image limits', async () => {
    const createConversationArtifact = vi.fn(async (
      input: Parameters<NonNullable<MessagesRouteDependencies['createConversationArtifact']>>[0],
    ) => ({
      ...conversationArtifact,
      id: input.idempotencyKey,
      idempotencyKey: input.idempotencyKey,
      type: input.channel === 'threads' ? 'threads_post' as const : 'instagram_post' as const,
    }))
    const deps = dependencies({ createConversationArtifact })

    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타와 스레드에 이미지 2장으로 게시물을 각각 2개씩 만들어줘',
      clientMessageId,
      attachmentIds: [],
      retryAssistantMessageId: soheeMessageId,
    }), routeContext)
    await response.text()

    expect(createConversationArtifact.mock.calls.map(([input]) => ({
      channel: input.channel,
      count: input.count,
    }))).toEqual([
      { channel: 'instagram', count: 2 },
      { channel: 'instagram', count: 2 },
      { channel: 'threads', count: 1 },
      { channel: 'threads', count: 1 },
    ])
  })

  it('replays persisted conversation artifacts in the same slide order', async () => {
    const completed = {
      ...soheeMessage,
      content: '이미 만든 캐러셀 초안',
      status: 'completed' as const,
      completedAt: '2026-08-10T01:01:00.000Z',
      artifacts: [{ type: 'conversation_artifact' as const, id: conversationArtifactId }],
    }
    const loadConversationArtifacts = vi.fn(async () => [conversationArtifact])
    const deps = dependencies({
      createUserMessage: vi.fn(async () => ({ message: userMessage, created: false })),
      findAssistantReply: vi.fn(async () => completed),
      loadConversationArtifacts,
      createConversationArtifact: vi.fn(),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '인스타 이미지 2장 만들어줘',
      clientMessageId,
      attachmentIds: [],
    }), routeContext)
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
    const replayed = events.find((event) => event.type === 'artifact_ready')?.artifact

    expect(loadConversationArtifacts).toHaveBeenCalledWith({
      workspaceId,
      messageId: soheeMessageId,
    })
    expect(replayed.slides.map((slide: { id: string }) => slide.id)).toEqual(
      conversationArtifact.slides.map((slide) => slide.id),
    )
    expect(deps.createConversationArtifact).not.toHaveBeenCalled()
  })

  it('returns a safe 404 before writes when a selected slide reference is not workspace-owned', async () => {
    const deps = dependencies({
      resolveArtifactReference: vi.fn(async () => ({ ok: false as const, reason: 'not_found' as const })),
      createConversationArtifact: vi.fn(),
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '두 번째 이미지만 다시 만들어줘',
      clientMessageId,
      attachmentIds: [],
      replyToMessageId: soheeMessageId,
      selectedSlideId,
    }), routeContext)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'CHAT_ARTIFACT_NOT_FOUND' } })
    expect(deps.createUserMessage).not.toHaveBeenCalled()
    expect(deps.createConversationArtifact).not.toHaveBeenCalled()
  })

  it('passes a verified selected slide reference without mutating the prior artifact', async () => {
    const reference = {
      ok: true as const,
      artifact: conversationArtifact,
      slide: conversationArtifact.slides[1],
    }
    const regenerated = Object.freeze({
      ...conversationArtifact,
      id: '77777777-7777-4777-8777-777777777778',
      idempotencyKey: clientMessageId,
      slides: Object.freeze(conversationArtifact.slides.map((slide) => slide.id === selectedSlideId
        ? Object.freeze({ ...slide, mediaAssetId: '99999999-9999-4999-8999-999999999993' })
        : slide)),
    })
    const createConversationArtifact = vi.fn(async () => regenerated)
    const deps = dependencies({
      resolveArtifactReference: vi.fn(async () => reference),
      createConversationArtifact,
    })
    const response = await createMessagesPostHandler(deps)(request({
      content: '두 번째 이미지만 다시 만들어줘',
      clientMessageId,
      attachmentIds: [],
      replyToMessageId: soheeMessageId,
      selectedSlideId,
    }), routeContext)

    expect(response.status).toBe(200)
    await response.text()
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({ reference }))
    expect(conversationArtifact.slides.map((slide) => slide.mediaAssetId)).toEqual([
      '99999999-9999-4999-8999-999999999991',
      '99999999-9999-4999-8999-999999999992',
    ])
    expect(regenerated.caption).toBe(conversationArtifact.caption)
  })

  it('passes only a verified retryable failed slide through the dedicated retry path', async () => {
    const failedSlide = Object.freeze({
      ...conversationArtifact.slides[1],
      status: 'failed' as const,
      mediaAssetId: null,
      altText: '',
      retryable: true,
      safeErrorCode: 'IMAGE_RETRYABLE' as const,
    })
    const partialArtifact = Object.freeze({
      ...conversationArtifact,
      status: 'partial' as const,
      slides: Object.freeze([conversationArtifact.slides[0], failedSlide]),
    })
    const reference = { ok: true as const, artifact: partialArtifact, slide: failedSlide }
    const regenerated = Object.freeze({
      ...partialArtifact,
      status: 'ready_for_review' as const,
      slides: Object.freeze([
        partialArtifact.slides[0],
        Object.freeze({
          ...failedSlide,
          status: 'succeeded' as const,
          mediaAssetId: '99999999-9999-4999-8999-999999999994',
          altText: '다시 만든 상담 행동 유도',
          retryable: false,
          safeErrorCode: null,
        }),
      ]),
    })
    const resolveArtifactRetryReference = vi.fn(async () => reference)
    const createConversationArtifact = vi.fn(async () => regenerated)
    const deps = dependencies({ resolveArtifactRetryReference, createConversationArtifact })

    const response = await createMessagesPostHandler(deps)(request({
      content: '실패한 이미지만 다시 만들어줘',
      clientMessageId,
      attachmentIds: [],
      replyToMessageId: soheeMessageId,
      retryFailedSlideId: selectedSlideId,
    }), routeContext)

    expect(response.status).toBe(200)
    await response.text()
    expect(resolveArtifactRetryReference).toHaveBeenCalledWith({
      workspaceId,
      threadId,
      replyToMessageId: soheeMessageId,
      retryFailedSlideId: selectedSlideId,
    })
    expect(createConversationArtifact).toHaveBeenCalledWith(expect.objectContaining({ reference }))
  })

  it('직접 요청에서도 당근은 생성 후보에서 빠지고, 당근만 요청하면 생성하지 않는다', () => {
    const mk = (channels: Array<'instagram' | 'daangn_business'>) => ({ prompt: 'p', candidates: channels.map(channel => ({ channel, count: 1 as const, direction: 'result' as const, instruction: '' })) })
    expect(withoutManualOnlyChannels(mk(['instagram', 'daangn_business']))?.candidates.map(c => c.channel)).toEqual(['instagram'])
    expect(withoutManualOnlyChannels(mk(['daangn_business']))).toBeNull()
    expect(withoutManualOnlyChannels(null)).toBeNull()
  })

  it('[explicit limitation] postRequestFromInterviewState excludes daangn_business from generation candidates because no generator or API exists', () => {
    const state: ContentInterviewState = Object.freeze({
      kind: 'content_interview' as const,
      status: 'ready_to_generate' as const,
      step: 4 as const,
      originalPrompt: '인스타와 당근에 포스팅해줘',
      channels: ['instagram', 'daangn_business'] as const,
      requestedImageCounts: { instagram: 3, daangn_business: 1 },
      answers: {
        goal: { value: 'custom', customText: '이벤트 홍보', source: 'free_text' as const },
        audience: { value: 'first_time', source: 'option' as const },
        structure: { value: 'short_natural', source: 'option' as const },
        visualCta: {
          image: { value: 'consultation', source: 'option' as const },
          callToAction: { value: 'consult', source: 'option' as const },
        },
      },
      referenceMediaIds: [],
    })

    const request = postRequestFromInterviewState(state)

    expect(request.prompt).toBe('인스타와 당근에 포스팅해줘')
    expect(request.candidates.map((c) => c.channel)).toEqual(['instagram'])
    expect(request.candidates.some((c) => (c.channel as string) === 'daangn_business')).toBe(false)
  })

  it('postRequestFromInterviewState reflects single image request in extraDirection for instagram count', () => {
    const state: ContentInterviewState = Object.freeze({
      kind: 'content_interview' as const,
      status: 'ready_to_generate' as const,
      step: 4 as const,
      originalPrompt: '인스타그램과 스레드에 글 올려줘',
      channels: ['instagram', 'threads'] as const,
      requestedImageCounts: { instagram: 3, threads: 1 },
      answers: {
        goal: { value: 'awareness', source: 'option' as const },
        audience: { value: 'local', source: 'option' as const },
        structure: { value: 'short_natural', source: 'option' as const },
        visualCta: {
          image: { value: 'workspace_style', source: 'option' as const },
          callToAction: { value: 'consult', source: 'option' as const },
          imagePreferences: {
            templateId: 'workspace_style',
            modelAge: '30s' as const,
            framing: 'upper_body' as const,
            pose: 'front' as const,
            background: 'bright_studio' as const,
            textOverlay: 'none' as const,
            extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
          },
        },
      },
      referenceMediaIds: [],
    })

    const request = postRequestFromInterviewState(state)
    const instaCandidate = request.candidates.find((c) => c.channel === 'instagram')
    expect(instaCandidate?.count).toBe(1)
  })

  describe('productionMessagesDependencies.createProvider', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
      delete process.env.GEMINI_API_KEY
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      delete process.env.GEMINI_CONVERSATION_MODEL
      delete process.env.OPENAI_API_KEY
      delete process.env.OPENAI_TEXT_API_KEY
      delete process.env.OPENAI_TEXT_MODEL
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('Gemini 키 없으면 거절 (오류 발생)', async () => {
      await expect(productionMessagesDependencies.createProvider()).rejects.toThrow(
        'GEMINI_API_KEY',
      )
    })

    it('OpenAI 텍스트 공급자를 만들지 않는다 (OPENAI_API_KEY가 있어도 Gemini 키 없으면 거절)', async () => {
      process.env.OPENAI_API_KEY = 'sk-proj-test-openai-key-which-should-be-ignored'
      await expect(productionMessagesDependencies.createProvider()).rejects.toThrow(
        'GEMINI_API_KEY',
      )
    })

    it('Gemini 키가 있으면 Gemini 대화 공급자(기본 모델 gemini-3.5-flash-lite)를 반환한다', async () => {
      process.env.GEMINI_API_KEY = 'AIzaSyTestSafeKeyPlaceholderLongEnough'
      const result = await productionMessagesDependencies.createProvider()
      expect(result.model).toBe('gemini-3.5-flash-lite')
      expect(result.provider).toBeDefined()
    })
  })
})
