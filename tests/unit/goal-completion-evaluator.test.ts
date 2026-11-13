import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CompletionEvaluator,
  type GoalCompletionContract,
  type EvidencePredicate
} from '@/features/tool-runtime/completion-evaluator'
import { AgentLoopEngine, type ActionGraph } from '@/features/tool-runtime/agent-loop-engine'
import { ActionWorker } from '@/lib/ai/action-worker'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state'

describe('Task 1.2 / ANI-948: Goal Completion Contract & CompletionEvaluator', () => {
  const WORKSPACE_ID = 'ws-test-byreum'
  const ACTION_RUN_ID = '00000000-0000-0000-0000-000000000048'
  const CORRELATION_ID = 'corr-evaluator-test'

  beforeEach(() => {
    vi.restoreAllMocks()
    AgentControlPlaneService.resetForTest(WORKSPACE_ID)

    vi.spyOn(ConversationRepository, 'createAgentRun').mockResolvedValue(ACTION_RUN_ID)
    vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined)
    vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue(undefined)
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue(undefined)
    vi.spyOn(ConversationRepository, 'saveMessage').mockResolvedValue('msg-test-id')
  })

  describe('CompletionEvaluator Unit Evaluation', () => {
    it('Test 1: fails completion evaluation when model returns 0 tool calls without required evidence', () => {
      const actionGraph: ActionGraph = {
        runId: ACTION_RUN_ID,
        status: 'RUNNING',
        iterations: 1,
        totalSteps: 0,
        steps: []
      }

      const contract: GoalCompletionContract = {
        goalId: 'goal-publish-instagram',
        goalTitle: '인스타그램 피드 발행 및 라이브 검증',
        hasReadbackEvidence: true,
        hasDurableProof: true,
        requiredEvidence: [
          {
            type: 'readback',
            hasReadbackEvidence: true,
            description: '공식 채널 라이브 URL 및 HTTP 200 검증'
          },
          {
            type: 'durable_proof',
            hasDurableProof: true,
            description: 'Supabase 영속 증거 영수증 ID 존재'
          }
        ]
      }

      const evalResult = CompletionEvaluator.evaluate(actionGraph, contract)

      expect(evalResult.passed).toBe(false)
      expect(evalResult.status).toBe('FAILED')
      expect(evalResult.errorCode).toBe('UNMET_COMPLETION_PREDICATES')
      expect(evalResult.reasons.length).toBeGreaterThan(0)
      expect(evalResult.unmetPredicates).toContain('hasReadbackEvidence')
      expect(evalResult.unmetPredicates).toContain('hasDurableProof')
    })

    it('Test 2: succeeds completion evaluation for multi-step action graph with all verified predicates', () => {
      const actionGraph: ActionGraph = {
        runId: ACTION_RUN_ID,
        status: 'RUNNING',
        iterations: 3,
        totalSteps: 3,
        steps: [
          {
            stepIndex: 1,
            iteration: 1,
            toolCallId: 'call-1-research',
            toolName: 'mcp_search_knowledge',
            toolId: 'knowledge.search',
            arguments: { query: '신규 프로모션' },
            status: 'COMPLETED',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          {
            stepIndex: 2,
            iteration: 2,
            toolCallId: 'call-2-content',
            toolName: 'mcp_generate_content',
            toolId: 'content.generate',
            arguments: { topic: '신규 시술 안내', channel: 'INSTAGRAM' },
            status: 'COMPLETED',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          },
          {
            stepIndex: 3,
            iteration: 3,
            toolCallId: 'call-3-publish',
            toolName: 'mcp_publish_live',
            toolId: 'publish.create',
            arguments: { channel: 'INSTAGRAM', content: '봄맞이 속눈썹 펌 20% 할인' },
            status: 'COMPLETED',
            evidence: {
              channel: 'instagram',
              url: 'https://instagram.com/p/DF_test123',
              httpStatus: 200,
              receiptId: 'rcpt-proof-999',
              hasReadbackEvidence: true,
              hasDurableProof: true
            },
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
          }
        ],
        finalEvidence: {
          channel: 'instagram',
          url: 'https://instagram.com/p/DF_test123',
          httpStatus: 200
        }
      }

      const contract: GoalCompletionContract = {
        goalId: 'goal-publish-instagram',
        hasReadbackEvidence: true,
        hasDurableProof: true,
        requiredEvidence: [
          {
            type: 'readback',
            hasReadbackEvidence: true
          },
          {
            type: 'durable_proof',
            hasDurableProof: true
          }
        ]
      }

      const evalResult = CompletionEvaluator.evaluate(actionGraph, contract)

      expect(evalResult.passed).toBe(true)
      expect(evalResult.status).toBe('COMPLETED')
      expect(evalResult.reasons).toHaveLength(0)
    })

    it('Test 3: unresolved RESULT_UNKNOWN node blocks COMPLETED transition', () => {
      const actionGraph: ActionGraph = {
        runId: ACTION_RUN_ID,
        status: 'RUNNING',
        iterations: 2,
        totalSteps: 2,
        steps: [
          {
            stepIndex: 1,
            iteration: 1,
            toolCallId: 'call-1',
            toolName: 'mcp_search_knowledge',
            toolId: 'knowledge.search',
            arguments: { query: '매장 정보' },
            status: 'COMPLETED',
            startedAt: new Date().toISOString()
          },
          {
            stepIndex: 2,
            iteration: 2,
            toolCallId: 'call-2',
            toolName: 'mcp_publish_live',
            toolId: 'publish.create',
            arguments: { channel: 'INSTAGRAM', content: '알 수 없는 오류 테스트' },
            status: 'FAILED',
            error: {
              code: 'RESULT_UNKNOWN',
              message: '소셜 채널 응답 지연으로 발행 확인 불가'
            },
            startedAt: new Date().toISOString()
          }
        ],
        nodes: [
          {
            nodeId: 'node-publish-01',
            actionName: 'instagram_publish',
            status: 'RESULT_UNKNOWN'
          }
        ]
      }

      const evalResult = CompletionEvaluator.evaluate(actionGraph)

      expect(evalResult.passed).toBe(false)
      expect(evalResult.status).toBe('FAILED')
      expect(evalResult.errorCode).toBe('RESULT_UNKNOWN_UNRESOLVED')
      expect(evalResult.unresolvedNodes).toContain('node-publish-01')
    })

    it('Test 4: pending mandatory approvals block COMPLETED transition', () => {
      const actionGraph: ActionGraph = {
        runId: ACTION_RUN_ID,
        status: 'RUNNING',
        iterations: 1,
        totalSteps: 1,
        steps: [
          {
            stepIndex: 1,
            iteration: 1,
            toolCallId: 'call-approval-required',
            toolName: 'mcp_publish_live',
            toolId: 'publish.create',
            arguments: { channel: 'INSTAGRAM', content: '원장님 컨펌 필요' },
            status: 'AWAITING_APPROVAL',
            proposal: {
              proposalId: 'prop-123',
              title: '인스타그램 즉시 발행 승인'
            },
            startedAt: new Date().toISOString()
          }
        ]
      }

      const evalResult = CompletionEvaluator.evaluate(actionGraph)

      expect(evalResult.passed).toBe(false)
      expect(evalResult.status).toBe('FAILED')
      expect(evalResult.errorCode).toBe('PENDING_MANDATORY_APPROVALS')
    })

    it('Test 5: mandatory node in non-terminal status blocks COMPLETED transition', () => {
      const actionGraph: ActionGraph = {
        runId: ACTION_RUN_ID,
        status: 'RUNNING',
        iterations: 1,
        totalSteps: 1,
        steps: [],
        nodes: [
          {
            nodeId: 'node-market-research',
            actionName: 'market_research',
            status: 'COMPLETED',
            isMandatory: true
          },
          {
            nodeId: 'node-external-publish',
            actionName: 'external_publish',
            status: 'PENDING',
            isMandatory: true
          }
        ]
      }

      const evalResult = CompletionEvaluator.evaluate(actionGraph)

      expect(evalResult.passed).toBe(false)
      expect(evalResult.status).toBe('FAILED')
      expect(evalResult.errorCode).toBe('UNMET_COMPLETION_PREDICATES')
      expect(evalResult.reasons.some(r => r.includes('node-external-publish'))).toBe(true)
    })
  })

  describe('AgentLoopEngine Integration with CompletionEvaluator', () => {
    it('does NOT transition actionGraph to COMPLETED when model produces 0 toolCalls if completionContract is unmet', async () => {
      // Mock ActionWorker to return 0 tool calls immediately (attempting early completion without work)
      vi.spyOn(ActionWorker, 'planAndCallTools').mockResolvedValueOnce({
        toolCalls: [],
        rawContent: '다 했습니다. 별도의 도구 호출 없이 완료할게요.',
        totalTokens: 60,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      })

      const contract: GoalCompletionContract = {
        goalId: 'goal-must-publish',
        hasReadbackEvidence: true,
        hasDurableProof: true
      }

      const result = await AgentLoopEngine.run({
        workspaceId: WORKSPACE_ID,
        actionRunId: ACTION_RUN_ID,
        correlationId: CORRELATION_ID,
        userPrompt: '인스타그램에 바로 새 소식 게시하고 증거 남겨줘',
        completionContract: contract
      })

      // The core invariant: no tool call != Work completed!
      expect(result.status).toBe('FAILED')
      expect(result.actionGraph.status).toBe('FAILED')
      expect(result.failureDetails?.errorCode).toBe('UNMET_COMPLETION_PREDICATES')
    })
  })
})
