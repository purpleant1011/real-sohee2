import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { parseSseStream } from '@/features/chat-floor/parse-sse-stream'
import { readAgentChatResponse } from '@/features/mobile-chat/agent-chat'

const executeTurn = vi.hoisted(() => vi.fn())
const verifyWorkspaceActor = vi.hoisted(() => vi.fn())
const handleWorkspaceActorError = vi.hoisted(() => vi.fn())
const redactErrorPayload = vi.hoisted(() => vi.fn(() => 'sanitized'))

vi.mock('@/lib/agent-os/agent-orchestrator', () => ({
  AgentOrchestrator: { executeTurn }
}))

vi.mock('@/lib/auth/workspace-actor-guard', () => ({
  verifyWorkspaceActor,
  handleWorkspaceActorError,
  redactErrorPayload,
}))

import { GET, POST } from '../route'
import { ConversationRepository, ConversationTurnConflict } from '@/lib/conversation/conversation-repository'

const WORKSPACE_ID = '223e4567-e89b-42d3-a456-426614174000'

function makeRequest(body: any, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_ID}/agent/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  })
}

describe('GET canonical turn recovery', () => {
  const threadId = '22222222-2222-4222-8222-222222222222'
  const clientMessageId = '33333333-3333-4333-8333-333333333333'
  const context = { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
  const request = (query: string) => new NextRequest(`http://localhost/api/workspaces/${WORKSPACE_ID}/agent/chat?${query}`)

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(ConversationRepository, 'getThreadMessagesResult').mockResolvedValue({ state: 'EMPTY', data: [], observedAt: '2026-10-28T00:00:00Z' })
    vi.spyOn(ConversationRepository, 'getThreadsResult').mockResolvedValue({ state: 'EMPTY', data: [], observedAt: '2026-10-28T00:00:00Z' })
    verifyWorkspaceActor.mockResolvedValue({ actorId: 'usr-1', isTestAccount: false })
    handleWorkspaceActorError.mockReturnValue(null)
  })

  it('returns the persisted run after response loss without executing another turn', async () => {
    const recovery = vi.spyOn(ConversationRepository, 'getTurnRecoveryResult').mockResolvedValue({
      state: 'DATA', observedAt: '2026-10-28T00:00:00Z',
      data: { runId: 'run', threadId, status: 'awaiting_approval', assistantMessageId: null },
    })
    const response = await GET(request(`threadId=${threadId}&clientMessageId=${clientMessageId}`), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, recovery: { runId: 'run', status: 'awaiting_approval' } })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(recovery).toHaveBeenCalledWith(WORKSPACE_ID, threadId, clientMessageId)
    expect(executeTurn).not.toHaveBeenCalled()
  })

  it('does not treat a pending or inaccessible run as proof that resending is safe', async () => {
    vi.spyOn(ConversationRepository, 'getTurnRecoveryResult').mockResolvedValue({ state: 'EMPTY', data: null, observedAt: '2026-10-28T00:00:00Z' })
    const response = await GET(request(`threadId=${threadId}&clientMessageId=${clientMessageId}`), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ recovery: null, readResult: { state: 'EMPTY' } })
    expect(executeTurn).not.toHaveBeenCalled()
  })

  it('returns a retryable read failure rather than an empty recovery on database errors', async () => {
    vi.spyOn(ConversationRepository, 'getTurnRecoveryResult').mockResolvedValue({ state: 'ERROR', errorCode: 'TURN_RECOVERY_UNAVAILABLE', message: '조회 실패', retryable: true, observedAt: '2026-10-28T00:00:00Z' })
    const response = await GET(request(`threadId=${threadId}&clientMessageId=${clientMessageId}`), context)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ success: false, errorCode: 'TURN_RECOVERY_UNAVAILABLE' })
  })

  it('recovers by client key when even the initial thread response was lost', async () => {
    const recovery = vi.spyOn(ConversationRepository, 'getTurnRecoveryResult').mockResolvedValue({
      state: 'DATA', observedAt: '2026-10-28T00:00:00Z',
      data: { runId: 'run', threadId, status: 'running', assistantMessageId: null },
    })
    const response = await GET(request(`clientMessageId=${clientMessageId}`), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, recovery: { runId: 'run', threadId } })
    expect(recovery).toHaveBeenCalledWith(WORKSPACE_ID, null, clientMessageId)
    expect(executeTurn).not.toHaveBeenCalled()
    expect(ConversationRepository.getThreadsResult).not.toHaveBeenCalled()
  })

  it.each([`threadId=&clientMessageId=${clientMessageId}`, `threadId=invalid&clientMessageId=${clientMessageId}`, `threadId=${threadId}&clientMessageId=invalid`, `threadId=${threadId}&clientMessageId=`])('rejects malformed recovery: %s', async query => {
    const recovery = vi.spyOn(ConversationRepository, 'getTurnRecoveryResult')
    const response = await GET(request(query), context)
    expect(response.status).toBe(400)
    expect(recovery).not.toHaveBeenCalled()
  })

  it('authorizes before looking up an existing turn', async () => {
    verifyWorkspaceActor.mockRejectedValueOnce(new Error('denied'))
    handleWorkspaceActorError.mockReturnValueOnce(NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }))
    const recovery = vi.spyOn(ConversationRepository, 'getTurnRecoveryResult')
    const response = await GET(request(`threadId=${threadId}&clientMessageId=${clientMessageId}`), context)
    expect(response.status).toBe(403)
    expect(recovery).not.toHaveBeenCalled()
  })
})

