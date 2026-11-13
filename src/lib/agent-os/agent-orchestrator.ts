/**
 * Sohee V0.8.9 Agent Orchestrator (ANI-651, ANI-652, ANI-656)
 * 
 * Pipeline:
 * Turn Intake ➔ Thread Context ➔ Long-term Memory Retrieval ➔ Intent Classification (DRAFT vs EXECUTE)
 * ➔ Structured Plan ➔ Risk/Policy/Entitlement Gate ➔ Tool DAG ➔ Durable Run
 * ➔ Step Execution ➔ Verification ➔ Memory Commit ➔ 4 Execution Cards ➔ Final Answer
 */

import { ConversationBrain } from '@/lib/ai/conversation-brain'
import { buildCanonicalTurnContext } from '@/lib/agent/conversation-context'
import { ActionWorker } from '@/lib/ai/action-worker'
import type { ImageAsset } from '@/lib/ai/image-worker'
import { getOpenAIToolDefinitions, SOHEE_CAPABILITY_REGISTRY, resolveCapabilityId } from './mcp-capability-registry'
import { LongTermMemoryService } from '@/lib/memory/long-term-memory-service'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { PublishingExecutor } from './executors/publishing-executor'
import { AgentSessionService } from '@/features/agent-session/agent-session-service'
import { CanonicalSurfaceContext } from '@/features/agent-session/types'
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher'
import { AgentLoopEngine, ActionGraph, type AgentProgressEvent } from '@/features/tool-runtime/agent-loop-engine'
import type { InteractionIntentMode } from './executors/interaction-executor'
import { PersistenceError } from '@/lib/errors/persistence-error'
import { buildWorkspaceMarketingContext, type WorkspaceMarketingContext } from './workspace-marketing-context'
import { MarketingWorkService, shouldCreateWorkItem } from './marketing-work-service'
import { MarketingMissionService } from '@/features/missions/marketing-mission-service'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { appendActivity } from '@/features/agent-activity/activity-store'
import type { AgentActivityEvent, ActivityKind } from '@/features/agent-activity/activity-event'

import { parseMissionPlanChange, reviseMissionPlan, type MissionPlanRevision } from '@/features/agent-activity/mission-plan-revision'

import { projectPublicChatResult } from './public-chat-result'

export interface OrchestrationInput {
  workspaceId: string
  sessionId?: string
  threadId?: string
  clientMessageId?: string
  userId?: string
  surfaceContext?: CanonicalSurfaceContext | Record<string, unknown> | string
  userMessage: string
  missionId?: string
  previousRunId?: string
  expectedPlanVersion?: number
  conversationHistory?: Array<{ role: string; content: string }>
  isTestAccount?: boolean
  onProgress?: (e: AgentProgressEvent) => void
  onRunCreated?: (runId: string, threadId?: string) => void
  onActivity?: (event: AgentActivityEvent) => void
}

export interface PlanCardData {
  planId: string
  title: string
  steps: { name: string; sc: number; risk?: string; riskLabel?: string }[]
  totalSC: number
  requiresApproval: boolean
  diffSummary?: string
}

export interface LiveExecutionCardData {
  planId: string
  progressPercentage: number
  currentStepName: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  logs: string[]
}

export interface DecisionCardData {
  decisionId: string
  title: string
  options: { id: string; label: string; description?: string; sc?: number }[]
  diffSummary?: string
  diff?: {
    before?: Record<string, unknown> | string
    after?: Record<string, unknown> | string
  } | string
}

export interface EvidenceResultCardData {
  settledSC: number
  verifiedUrls: { channel: string; url: string; httpStatus: number }[]
  navUrl?: string
  navLabel?: string
}

export interface OrchestrationOutput {
  sessionId?: string
  threadId: string
  runId: string
  workItemId?: string | null
  missionId?: string | null
  planVersion?: number
  contextVersion?: string
  replyContent: string
  step: 'MCP_TOOL_EXECUTED' | 'GENERAL_REPLY' | 'INTERVIEW_QUESTION' | 'AWAITING_APPROVAL' | 'BLOCKED'
  toolName?: string
  visualImage?: ImageAsset | null
  preview?: Record<string, unknown> | null
  mcpAction?: Record<string, unknown> | null
  planCard?: PlanCardData | null
  liveExecutionCard?: LiveExecutionCardData | null
  approvalCard?: DecisionCardData | null
  evidenceResultCard?: EvidenceResultCardData | null
  failureCard?: {
    errorCode: string
    message: string
    step: string
  } | null
  variants?: Array<Record<string, unknown>>
  topic?: string
  draftId?: string
  openInStudioPath?: string
  actionGraph?: ActionGraph | null
  creditDeduction: {
    textTokens: number
    textSC: number
    imageUnits: number
    imageSC: number
    totalDeductedSC: number
    reason: string
  }
}

