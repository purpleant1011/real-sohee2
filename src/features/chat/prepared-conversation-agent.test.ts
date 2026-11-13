import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executePreparedConversationAgent } from './prepared-conversation-agent'
import type { SoheeContextBundle } from './context-builder'
import type { AgentLoopInput, AgentLoopResult } from '@/features/tool-runtime/agent-loop-engine'
import type { ToolExecutionContext } from '@/features/tool-runtime/types'
import { UnknownProviderOutcomeError } from './jobs/runner'
import { KNOWLEDGE_JOURNAL_NOTICE } from '@/features/sohee-studio/knowledge-journal'
import { TEACH_TOPICS } from './teach-model'
import { PROMPT_INJECTION_DEFENSE_NOTICE, GOAL_CONTEXT_SAFETY_NOTICE } from './context-builder'
import { BUSINESS_CONTEXT_SAFETY_NOTICE } from './workspace-business-context'

const scope = { workspaceId: 'ws', userId: 'actor', threadId: 'thread', jobId: 'job', assistantMessageId: 'assistant', message: '댓글을 확인하고 답변 초안을 검토해줘' }
const context: SoheeContextBundle = { workspace: { id: 'ws', name: '가게', timezone: 'Asia/Seoul' }, approvedFacts: [{ id: 'fact', category: '가격', content: '상담 후 안내' }], activeHarnessRules: [], currentWork: [], currentSchedules: [], recentMessages: [] }
const usage = { provider: 'gemini' as const, providerRequestId: 'response', model: 'gemini-3.8-flash', operation: 'text_response' as const, usageSource: 'actual' as const,
  usage: { textInputTokens: 10, cachedTextInputTokens: 0, textOutputTokens: 5, imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 15 } }
const completed = { status: 'COMPLETED', rawAssistantFinalMessage: '확인한 댓글을 바탕으로 답변 초안을 준비했어요.',
  actionGraph: { runId: 'job', status: 'COMPLETED', iterations: 2, totalSteps: 1, steps: [] },
  executedSteps: [{ stepIndex: 1, iteration: 1, toolCallId: 'call', toolName: 'interaction.list', toolId: 'interaction.list', arguments: {}, status: 'COMPLETED', startedAt: '2026-10-29T10:00:00Z' }],
  accumulatedToolResults: [], totalTokens: 15, totalCreditsDeducted: 0,
  cards: { planCard: null, liveExecutionCard: null, approvalCard: null, evidenceResultCard: null, failureCard: null } } as AgentLoopResult
const deps = { prepareModelCall: vi.fn(), authorized: vi.fn(), loadContext: vi.fn(), run: vi.fn(), recordUsage: vi.fn(), saveTimeline: vi.fn(), finalize: vi.fn(), persistPlan: vi.fn(),
  readClient: {} as ToolExecutionContext['readClient'], creditBalance: 2000, allowedCapabilityIds: ['knowledge.search', 'interaction.list', 'publish.create'] }
beforeEach(() => {
  vi.clearAllMocks(); deps.authorized.mockResolvedValue(true); deps.loadContext.mockResolvedValue(context)
  deps.prepareModelCall.mockResolvedValue(undefined)
  deps.run.mockImplementation(async (input: AgentLoopInput) => { await input.options?.onModelStarting?.(); await input.options?.onUsage?.(usage); return completed })
  deps.recordUsage.mockResolvedValue(undefined); deps.saveTimeline.mockResolvedValue(undefined); deps.finalize.mockResolvedValue(undefined)
})