describe('POST /api/workspaces/[workspaceId]/agent/chat - SSE Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyWorkspaceActor.mockResolvedValue({ actorId: 'usr-1', isTestAccount: false })
    handleWorkspaceActorError.mockReturnValue(null)
  })

  it.each([
    { clientMessageId: 'not-a-uuid' },
    { clientMessageId: '' },
    { clientMessageId: null },
    { clientMessageId: 123 },
    { clientMessageId: {} },
    { client_message_id: 'legacy-invalid' },
    { clientMessageId: '', client_message_id: '33333333-3333-4333-8333-333333333333' },
    { clientMessageId: '33333333-3333-4333-8333-333333333333', client_message_id: '44444444-4444-4444-8444-444444444444' },
  ])('복구할 수 없는 요청 키는 실행 전에 거부한다: %j', async keyFields => {
    executeTurn.mockResolvedValue({ replyContent: '실행됨' })
    const response = await POST(makeRequest({ currentUserMessage: '검색해줘', ...keyFields }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ errorCode: 'INVALID_CLIENT_MESSAGE_ID' })
    expect(executeTurn).not.toHaveBeenCalled()
  })

  it.each([
    { clientMessageId: '33333333-3333-4333-8333-333333333333' },
    { client_message_id: '33333333-3333-4333-8333-333333333333' },
    { clientMessageId: '33333333-3333-4333-8333-333333333333', client_message_id: '33333333-3333-4333-8333-333333333333' },
  ])('유효한 요청 키는 canonical 실행까지 보존한다: %j', async keyFields => {
    executeTurn.mockResolvedValue({ replyContent: '확인했어요.' })
    const response = await POST(makeRequest({ currentUserMessage: '검색해줘', ...keyFields }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    expect(response.status).toBe(200)
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: '33333333-3333-4333-8333-333333333333' }))
  })

  it('대소문자만 다른 UUID 별칭은 동일 키로 정규화한다', async () => {
    executeTurn.mockResolvedValue({ replyContent: '확인했어요.' })
    const key = 'abcdefab-abcd-4abc-8abc-abcdefabcdef'
    const response = await POST(makeRequest({ currentUserMessage: '검색해줘', clientMessageId: key.toUpperCase(), client_message_id: key }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    expect(response.status).toBe(200)
    expect(executeTurn).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: key }))
  })

  it('키 생략은 기존 서버 생성 UUID 계약을 유지한다', async () => {
    executeTurn.mockResolvedValue({ replyContent: '확인했어요.' })
    const response = await POST(makeRequest({ currentUserMessage: '검색해줘' }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    expect(response.status).toBe(200)
    expect(executeTurn.mock.calls[0][0].clientMessageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('동일 turn 재요청은 409와 기존 실행 조회 정보만 반환한다', async () => {
    executeTurn.mockRejectedValueOnce(new ConversationTurnConflict('TURN_ALREADY_EXISTS', 'run-1', 'thread-1'))
    const response = await POST(makeRequest({ currentUserMessage: '검색해줘' }), { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ errorCode: 'TURN_ALREADY_EXISTS', runId: 'run-1', threadId: 'thread-1', recovery: 'GET_THREAD' })
    expect(executeTurn).toHaveBeenCalledTimes(1)
  })

  it('SSE 중복 turn은 성공 result 없이 복구 가능한 error를 보낸다', async () => {
    executeTurn.mockRejectedValueOnce(new ConversationTurnConflict('TURN_ALREADY_EXISTS', 'run-1', 'thread-1'))
    const response = await POST(makeRequest({ currentUserMessage: '검색해줘' }, { accept: 'text/event-stream' }), { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    const events = []
    for await (const event of parseSseStream(response.body!)) events.push(event)
    expect(events.filter(event => event.event === 'result')).toEqual([])
    expect(events.find(event => event.event === 'error')?.data).toMatchObject({ errorCode: 'TURN_ALREADY_EXISTS', recovery: 'GET_THREAD', runId: 'run-1' })
  })

  it('실제 라우트 SSE를 모바일 파서가 공개 결과와 활동으로 읽는다', async () => {
    const runId = '33333333-3333-4333-8333-333333333333'
    const threadId = '22222222-2222-4222-8222-222222222222'
    const missionId = '44444444-4444-4444-8444-444444444444'
    executeTurn.mockImplementation(async (input: any) => {
      input.onRunCreated?.(runId, threadId)
      input.onActivity?.({ event_id: '55555555-5555-4555-8555-555555555555', workspace_id: WORKSPACE_ID,
        run_id: runId, mission_id: missionId, step_id: null, sequence: 1,
        observed_at: '2026-10-28T00:00:00Z', kind: 'provider_accepted', simulated: false,
        raw_args: { secret: 'PRIVATE' } })
      return { runId, threadId, missionId, planVersion: 2, step: 'AWAITING_APPROVAL', replyContent: '검토할 초안이에요.',
        planCard: { title: '홍보 문안', steps: [{ name: '문안 검토' }] } }
    })
    const response = await POST(makeRequest({ currentUserMessage: '문안을 준비해줘' }, { accept: 'text/event-stream' }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    const activities: unknown[] = []
    const result = await readAgentChatResponse(response, WORKSPACE_ID, { onActivity: event => activities.push(event) })
    expect(result).toMatchObject({ content: '검토할 초안이에요.', runId, threadId, missionId, planVersion: 2,
      plan: { title: '홍보 문안', steps: ['문안 검토'] }, reviewHref: `/app/missions/${missionId}` })
    expect(activities).toHaveLength(1)
    expect(JSON.stringify(activities)).not.toContain('PRIVATE')
  })

  it('(a) Accept 헤더가 SSE가 아니면 기존과 100% 동일한 JSON 응답을 반환한다', async () => {
    executeTurn.mockResolvedValueOnce({
      sessionId: 'sess-1',
      threadId: 'th-1',
      runId: 'run-1',
      step: 'MCP_TOOL_EXECUTED',
      replyContent: '작업이 완료되었습니다.',
      creditDeduction: { totalDeductedSC: 10 }
    })

    const req = makeRequest({ currentUserMessage: '인스타 글 올려줘' }, {
      accept: 'application/json'
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const json = await res.json()
    expect(json.role).toBe('assistant')
    expect(json.content).toBe('작업이 완료되었습니다.')
    expect(json.runId).toBe('run-1')
  })

  it('(b) Accept: text/event-stream 일 때 run -> progress -> result 순서로 스트리밍하고 올바른 헤더를 갖는다', async () => {
    executeTurn.mockImplementation(async (input: any) => {
      // 1. run 이벤트 발생
      input.onRunCreated?.('run-stream-100', 'th-stream-1')
      // 2. progress 이벤트들 발생
      input.onProgress?.({
        kind: 'planning',
        stepIndex: 0,
        title: '마케팅 계획 수립 중',
        detail: '분석 중입니다.'
      })
      input.onProgress?.({
        kind: 'step_started',
        stepIndex: 1,
        title: '채널 발행',
        detail: '채널 발행을 시작합니다.'
      })
      input.onProgress?.({
        kind: 'step_done',
        stepIndex: 1,
        title: '채널 발행',
        detail: '채널 발행이 완료되었습니다.'
      })

      return {
        sessionId: 'sess-1',
        threadId: 'th-stream-1',
        runId: 'run-stream-100',
        step: 'MCP_TOOL_EXECUTED',
        replyContent: '발행 완료했습니다.',
        creditDeduction: { totalDeductedSC: 15 }
      }
    })

    const req = makeRequest({ currentUserMessage: '인스타 글 발행해줘' }, {
      accept: 'text/event-stream'
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-accel-buffering')).toBe('no')

    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(res.body!)) {
      events.push(evt)
    }

    expect(events.length).toBeGreaterThanOrEqual(4)
    expect(events[0].event).toBe('run')
    expect(events[0].data).toEqual({ runId: 'run-stream-100', threadId: 'th-stream-1' })

    const progressEvents = events.filter(e => e.event === 'progress')
    expect(progressEvents.map(e => e.data.kind)).toEqual(['planning', 'step_started', 'step_done'])

    const lastEvent = events[events.length - 1]
    expect(lastEvent.event).toBe('result')
    expect(lastEvent.data.content).toBe('발행 완료했습니다.')
    expect(lastEvent.data.runId).toBe('run-stream-100')
  })

  it('progress 경계는 모델 문구와 원본 인자 대신 공개 허용 필드만 전송한다', async () => {
    executeTurn.mockImplementation(async (input: any) => {
      input.onRunCreated?.('run-safe-1', 'th-1')
      input.onProgress?.({
        kind: 'planning',
        stepIndex: 0,
        title: '예약장부 확인 완료: 고객 김테스트',
        detail: 'secret@example.test 010-1234-5678 Bearer private-token',
        arguments: { access_token: 'private-token' },
        chainOfThought: 'private reasoning',
        systemPrompt: 'private prompt',
      })
      return { runId: 'run-safe-1', replyContent: '확인 중입니다.' }
    })

    const res = await POST(makeRequest({ currentUserMessage: '확인해줘' }, {
      accept: 'text/event-stream',
    }), { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    const events = []
    for await (const event of parseSseStream(res.body!)) events.push(event)
    const progress = events.find(event => event.event === 'progress')?.data

    expect(progress).toEqual({
      kind: 'planning', stepIndex: 0,
      title: '작업 준비', detail: '요청을 확인하고 있습니다.',
    })
    expect(JSON.stringify(progress)).not.toMatch(/김테스트|secret@|010-1234|private|예약장부 확인 완료/)
  })

  it('알 수 없는 progress 종류와 잘못된 단계 번호는 스트림에서 제외한다', async () => {
    executeTurn.mockImplementation(async (input: any) => {
      input.onProgress?.({ kind: 'provider_verified', stepIndex: 1, title: '게시 성공' })
      input.onProgress?.({ kind: 'step_done', stepIndex: -1, title: '게시 성공' })
      return { runId: 'run-safe-2', replyContent: '확인 중입니다.' }
    })
    const res = await POST(makeRequest({ currentUserMessage: '확인해줘' }, {
      accept: 'text/event-stream',
    }), { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
    const events = []
    for await (const event of parseSseStream(res.body!)) events.push(event)
    expect(events.filter(event => event.event === 'progress')).toEqual([])
    expect(events.at(-1)?.event).toBe('result')
  })

  it('저장된 activity만 sequence id와 최소 공개 DTO로 스트리밍한다', async () => {
    executeTurn.mockImplementation(async (input: any) => {
      input.onActivity?.({
        event_id: '00000000-0000-0000-0000-000000000003', workspace_id: WORKSPACE_ID,
        run_id: '00000000-0000-0000-0000-000000000002', mission_id: null, step_id: null,
        sequence: 8, observed_at: '2026-10-26T12:00:00Z', kind: 'result_unknown', simulated: false,
        user_visible_summary: '예약장부 조회 완료 PRIVATE', raw_args: 'SECRET_CUSTOMER',
      })
      input.onActivity?.({ sequence: 9, kind: 'externally_verified' })
      return { replyContent: '결과 확인 필요' }
    })
    const response = await POST(makeRequest({ currentUserMessage: '확인' }, { accept: 'text/event-stream' }), {
      params: Promise.resolve({ workspaceId: WORKSPACE_ID }),
    })
    const text = await response.text()
    expect(text).toContain('id: 8\nevent: activity\n')
    expect(text).not.toContain('id: 9')
    expect(text).not.toMatch(/PRIVATE|SECRET_CUSTOMER|예약장부 조회 완료/)
    expect(text).toContain('실행 결과를 아직 확인하지 못했습니다.')
  })

  it('(c) 오케스트레이터 예외 시 error 이벤트가 발생하고 result 이벤트는 발행되지 않는다', async () => {
    executeTurn.mockImplementation(async (input: any) => {
      input.onRunCreated?.('run-err-1', 'th-err-1')
      throw new Error('Database connection failed internally')
    })

    const req = makeRequest({ currentUserMessage: '작업해줘' }, {
      accept: 'text/event-stream'
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(res.body!)) {
      events.push(evt)
    }

    const eventNames = events.map(e => e.event)
    expect(eventNames).toContain('error')
    expect(eventNames).not.toContain('result')

    const errEvent = events.find(e => e.event === 'error')
    expect(errEvent?.data.message).toContain('일시적인 시스템 오류')
    // 원문 예외 문자열 비노출 검증
    expect(errEvent?.data.message).not.toContain('Database connection failed')
  })

  it('(d) 인증 실패 시 스트림이 아닌 JSON 401/403 응답을 반환한다', async () => {
    verifyWorkspaceActor.mockRejectedValueOnce(new Error('인증되지 않은 사용자입니다.'))
    handleWorkspaceActorError.mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    )

    const req = makeRequest({ currentUserMessage: '안녕' }, {
      accept: 'text/event-stream'
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    const json = await res.json()
    expect(json.error).toBe('UNAUTHORIZED')
  })

  it('(e) progress 및 error 이벤트의 텍스트(title, detail, message)에 UUID, 토큰, 영문 상태코드가 노출되지 않는다', async () => {
    executeTurn.mockImplementation(async (input: any) => {
      input.onRunCreated?.('run-uuid-test', 'th-1')
      input.onProgress?.({
        kind: 'step_failed',
        stepIndex: 1,
        title: '채널 발행',
        detail: '채널 발행 작업 중 오류가 발생했습니다.'
      })
      throw new Error('INTERNAL_FATAL_UUID_00000000-0000-0000-0000-000000000001')
    })

    const req = makeRequest({ currentUserMessage: '작업해줘' }, {
      accept: 'text/event-stream'
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })

    const events: Array<{ event: string; data: any }> = []
    for await (const evt of parseSseStream(res.body!)) {
      events.push(evt)
    }

    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const forbiddenInternalRegex = /(INTERNAL_FATAL|BEARER|TOKEN|STACK_TRACE|MALFORMED_ARGUMENTS)/i

    for (const evt of events) {
      if (evt.event === 'progress') {
        const text = `${evt.data.title} ${evt.data.detail || ''}`
        expect(text).not.toMatch(uuidRegex)
        expect(text).not.toMatch(forbiddenInternalRegex)
      } else if (evt.event === 'error') {
        const text = evt.data.message
        expect(text).not.toMatch(uuidRegex)
        expect(text).not.toMatch(forbiddenInternalRegex)
      }
    }
  })
})