export class AgentOrchestrator {
  /**
   * Helper: Classify DRAFT vs EXECUTE Intent (Spec 03 Section 13)
   * - DRAFT: "답변 써줘", "원고 작성해줘", "초안", "답변 문구만"
   * - EXECUTE: "답변 보내줘", "발송해줘", "올려줘", "게시해줘", "즉시 발행"
   */
  public static classifyIntentMode(prompt: string): InteractionIntentMode {
    const draftKeywords = ['써줘', '작성해줘', '초안', '문구만', '시안', '만들어줘', '준비해줘', '어떻게 답할까']
    const executeKeywords = ['보내줘', '발송해줘', '올려줘', '게시해줘', '전송해줘', '등록해줘', '실행해줘']

    const hasExecute = executeKeywords.some(kw => prompt.includes(kw))
    const hasDraft = draftKeywords.some(kw => prompt.includes(kw))

    if (hasExecute && !hasDraft) return 'EXECUTE'
    if (hasDraft && !hasExecute) return 'DRAFT'
    // Default to DRAFT for defensive safety if ambiguous
    return hasExecute ? 'EXECUTE' : 'DRAFT'
  }

  public static async executeTurn(input: OrchestrationInput): Promise<OrchestrationOutput> {
    const traceId = `trc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const intentMode = this.classifyIntentMode(input.userMessage)
    
    // 1. Session & Thread Context Setup (Durable Conversation DB & Agent Session SSOT)
    let activeSessionId = input.sessionId
    let activeThreadId = input.threadId

    if (activeSessionId || input.surfaceContext) {
      const surfaceObj: CanonicalSurfaceContext =
        typeof input.surfaceContext === 'object' && input.surfaceContext !== null
          ? (input.surfaceContext as CanonicalSurfaceContext)
          : typeof input.surfaceContext === 'string'
          ? { route: '/app', metadata: { rawPrompt: input.surfaceContext } }
          : { route: '/app' }

      const sessionRes = await AgentSessionService.resolveOrCreateSession({
        workspaceId: input.workspaceId,
        sessionId: activeSessionId,
        threadId: activeThreadId,
        surface: surfaceObj,
      })
      activeSessionId = sessionRes.session.sessionId
      activeThreadId = sessionRes.session.threadId
    } else if (!activeThreadId) {
      const newThread = await ConversationRepository.createThread(input.workspaceId, input.userMessage.slice(0, 40))
      if (!newThread?.id) {
        throw new PersistenceError('executeTurn', 'Failed to create canonical thread for turn')
      }
      activeThreadId = newThread.id
    }

    // Save User Message (Fail-Closed: zero downstream execution if persistence fails)
    const userMessageId = await ConversationRepository.saveMessage(
      input.workspaceId,
      activeThreadId,
      'user',
      input.userMessage,
      {
        clientMessageId: input.clientMessageId,
      }
    )

    // The unique workspace/user-message constraint elects one executor before any planning mutation.
    const runId = await ConversationRepository.createAgentRun(
      input.workspaceId, activeThreadId, input.userMessage, { traceId, intentMode, sessionId: activeSessionId }, traceId, userMessageId,
    )

    try {
    const historyResult = await ConversationRepository.getThreadMessagesResult(input.workspaceId, activeThreadId, 100)
    if (historyResult.state === 'ERROR') throw new PersistenceError('executeTurn:history', 'Canonical conversation history unavailable')
    const turnContext = buildCanonicalTurnContext({
      workspaceId: input.workspaceId, threadId: activeThreadId, currentMessageId: userMessageId,
      messages: historyResult.data, historyLimitReached: historyResult.data.length >= 100,
    })
    let revision: MissionPlanRevision | undefined
    if (parseMissionPlanChange(input.userMessage)) {
      if (!input.missionId || !input.previousRunId || !activeThreadId || input.expectedPlanVersion === undefined) {
        throw new Error('PLAN_CONFLICT')
      }
      revision = await reviseMissionPlan(createAdminSupabaseClient(), {
        workspaceId: input.workspaceId, missionId: input.missionId, runId: input.previousRunId,
        threadId: activeThreadId, expectedVersion: input.expectedPlanVersion, message: input.userMessage,
      })
    }
    const missionTraceId = revision?.traceId || traceId
    const planVersion = revision?.version ?? 0
    const constraintSummary = revision ? [
      revision.constraints.channels ? '인스타그램만 사용' : '',
      revision.constraints.excludeDiscounts ? '할인 제외' : '',
    ].filter(Boolean).join(' · ') : ''
    const planningPrompt = revision
      ? `${input.userMessage}\n기존 임무의 계획 수정입니다. 유지할 조건: ${constraintSummary}. 수정 초안을 준비하고 새 승인을 요청하세요. 이전 승인은 만료되었으며 외부 실행은 금지됩니다.`
      : input.userMessage

    // 2. Build Authoritative Workspace Marketing Context (ANI-1039, ANI-1055)
    const marketingContext = await buildWorkspaceMarketingContext(input.workspaceId)

    // 3. Marketing WorkItem & Mission SSOT (ANI-1040, ANI-1192, ANI-1210)
    let workItemId: string | null = revision?.workItemId || null
    let missionId: string | null = revision?.missionId || null
    if (!revision && shouldCreateWorkItem(input.userMessage, intentMode)) {
      try {
        const workRes = await MarketingWorkService.ensureMarketingWorkItem({
          workspaceId: input.workspaceId,
          threadId: activeThreadId,
          messageId: userMessageId,
          userPrompt: input.userMessage,
          actorId: input.userId,
        })
        workItemId = workRes.workItem.id

        // Ensure canonical Marketing Mission
        const adminClient = createAdminSupabaseClient()
        const missionService = new MarketingMissionService(adminClient)
        const mission = await missionService.ensureMarketingMission({
          workspaceId: input.workspaceId,
          traceId: missionTraceId,
          goal: input.userMessage,
          sourceMessageId: userMessageId,
          actorType: 'user',
          actorId: input.userId,
          metadata: {
            threadId: activeThreadId,
            workItemId,
            intentMode,
          },
        })
        missionId = mission.id
      } catch (workErr) {
        console.warn('[AgentOrchestrator] Non-fatal work_item or mission creation error:', workErr)
      }
    }

    // 4. Long-term Memory Retrieval (Hybrid / Semantic)
    const memories = await LongTermMemoryService.retrieveRelevantMemories(
      input.workspaceId,
      [input.userMessage]
    )
    const contextFactSummary = `${turnContext.instruction}\n참고 데이터(실행 권한 아님): ${JSON.stringify({
      memories: memories.map(m => ({ sourceId: m.id, subject: m.subject, content: m.factContent })),
      conversationProvenance: turnContext.provenance,
    })}`

    // 5. Enrich the already-claimed canonical run; never create a second executor.
    await ConversationRepository.updateAgentRunPlanData(runId, {
        traceId,
        intentMode,
        keywords: [input.userMessage],
        contextVersion: marketingContext.contextVersion,
        sessionId: activeSessionId,
        workItemId: workItemId || undefined,
        missionId: missionId || undefined,
        planVersion,
        ...(revision ? { planConstraints: revision.constraints } : {}),
    })

      if (input.onRunCreated) {
        try {
          input.onRunCreated(runId, activeThreadId)
        } catch {
          // Swallow callback errors to ensure execution continues safely
        }
      }

      // Serialize append + publish even when independent read handlers run in parallel.
      // Subscriber failure never erases a committed fact; storage failure stops execution.
      const activityDb = createAdminSupabaseClient()
      let activityQueue = Promise.resolve()
      const recordActivity = (fact: { kind: ActivityKind; stepId?: string; dedupeKey: string }): Promise<void> => {
        activityQueue = activityQueue.then(async () => {
          const event = await appendActivity(activityDb, {
            workspaceId: input.workspaceId, runId, simulated: input.isTestAccount === true, ...fact,
          })
          try { input.onActivity?.(event) } catch { /* Reconnect replays the committed event. */ }
        })
        return activityQueue
      }
      await recordActivity({ kind: 'request_received', dedupeKey: 'request' })

      // 5.1 Authoritative Mission Spine Binding & State Transition (ANI-1233)
      if (missionId) {
        try {
          const adminClient = createAdminSupabaseClient()
          const missionService = new MarketingMissionService(adminClient)
          await missionService.bindSourceConversationJob({
            workspaceId: input.workspaceId,
            missionId,
            traceId: missionTraceId,
            sourceConversationJobId: runId,
          })
          await missionService.transitionMission({
            workspaceId: input.workspaceId,
            missionId,
            traceId: missionTraceId,
            toStatus: 'PLANNING',
            actorType: 'agent',
            reason: 'Agent run created, starting plan evaluation',
            eventName: 'MISSION_PLANNING',
          })
        } catch (bindErr) {
          console.warn('[AgentOrchestrator] Failed to bind runId or transition mission:', bindErr)
        }
      }

      // 6. Multi-Tool Iterative Loop (ANI-919: Planner ➔ Execute ➔ Tool Output Re-injection Loop)
      await ConversationRepository.updateAgentRunStatus(runId, 'executing', false, undefined, {
        workspaceId: input.workspaceId, onlyRunning: true,
      })

      await recordActivity({ kind: 'planning_summary', dedupeKey: 'planning' })
      const history = turnContext.history
      const loopResult = await AgentLoopEngine.run({
        workspaceId: input.workspaceId,
        sessionId: activeSessionId,
        actionRunId: runId,
        correlationId: traceId,
        userPrompt: planningPrompt,
        conversationHistory: history,
        contextInstruction: contextFactSummary,
        surfaceContext: input.surfaceContext,
        intentMode: revision || turnContext.truncated ? 'DRAFT' : intentMode,
        isTestAccount: input.isTestAccount,
        actorId: input.userId,
        userId: input.userId,
        options: {
          maxSteps: 5,
          timeoutMs: 60000,
          canContinue: () => ConversationRepository.isAgentRunExecutable(input.workspaceId, runId),
          onProgress: input.onProgress,
          recordActivity,
        }
      })

      const finalToolName = loopResult.primaryToolName
      const visualImage = loopResult.visualImage || null
      const preview: Record<string, unknown> | null = null
      const mcpAction = loopResult.mcpAction || null
      const toolExecutionResult = loopResult.lastToolExecutionResult

      const {
        planCard,
        liveExecutionCard,
        approvalCard,
        evidenceResultCard,
        failureCard
      } = loopResult.cards || {}

      // 6.1 Downstream Mission Lineage & Lifecycle Synchronization (ANI-1233)
      if (missionId) {
        try {
          const adminClient = createAdminSupabaseClient()
          const missionService = new MarketingMissionService(adminClient)

          // Bind Approval if present in cards
          if (approvalCard && (approvalCard as any).approvalId) {
            await missionService.bindContentAndApproval({
              workspaceId: input.workspaceId,
              missionId,
              traceId: missionTraceId,
              approvalId: (approvalCard as any).approvalId,
            })
          }

          // Bind Content / Version / Actions from executed steps
          for (const step of loopResult.executedSteps) {
            const res = (step.result || {}) as Record<string, any>
            if (res.contentId || res.versionId || res.bundleId) {
              await missionService.bindContentAndApproval({
                workspaceId: input.workspaceId,
                missionId,
                traceId: missionTraceId,
                contentItemId: res.contentId,
                contentVersionId: res.versionId,
                creativeBundleId: res.bundleId,
              })
            }
            if (res.actionRequestId || res.actionAttemptId || res.receiptId) {
              await missionService.bindExternalAction({
                workspaceId: input.workspaceId,
                missionId,
                traceId: missionTraceId,
                actionRequestId: res.actionRequestId,
                actionAttemptId: res.actionAttemptId,
                actionReceiptId: res.receiptId,
                providerPostReference: res.permalink || res.providerPostId,
              })
            }
          }

          // Synchronize Mission Status
          if (loopResult.status === 'AWAITING_APPROVAL') {
            await missionService.transitionMission({
              workspaceId: input.workspaceId,
              missionId,
              traceId: missionTraceId,
              toStatus: 'AWAITING_APPROVAL',
              actorType: 'agent',
              reason: 'Generated creative content requires owner approval',
              ownerActionRequired: true,
            })
          } else if (loopResult.status === 'COMPLETED') {
            const publishStep = loopResult.executedSteps.find(
              s => (s.toolId === 'publish.create' || s.toolName === 'mcp_publish_live') && s.status === 'COMPLETED'
            )
            const targetStatus = publishStep ? 'PUBLISHED_VERIFIED' : 'COMPLETED'
            await missionService.transitionMission({
              workspaceId: input.workspaceId,
              missionId,
              traceId: missionTraceId,
              toStatus: targetStatus,
              actorType: 'agent',
              reason: publishStep ? 'External action verified published' : 'Agent completed mission objectives',
            })
          } else if (loopResult.status === 'BLOCKED') {
            await missionService.transitionMission({
              workspaceId: input.workspaceId,
              missionId,
              traceId: missionTraceId,
              toStatus: 'BLOCKED',
              actorType: 'agent',
              reason: 'Mission blocked by policy or execution constraint',
            })
          }
        } catch (missionSyncErr) {
          console.warn('[AgentOrchestrator] Failed to synchronize downstream mission lineage:', missionSyncErr)
        }
      }

      // 5. Conversation Brain: Synthesize Final User-Facing Answer (GPT 5.6 Luna Max)
      const convInputMessages = [
        ...history.map(m => ({ role: m.role as any, content: m.content })),
        { role: 'user' as const, content: input.userMessage }
      ]

      const brainResult = await ConversationBrain.generateResponse({
        messages: convInputMessages,
        workspaceId: input.workspaceId,
        contextFactSummary,
        marketingContext,
        surfaceContext: input.surfaceContext,
        toolExecutionResult,
        toolExecutionResults: loopResult.accumulatedToolResults,
        actionGraph: loopResult.actionGraph as unknown as Record<string, unknown>,
        loopStatus: loopResult.status
      })

      // 6. Memory Commit (Episodic Memory on major actions)
      const publishStep = loopResult.executedSteps.find(
        s => (s.toolId === 'publish.create' || s.toolName === 'mcp_publish_live') && s.status === 'COMPLETED'
      )
      if (publishStep?.result?.success) {
        await LongTermMemoryService.storeMemory(input.workspaceId, {
          memoryClass: 'episodic',
          subject: '공식 SNS 게시 완료',
          factContent: `${publishStep.result.channel || 'SNS'}에 콘텐츠 게시 완료 (URL: ${publishStep.evidence?.url || publishStep.result.publishedUrl})`,
          provenanceType: 'agent_run',
          provenanceId: runId
        })
      }

      // 6.1 Channel Learning Post-Turn Gate (ANI-2192)
      // If channel knowledge was ground into the turn context, verify that sources were not revoked mid-turn
      let channelLearningRevoked = false
      if (
        marketingContext.learnedChannelKnowledge?.dependencies &&
        marketingContext.learnedChannelKnowledge.dependencies.length > 0
      ) {
        try {
          const { createSupabaseConsumerGate, validateLearningResult } = await import('@/features/channel-learning/consumer-gate')
          const adminClient = createAdminSupabaseClient()
          const gate = createSupabaseConsumerGate(adminClient, 'conversation')
          const isValid = await validateLearningResult(
            {
              workspaceId: input.workspaceId,
              epoch: marketingContext.learnedChannelKnowledge.epoch,
              dependencies: marketingContext.learnedChannelKnowledge.dependencies,
              purpose: 'conversation',
            },
            gate
          )

          if (!isValid) {
            console.warn('[AgentOrchestrator] Channel learning source revoked during conversation turn')
            brainResult.content = '매장 공식 채널 정보가 변경되어 이전 정보로 답변을 완료하지 못했어요. 다시 한 번 말씀해 주세요.'
            channelLearningRevoked = true
          }
        } catch (gateErr) {
          console.warn('[AgentOrchestrator] Failed to validate learning dependencies post-turn:', gateErr)
          brainResult.content = '매장 공식 채널 정보 확인 중 오류가 발생하여 안전을 위해 답변을 완료하지 못했어요. 다시 한 번 말씀해 주세요.'
          channelLearningRevoked = true
        }
      }

      // 7. Save Sohee Message to Durable Thread
      const assistantMessageId = await ConversationRepository.saveMessage(
        input.workspaceId,
        activeThreadId,
        'sohee',
        brainResult.content,
        {
          toolCalls: loopResult.executedSteps.map(s => ({
            id: s.toolCallId,
            name: s.toolName,
            arguments: s.arguments,
            status: s.status
          })),
          runId,
          missionId,
          planVersion,
          planDiffSummary: revision ? constraintSummary : undefined,
          evidenceRefs: loopResult.accumulatedToolResults,
          actionGraph: loopResult.actionGraph,
          publicChatResult: projectPublicChatResult({
            content: brainResult.content, threadId: activeThreadId, runId, missionId, planVersion,
            step: loopResult.status === 'AWAITING_APPROVAL' ? 'AWAITING_APPROVAL'
              : loopResult.status === 'BLOCKED' ? 'BLOCKED' : 'GENERAL_REPLY',
            planCard: planCard && revision ? { ...planCard, diffSummary: constraintSummary } : planCard,
            approvalCard, evidenceResultCard,
            openInStudioPath: (toolExecutionResult?.data as Record<string, unknown> | undefined)?.openInStudioPath,
          }),
        }
      )

      await ConversationRepository.updateAgentRunStatus(
        runId,
        loopResult.status === 'AWAITING_APPROVAL' ? 'awaiting_approval'
          : loopResult.status === 'COMPLETED' ? 'completed' : 'failed',
        loopResult.status !== 'AWAITING_APPROVAL',
        assistantMessageId,
        { workspaceId: input.workspaceId, onlyRunning: true }
      )

      // 8. Cost / Credit Accounting
      const totalTokens = loopResult.totalTokens + brainResult.totalTokens
      const textSC = channelLearningRevoked ? 0 : Math.max(1, Math.ceil(totalTokens / 300))
      const imageUnits = visualImage ? 1 : 0
      const imageSC = visualImage?.costSC || 0
      const totalDeductedSC = input.isTestAccount || channelLearningRevoked ? 0 : textSC + loopResult.totalCreditsDeducted

      const returnStep =
        loopResult.status === 'AWAITING_APPROVAL'
          ? 'AWAITING_APPROVAL'
          : loopResult.status === 'BLOCKED'
          ? 'BLOCKED'
          : loopResult.executedSteps.length > 0
          ? 'MCP_TOOL_EXECUTED'
          : 'GENERAL_REPLY'

      return {
        sessionId: activeSessionId,
        threadId: activeThreadId,
        runId,
        workItemId,
        missionId,
        planVersion,
        contextVersion: marketingContext.contextVersion,
        replyContent: brainResult.content,
        step: returnStep,
        toolName: finalToolName,
        visualImage,
        preview,
        mcpAction,
        planCard: planCard && revision ? { ...planCard, diffSummary: constraintSummary } : planCard,
        liveExecutionCard,
        approvalCard,
        evidenceResultCard,
        failureCard,
        variants: (toolExecutionResult?.data as any)?.variants,
        topic: (toolExecutionResult?.data as any)?.topic,
        draftId: (toolExecutionResult?.data as any)?.draftId,
        openInStudioPath: (toolExecutionResult?.data as any)?.openInStudioPath,
        actionGraph: loopResult.actionGraph,
        creditDeduction: {
          textTokens: totalTokens,
          textSC: input.isTestAccount ? 0 : textSC,
          imageUnits,
          imageSC: input.isTestAccount ? 0 : imageSC,
          totalDeductedSC,
          reason: input.isTestAccount
            ? '테스트 계정 (크레딧 무제한)'
            : loopResult.totalCreditsDeducted > 0
              ? `GPT 5.6 Luna Max 추론(${totalTokens} 토큰) + 작업 비용(${loopResult.totalCreditsDeducted} SC)`
              : `GPT 5.6 Luna Max 추론 및 실행 (${totalTokens} 토큰)`
        }
      }
    } catch (error) {
      try {
        // Never replay a goal or overwrite an already-terminal execution after a turn error.
        await ConversationRepository.updateAgentRunStatus(runId, 'failed', true, undefined, {
          workspaceId: input.workspaceId, onlyRunning: true, safeErrorCode: 'AGENT_TURN_INTERRUPTED',
        })
      } catch {
        throw new Error('AGENT_RUN_RECOVERY_REQUIRED', { cause: error })
      }
      throw error
    }
  }
}

