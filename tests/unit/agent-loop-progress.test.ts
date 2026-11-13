import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentLoopEngine, AgentProgressEvent } from '@/features/tool-runtime/agent-loop-engine'
import { ActionWorker, ActionWorkerOutput } from '@/lib/ai/action-worker'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher'

vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule())
vi.mock('@/features/channel-studio/compose', async () => (await import('./helpers/fake-channel-studio')).fakeComposeModule())
// ANI-1753: 승인 대기 경로가 AgentApprovalService.createProposal() 을 통해 서버 Supabase 를 쓴다.
// 대역이 없으면 실제 요청이 나가 기본 타임아웃(5s)에 걸린다.
vi.mock('@/lib/supabase/server', async () => (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule())

const baseWorkerOutput: Pick<ActionWorkerOutput, 'modelId' | 'role' | 'profileSnapshot'> = {
  modelId: 'gpt-5.6-luna-max',
  role: 'action',
  profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
}

describe('AgentLoopEngine onProgress events', () => {
  const WORKSPACE_ID = 'ws-test-stream'
  const ACTION_RUN_ID = '00000000-0000-0000-0000-000000000002'
  const CORRELATION_ID = 'corr-progress-test-1'

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(ConversationRepository, 'createAgentRun').mockResolvedValue(ACTION_RUN_ID)
    vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined)
    vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue(undefined)
    vi.spyOn(ConversationRepository, 'beginAgentRunStep').mockResolvedValue(undefined)
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue(undefined)
  })

  it('COMPLETED가 아닌 성공 상태(미리보기 준비됨 등)도 step_failed가 아니라 step_done 으로 알린다', async () => {
    const progressEvents: AgentProgressEvent[] = []
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [{ id: 'call_s', toolName: 'mcp_search_knowledge', arguments: { query: '메뉴' } }],
        rawContent: '',
        totalTokens: 10
      })
      .mockResolvedValueOnce({ ...baseWorkerOutput, toolCalls: [], rawContent: '완료', totalTokens: 5 })
    vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
      success: true,
      status: 'CONTENT_PREVIEW' as never,
      toolId: 'knowledge.search',
      data: {}
    })

    await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '메뉴 알려줘',
      options: { onProgress: (e) => progressEvents.push(e) }
    })

    const kinds = progressEvents.map(e => e.kind)
    expect(kinds).toContain('step_done')
    expect(kinds).not.toContain('step_failed')
  })

  it('계획 시작(planning), 도구 시작(step_started), 도구 성공(step_done) 순서로 onProgress를 호출한다', async () => {
    const progressEvents: AgentProgressEvent[] = []
    const onProgress = vi.fn((e: AgentProgressEvent) => {
      progressEvents.push(e)
    })

    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [
          {
            id: 'call_search_1',
            toolName: 'mcp_search_knowledge',
            arguments: { query: '메뉴 정보' }
          }
        ],
        rawContent: '',
        totalTokens: 100
      })
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [],
        rawContent: '메뉴 조회가 완료되었습니다.',
        totalTokens: 50
      })

    vi.spyOn(ToolDispatcher, 'dispatch').mockImplementation(async (_name, _args, context) => {
      await context.onExecutionStarting?.()
      return { success: true, status: 'COMPLETED', toolId: 'knowledge.search', data: { found: true } }
    })

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '메뉴 알려줘',
      options: {
        onProgress
      }
    })

    expect(result.status).toBe('COMPLETED')
    expect(onProgress).toHaveBeenCalled()

    const kinds = progressEvents.map(e => e.kind)
    expect(kinds).toContain('planning')
    expect(kinds).toContain('step_started')
    expect(kinds).toContain('step_done')

    // 순서 검증: planning -> step_started -> step_done
    const planningIdx = kinds.indexOf('planning')
    const startIdx = kinds.indexOf('step_started')
    const doneIdx = kinds.indexOf('step_done')
    expect(planningIdx).toBeLessThan(startIdx)
    expect(startIdx).toBeLessThan(doneIdx)

    // 한국어 타이틀 확인
    expect(progressEvents[planningIdx].title).toContain('계획')
    expect(progressEvents[startIdx].title.length).toBeGreaterThan(0)
  })

  it('차단된 도구에는 시작을 표시하지 않고 저장된 blocked 사실만 남긴다', async () => {
    const progress: AgentProgressEvent[] = []
    const facts: unknown[] = []
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({ ...baseWorkerOutput, toolCalls: [{ id: 'blocked-call', toolName: 'mcp_search_knowledge', arguments: { query: '메뉴' } }], rawContent: '', totalTokens: 10 })
      .mockResolvedValueOnce({ ...baseWorkerOutput, toolCalls: [], rawContent: '연결 필요', totalTokens: 5 })
    vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: false, status: 'DISCONNECTED', toolId: 'knowledge.search' })
    await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID, actionRunId: ACTION_RUN_ID, correlationId: CORRELATION_ID, userPrompt: '메뉴',
      options: { onProgress: e => progress.push(e), recordActivity: async fact => { facts.push(fact) } },
    })
    expect(progress.some(e => e.kind === 'step_started')).toBe(false)
    expect(facts).toContainEqual({ kind: 'blocked', stepId: '1', dedupeKey: 'step:1:result' })
    expect(facts).not.toContainEqual(expect.objectContaining({ kind: 'tool_read_started' }))
  })

  it('실행 시작 사실은 handler 경계에서 저장하며 결과 성공을 verified로 과장하지 않는다', async () => {
    const facts: unknown[] = []
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({ ...baseWorkerOutput, toolCalls: [{ id: 'read-call', toolName: 'mcp_search_knowledge', arguments: { query: '메뉴' } }], rawContent: '', totalTokens: 10 })
      .mockResolvedValueOnce({ ...baseWorkerOutput, toolCalls: [], rawContent: '완료', totalTokens: 5 })
    vi.spyOn(ToolDispatcher, 'dispatch').mockImplementation(async (_name, _args, context) => {
      await context.onExecutionStarting?.()
      return { success: true, status: 'COMPLETED', toolId: 'knowledge.search' }
    })
    await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID, actionRunId: ACTION_RUN_ID, correlationId: CORRELATION_ID, userPrompt: '메뉴',
      options: { recordActivity: async fact => { facts.push(fact) } },
    })
    expect(facts).toContainEqual({ kind: 'tool_read_started', stepId: '1', dedupeKey: 'step:1:start' })
    expect(facts).toContainEqual({ kind: 'result_unknown', stepId: '1', dedupeKey: 'step:1:result' })
    expect(facts).not.toContainEqual(expect.objectContaining({ kind: 'externally_verified' }))
  })

  it('인자 파싱 실패로 실행되지 않은 도구에는 step_started를 표시하지 않는다', async () => {
    const progressEvents: AgentProgressEvent[] = []
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [{
          id: 'call-invalid', toolName: 'mcp_search_knowledge',
          arguments: {}, argumentParseError: 'invalid JSON',
        }],
        rawContent: '', totalTokens: 10,
      })
      .mockResolvedValueOnce({ ...baseWorkerOutput, toolCalls: [], rawContent: '확인 필요', totalTokens: 5 })
    const dispatch = vi.spyOn(ToolDispatcher, 'dispatch')

    await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID, actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID, userPrompt: '메뉴 알려줘',
      options: { onProgress: event => progressEvents.push(event) },
    })

    expect(dispatch).not.toHaveBeenCalled()
    expect(progressEvents.filter(event => event.kind === 'step_started')).toEqual([])
    expect(progressEvents.some(event => event.kind === 'step_failed')).toBe(true)
  })

  it('도구 실패 시 step_failed 이벤트가 호출된다', async () => {
    const progressEvents: AgentProgressEvent[] = []
    const onProgress = vi.fn((e: AgentProgressEvent) => {
      progressEvents.push(e)
    })

    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [
          {
            id: 'call_failing_1',
            toolName: 'mcp_search_knowledge',
            arguments: { query: '실패 쿼리' }
          }
        ],
        rawContent: '',
        totalTokens: 100
      })
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [],
        rawContent: '도구 실패 후 처리',
        totalTokens: 50
      })

    vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
      success: false,
      status: 'FAILED',
      toolId: 'knowledge.search',
      error: { code: 'SEARCH_ERROR', message: '검색 엔진 오류' }
    })

    await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '검색해줘',
      options: {
        onProgress
      }
    })

    const failedEvent = progressEvents.find(e => e.kind === 'step_failed')
    expect(failedEvent).toBeDefined()
    expect(failedEvent?.title.length).toBeGreaterThan(0)
  })

  it('승인 대기 시 awaiting_approval 이벤트가 호출된다', async () => {
    const progressEvents: AgentProgressEvent[] = []
    const onProgress = vi.fn((e: AgentProgressEvent) => {
      progressEvents.push(e)
    })

    vi.spyOn(ActionWorker, 'planAndCallTools').mockResolvedValueOnce({
      ...baseWorkerOutput,
      toolCalls: [
        {
          id: 'call_publish_1',
          toolName: 'mcp_publish_live',
          arguments: { channel: 'INSTAGRAM', contentVersionId: 'approved-version', expectedFingerprint: 'approved-fingerprint' }
        }
      ],
      rawContent: '',
      totalTokens: 100
    })

    vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
      success: true,
      status: 'AWAITING_APPROVAL',
      toolId: 'publish.create',
      proposal: {
        proposalId: 'prop-1',
        proposalType: 'ACTION_APPROVAL',
        title: '인스타그램 피드 발행 승인 요청',
        description: '인스타그램 피드 발행 승인 요청 설명',
        proposedValue: { channel: 'INSTAGRAM', caption: '인스타 피드 발행' }
      }
    })

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '인스타에 바로 올려줘',
      options: {
        onProgress
      }
    })

    expect(result.status).toBe('AWAITING_APPROVAL')
    const approvalEvent = progressEvents.find(e => e.kind === 'awaiting_approval')
    expect(approvalEvent).toBeDefined()
  })

  it('onProgress 콜백이 에러를 throw해도 엔진 실행이 깨지지 않고 정상 완료된다', async () => {
    const throwingOnProgress = vi.fn(() => {
      throw new Error('클라이언트 연결 끊김 (Stream closed)')
    })

    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [
          {
            id: 'call_search_1',
            toolName: 'mcp_search_knowledge',
            arguments: { query: '메뉴 정보' }
          }
        ],
        rawContent: '',
        totalTokens: 100
      })
      .mockResolvedValueOnce({
        ...baseWorkerOutput,
        toolCalls: [],
        rawContent: '답변 완료',
        totalTokens: 50
      })

    vi.spyOn(ToolDispatcher, 'dispatch').mockImplementation(async (_name, _args, context) => {
      await context.onExecutionStarting?.()
      return { success: true, status: 'COMPLETED', toolId: 'knowledge.search', data: { found: true } }
    })

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '메뉴 알려줘',
      options: {
        onProgress: throwingOnProgress
      }
    })

    expect(result.status).toBe('COMPLETED')
  })
})