describe('prepared multi-tool conversation adapter', () => {
  it('explicit memory requests enable only the server-owned candidate writer and require an actual receipt', async () => {
    const memoryScope = { ...scope, message: '매주 월요일은 휴무라고 기억해줘' }
    const proposeKnowledge = vi.fn()
    const allowedCapabilityIds = ['knowledge.propose', 'publish.create']
    const result = await executePreparedConversationAgent(memoryScope, { ...deps, proposeKnowledge, allowedCapabilityIds })
    expect((deps.run.mock.calls[0][0] as AgentLoopInput).options).toMatchObject({ proposeKnowledge, allowedCapabilityIds: ['knowledge.propose'] })
    expect(result.status).toBe('failed')
    expect(deps.finalize).not.toHaveBeenCalledWith(completed.rawAssistantFinalMessage, true)
    deps.run.mockClear()
    await executePreparedConversationAgent(memoryScope, { ...deps, allowedCapabilityIds })
    expect((deps.run.mock.calls[0][0] as AgentLoopInput).options?.allowedCapabilityIds).toEqual([])
  })

  it('renders canonical candidate evidence instead of claiming it is already approved knowledge', async () => {
    const workspaceId = '20000000-0000-4000-8000-000000000001'
    deps.loadContext.mockResolvedValueOnce({ ...context, workspace: { ...context.workspace, id: workspaceId } })
    deps.run.mockResolvedValueOnce({ ...completed, rawAssistantFinalMessage: '상시 규칙으로 적용했어요.', executedSteps: [{ ...completed.executedSteps[0], toolId: 'knowledge.propose', result: {
      kind: 'knowledge_proposal', workspaceId, proposalId: '30000000-0000-4000-8000-000000000001', sourceMessageId: '40000000-0000-4000-8000-000000000001', category: '휴무', content: '매주 월요일 휴무', status: 'proposed', requiresUserApproval: true, href: '/app/sohee?tab=studio',
    } }] })
    await executePreparedConversationAgent({ ...scope, workspaceId, userMessageId: '40000000-0000-4000-8000-000000000001', message: '매주 월요일 휴무라고 기억해줘' }, { ...deps, allowedCapabilityIds: ['knowledge.propose'], proposeKnowledge: vi.fn() })
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('매주 월요일 휴무'), true)
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('승인 지식이나 운영 규칙으로 적용하지 않았어요'), true)
    expect(deps.finalize).not.toHaveBeenCalledWith('상시 규칙으로 적용했어요.', true)
  })
  it('reuses the job and actor, grounds planning and never enables natural-language external writes', async () => {
    const result = await executePreparedConversationAgent(scope, deps)
    const input = deps.run.mock.calls[0][0] as AgentLoopInput
    expect(input).toMatchObject({ actionRunId: scope.jobId, workspaceId: scope.workspaceId, actorId: scope.userId, intentMode: 'DRAFT' })
    expect(input.contextInstruction).toContain('상담 후 안내')
    expect(input.contextInstruction).toContain('실행 권한')
    expect(input.options?.allowedCapabilityIds).toEqual(['knowledge.search', 'interaction.list'])
    expect(deps.recordUsage).toHaveBeenCalledWith(usage)
    expect(deps.finalize).toHaveBeenCalledWith(completed.rawAssistantFinalMessage, true)
    expect(result.billingDisposition).toBe('settle_usage')
  })

  it('enables canonical internal drafts only with a server-owned preparer, never external send', async () => {
    const prepareInteractionDraft = vi.fn()
    const allowedCapabilityIds = ['interaction.list', 'comment.reply_draft', 'dm.reply_draft', 'comment.reply', 'dm.send']
    const draftScope = { ...scope, message: '댓글을 확인하고 답변 초안을 준비해줘' }
    await executePreparedConversationAgent(draftScope, { ...deps, allowedCapabilityIds, prepareInteractionDraft })
    expect((deps.run.mock.calls[0][0] as AgentLoopInput).options).toMatchObject({ prepareInteractionDraft,
      allowedCapabilityIds: ['interaction.list', 'comment.reply_draft', 'dm.reply_draft'] })
    deps.run.mockClear()
    await executePreparedConversationAgent(draftScope, { ...deps, allowedCapabilityIds })
    expect((deps.run.mock.calls[0][0] as AgentLoopInput).options?.allowedCapabilityIds).toEqual(['interaction.list'])
    deps.run.mockClear()
    await executePreparedConversationAgent({ ...scope, message: '댓글을 조회만 해줘' }, { ...deps, allowedCapabilityIds, prepareInteractionDraft })
    expect((deps.run.mock.calls[0][0] as AgentLoopInput).options?.allowedCapabilityIds).toEqual(['interaction.list'])
  })

  it('renders the actual saved draft instead of a model claim that it was sent', async () => {
    const workspaceId = '20000000-0000-4000-8000-000000000001'
    deps.loadContext.mockResolvedValueOnce({ ...context, workspace: { ...context.workspace, id: workspaceId } })
    deps.run.mockResolvedValueOnce({ ...completed, rawAssistantFinalMessage: '고객에게 발송했어요.', executedSteps: [completed.executedSteps[0], {
      ...completed.executedSteps[0], stepIndex: 2, toolId: 'comment.reply_draft', result: {
        kind: 'interaction_draft', workspaceId, targetKind: 'comment', targetId: '30000000-0000-4000-8000-000000000001',
        draftId: '40000000-0000-4000-8000-000000000001', draftText: '상담 후 자세히 안내드릴게요.', fingerprint: 'a'.repeat(64),
        sourceRef: 'b'.repeat(64), channel: 'threads', customerLabel: '문의 고객', preparedAt: '2026-10-29T12:00:00Z',
        reused: false, requiresUserApproval: true,
      },
    }] })
    const result = await executePreparedConversationAgent({ ...scope, workspaceId, message: '댓글을 확인하고 답변 초안을 준비해줘' },
      { ...deps, prepareInteractionDraft: vi.fn(), allowedCapabilityIds: ['interaction.list', 'comment.reply_draft'] })
    expect(result.status).toBe('completed')
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('상담 후 자세히 안내드릴게요.'), true)
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('아직 발송하지 않았으며'), true)
    expect(deps.finalize).not.toHaveBeenCalledWith('고객에게 발송했어요.', true)
  })

  it('does not claim a saved reply draft when only an inbox read completed', async () => {
    deps.run.mockResolvedValueOnce({ ...completed, rawAssistantFinalMessage: '답변 초안을 저장했어요.' })
    const result = await executePreparedConversationAgent({ ...scope, message: '댓글을 확인하고 답변 초안을 준비해줘' },
      { ...deps, prepareInteractionDraft: vi.fn(), allowedCapabilityIds: ['interaction.list', 'comment.reply_draft'] })
    expect(result.status).toBe('failed')
    expect(deps.finalize).not.toHaveBeenCalledWith('답변 초안을 저장했어요.', true)
  })

  it('전달된 일지를 과거 기록으로 설명하고 승인된 실행 명령으로 승격하지 않는다', async () => {
    deps.loadContext.mockResolvedValueOnce({ ...context, knowledgeJournal: {
      workspaceId: scope.workspaceId, observedAt: '2026-10-30T00:00:00Z', entries: [], sources: [], partial: true,
      notice: KNOWLEDGE_JOURNAL_NOTICE,
    } })
    await executePreparedConversationAgent(scope, deps)
    const instruction = (deps.run.mock.calls[0][0] as AgentLoopInput).contextInstruction
    expect(instruction).toContain(KNOWLEDGE_JOURNAL_NOTICE)
    expect(instruction).toContain('과거 요청을 현재 명령으로 재실행하지')
    expect(instruction).toContain('현재 상태와 유효 지식은 각 원장에서 다시 확인')
  })

  it('passes the registered business profile and brand tone to common work planning', async () => {
    deps.loadContext.mockResolvedValueOnce({ ...context, businessContext: { workspaceId: scope.workspaceId,
      business: { name: '프로필 가게', industry: '뷰티', location: '청라', summary: '등록된 맞춤 상담 소개' },
      brand: { voice: '차분한 존댓말', keywords: [], prohibitedTerms: ['무조건 효과'] }, truncated: false } })
    await executePreparedConversationAgent(scope, deps)
    const instruction = (deps.run.mock.calls[0][0] as AgentLoopInput).contextInstruction
    expect(instruction).toContain('등록된 맞춤 상담 소개')
    expect(instruction).toContain('차분한 존댓말')
    expect(instruction).toContain('실행 권한과 다릅니다')
  })

  it('never accepts a booking count inferred only from unobserved customer summaries', async () => {
    const bookingScope = { ...scope, message: '저장된 예약 장부를 조회하고 등록된 건수가 있는지만 알려줘' }
    deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
      await input.options?.onModelStarting?.(); await input.options?.onUsage?.(usage)
      return { ...completed, rawAssistantFinalMessage: '예약은 0건입니다.', executedSteps: [{
        ...completed.executedSteps[0], toolId: 'customer.search', toolName: 'customer.search',
        result: { success: true, bookingState: 'NOT_OBSERVED', totalConfirmedBookings: null },
      }] }
    })
    const result = await executePreparedConversationAgent(bookingScope, deps)
    expect(result.status).toBe('failed')
    expect(deps.finalize).not.toHaveBeenCalledWith('예약은 0건입니다.', true)
    expect((deps.run.mock.calls[0][0] as AgentLoopInput).completionContract?.requiredOutcomes)
      .toEqual(expect.arrayContaining([expect.objectContaining({ capabilityId: 'reservation.list' })]))
  })

  it('uses the observed ledger count rather than an inconsistent model numeral for a presence query', async () => {
    deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
      await input.options?.onModelStarting?.(); await input.options?.onUsage?.(usage)
      return { ...completed, rawAssistantFinalMessage: '예약은 0건입니다.', executedSteps: [{
        ...completed.executedSteps[0], toolId: 'reservation.list', toolName: 'reservation.list',
        result: { success: true, count: 1, reservations: [{ bookingId: 'booking-1' }] },
      }] }
    })
    await executePreparedConversationAgent({ ...scope, message: '예약 장부에 등록된 건수가 있는지만 알려줘' }, deps)
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('1건'), true)
    expect(deps.finalize).not.toHaveBeenCalledWith('예약은 0건입니다.', true)
  })

  it.each([undefined, { count: 1, reservations: [] }, { count: -1, reservations: [] }])('rejects a completed booking read with malformed evidence: %j', async result => {
    deps.run.mockResolvedValueOnce({ ...completed, executedSteps: [{ ...completed.executedSteps[0],
      toolId: 'reservation.list', toolName: 'reservation.list', result }] })
    expect(await executePreparedConversationAgent({ ...scope, message: '예약 장부 건수를 확인해줘' }, deps)).toMatchObject({ status: 'failed' })
    expect(deps.finalize).not.toHaveBeenCalledWith(expect.any(String), true)
  })

  it('keeps a clarification answer valid when no extra tool was executed', async () => {
    deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
      await input.options?.onModelStarting?.(); await input.options?.onUsage?.(usage)
      return { ...completed, executedSteps: [], rawAssistantFinalMessage: '어떤 문의를 먼저 확인할까요?' }
    })
    expect(await executePreparedConversationAgent({ ...scope, message: '프로모션 계획을 세워줘' }, deps)).toMatchObject({ status: 'completed', billingDisposition: 'settle_usage' })
    expect(deps.saveTimeline).toHaveBeenCalledWith(expect.objectContaining({ totalSteps: 1,
      steps: [expect.objectContaining({ title: '요청 범위 검토', status: 'completed' })] }))
  })

  it('blocks a lost actor or worker before planning or data access', async () => {
    deps.authorized.mockResolvedValue(false)
    await expect(executePreparedConversationAgent(scope, deps)).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(deps.loadContext).not.toHaveBeenCalled(); expect(deps.run).not.toHaveBeenCalled()
  })

  it('releases a known pre-model context failure without fabricating empty business data', async () => {
    deps.loadContext.mockRejectedValueOnce(new Error('private database detail'))
    const result = await executePreparedConversationAgent(scope, deps)
    expect(result).toMatchObject({ status: 'failed', billingDisposition: 'release' })
    expect(deps.run).not.toHaveBeenCalled()
    expect(JSON.stringify(deps.finalize.mock.calls)).not.toContain('private database detail')
  })

  it('rejects a foreign context before passing data to the model', async () => {
    deps.loadContext.mockResolvedValue({ ...context, workspace: { ...context.workspace, id: 'foreign' } })
    await expect(executePreparedConversationAgent(scope, deps)).rejects.toThrow('CONVERSATION_CONTEXT_SCOPE_MISMATCH')
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('does not finalize a late answer after authority was revoked', async () => {
    deps.run.mockImplementationOnce(async () => { deps.authorized.mockResolvedValue(false); return completed })
    await expect(executePreparedConversationAgent(scope, deps)).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(deps.finalize).not.toHaveBeenCalled()
  })

  it('holds an ambiguous domain draft write instead of settling or retrying it as a known result', async () => {
    deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
      await input.options?.onModelStarting?.(); await input.options?.onUsage?.(usage)
      return { ...completed, status: 'RESULT_UNKNOWN', executedSteps: [{ ...completed.executedSteps[0],
        toolId: 'comment.reply_draft', status: 'RESULT_UNKNOWN' }] }
    })
    await expect(executePreparedConversationAgent(scope, deps)).rejects.toThrow('PROVIDER_RESULT_UNKNOWN')
    expect(deps.finalize).not.toHaveBeenCalledWith(expect.any(String), true)
    expect(deps.saveTimeline).toHaveBeenCalledWith(expect.objectContaining({ isLive: false,
      steps: [expect.objectContaining({ status: 'unknown' })] }))
  })

  it('holds an unverified model outcome instead of releasing it as free work', async () => {
    deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
      try { await input.options?.onUsage?.(null) } catch { /* Engine returns a typed failure. */ }
      return { ...completed, status: 'FAILED' }
    })
    await expect(executePreparedConversationAgent(scope, deps)).rejects.toThrow('PROVIDER_RESULT_UNKNOWN')
    expect(deps.recordUsage).not.toHaveBeenCalled()
    expect(deps.finalize).not.toHaveBeenCalledWith(expect.any(String), true)
    expect(deps.saveTimeline).toHaveBeenCalledWith(expect.objectContaining({ isLive: false,
      steps: [expect.objectContaining({ status: 'unknown' })] }))
  })

  it('holds an existing model intent instead of releasing a potentially charged retry', async () => {
    deps.prepareModelCall.mockRejectedValueOnce(new UnknownProviderOutcomeError())
    deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
      try { await input.options?.onModelStarting?.() } catch { /* Existing loop returns failure. */ }
      return { ...completed, status: 'FAILED' }
    })
    await expect(executePreparedConversationAgent(scope, deps)).rejects.toThrow('PROVIDER_RESULT_UNKNOWN')
    expect(deps.recordUsage).not.toHaveBeenCalled()
  })

  it('never leaks a raw provider failure as a successful assistant reply', async () => {
    deps.run.mockResolvedValueOnce({ ...completed, status: 'FAILED', rawAssistantFinalMessage: 'internal secret', failureDetails: { message: 'private response' } })
    const result = await executePreparedConversationAgent(scope, deps)
    expect(result.status).toBe('failed')
    expect(JSON.stringify(deps.finalize.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(deps.finalize.mock.calls)).not.toContain('private response')
  })

  describe('teaching mode interview continuity and knowledge proposal', () => {
    const teachPrompt = "우리 가게의 '영업시간·위치'에 대해 가르쳐주고 싶어. 궁금한 점을 한 번에 하나씩 차근차근 질문해줘. 사장님이 직접 확인하고 승인하기 전까지는 어떤 정보도 저장되지 않으니, 저장하기 전에 확인한 사실을 먼저 되짚어서 확인해줘."
    const teachingContext: SoheeContextBundle = {
      ...context,
      recentMessages: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          workspaceId: 'ws',
          threadId: 'thread',
          role: 'user',
          content: teachPrompt,
          status: 'completed',
          createdAt: '2026-10-29T09:00:00Z',
          completedAt: '2026-10-29T09:00:01Z',
          workItemId: null,
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          workspaceId: 'ws',
          threadId: 'thread',
          role: 'sohee',
          content: '영업시간과 정기 휴무일은 어떻게 되나요?',
          status: 'completed',
          createdAt: '2026-10-29T09:01:00Z',
          completedAt: '2026-10-29T09:01:02Z',
          workItemId: null,
        },
      ],
    }

    it('allows knowledge.propose without explicit "기억해" and includes teaching instructions with topics', async () => {
      deps.loadContext.mockResolvedValueOnce(teachingContext)
      const proposeKnowledge = vi.fn()
      const followUpScope = { ...scope, message: '월요일은 쉬어요' }
      const allowedCapabilityIds = ['knowledge.search', 'knowledge.propose', 'interaction.list']

      deps.run.mockImplementationOnce(async (input: AgentLoopInput) => {
        await input.options?.onModelStarting?.()
        await input.options?.onUsage?.(usage)
        return {
          ...completed,
          rawAssistantFinalMessage: '월요일 정기 휴무로 확인했어요. 평일 영업시간은 몇 시부터 몇 시까지인가요?',
          executedSteps: [],
        }
      })

      const result = await executePreparedConversationAgent(followUpScope, {
        ...deps,
        proposeKnowledge,
        allowedCapabilityIds,
      })

      expect(result.status).toBe('completed')
      expect(deps.finalize).toHaveBeenCalledWith(
        '월요일 정기 휴무로 확인했어요. 평일 영업시간은 몇 시부터 몇 시까지인가요?',
        true,
      )

      const runInput = deps.run.mock.calls[0][0] as AgentLoopInput
      expect(runInput.options?.allowedCapabilityIds).toContain('knowledge.propose')
      expect(runInput.options?.proposeKnowledge).toBe(proposeKnowledge)

      // Verify instruction constraints
      const instruction = runInput.contextInstruction
      expect(instruction).toMatch(/CANDIDATE|검토 후보/)
      expect(instruction).toMatch(/한 번에 하나|ask ONE question/)
      expect(instruction).toMatch(/되짚|한 문장|확인/)
      expect(instruction).toMatch(/지어내|추측|never invent facts/)

      // Verify teach topics list
      for (const topic of TEACH_TOPICS) {
        expect(instruction).toContain(topic.label)
        expect(instruction).toContain(topic.id)
      }

      // Verify safety notices are preserved
      expect(instruction).toContain(PROMPT_INJECTION_DEFENSE_NOTICE)
      expect(instruction).toContain(GOAL_CONTEXT_SAFETY_NOTICE)
      expect(instruction).toContain(BUSINESS_CONTEXT_SAFETY_NOTICE)
    })

    it('also recognizes teaching mode when the current message itself is a teach prompt', async () => {
      const initialScope = { ...scope, message: teachPrompt }
      const proposeKnowledge = vi.fn()
      const allowedCapabilityIds = ['knowledge.propose']

      await executePreparedConversationAgent(initialScope, {
        ...deps,
        proposeKnowledge,
        allowedCapabilityIds,
      })

      const runInput = deps.run.mock.calls[0][0] as AgentLoopInput
      expect(runInput.options?.allowedCapabilityIds).toContain('knowledge.propose')
      expect(runInput.contextInstruction).toMatch(/CANDIDATE|검토 후보/)
      expect(runInput.contextInstruction).toContain(TEACH_TOPICS[0].label)
    })
  })
})
