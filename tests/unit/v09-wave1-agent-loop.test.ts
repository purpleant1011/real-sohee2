import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentLoopEngine } from '@/features/tool-runtime/agent-loop-engine';
import { AgentOrchestrator } from '@/lib/agent-os/agent-orchestrator';
import { ActionWorker } from '@/lib/ai/action-worker';
import { ConversationBrain } from '@/lib/ai/conversation-brain';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import { LongTermMemoryService } from '@/lib/memory/long-term-memory-service';

// content.generate 는 4채널 스튜디오(DB 의존)를 호출하므로 실DB 없이 도구 경로를 검증하도록 서비스를 대체한다.
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule());
vi.mock('@/features/channel-studio/compose', async () => (await import('./helpers/fake-channel-studio')).fakeComposeModule());
// ANI-1753: 발행/세션 경로의 DB 조회가 실제 Supabase 로 나가지 않도록 대역을 둔다.
vi.mock('@/lib/supabase/server', async () => (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule());

vi.mock('@/features/creative/creative-bundle-store', () => ({
  SupabaseCreativeBundleStore: class {
    async getLatestBundleForVersion() {
      return { bundleId: 'bundle-reviewed', workspaceId: 'ws-test-byreum', versionId: 'version-reviewed',
        channel: 'instagram', caption: '봄맞이 특별 이벤트 본문', bundleFingerprint: 'fingerprint-reviewed',
        approvedFingerprint: 'fingerprint-reviewed', approvalStatus: 'APPROVED' };
    }
  },
}));

// 루프/보고서 통합만 검증하며 활동 저장은 전용 DB 계약 테스트가 담당한다.
const { appendActivity } = vi.hoisted(() => ({ appendActivity: vi.fn() }));
vi.mock('@/features/agent-activity/activity-store', () => ({ appendActivity }));

describe('ANI-919: Multi-Tool Iterative Agent Loop & ActionGraph Trace Engine', () => {
  const WORKSPACE_ID = 'ws-test-byreum';
  const ACTION_RUN_ID = '00000000-0000-0000-0000-000000000001';
  const CORRELATION_ID = 'corr-agent-loop-test-1';

  beforeEach(() => {
    vi.restoreAllMocks();
    appendActivity.mockReset().mockImplementation(async (_db, input) => ({ ...input, sequence: 1 }));
    AgentControlPlaneService.resetForTest(WORKSPACE_ID);

    // Mock ConversationRepository and Memory DB writes to avoid external network dependency in unit tests
    vi.spyOn(ConversationRepository, 'createThread').mockResolvedValue({
      id: 'th-test-123',
      workspaceId: WORKSPACE_ID,
      title: '테스트 대화',
      kind: 'operations',
      status: 'active',
      modelProfile: 'conversation_gpt_5_6_luna_max',
      lastMessageAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    vi.spyOn(ConversationRepository, 'createAgentRun').mockResolvedValue(ACTION_RUN_ID);
    vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined);
    vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue(undefined);
    vi.spyOn(ConversationRepository, 'beginAgentRunStep').mockResolvedValue(undefined);
    vi.spyOn(ConversationRepository, 'isAgentRunExecutable').mockResolvedValue(true);
    vi.spyOn(ConversationRepository, 'getThreadMessagesResult').mockResolvedValue({ state: 'EMPTY', data: [], observedAt: new Date().toISOString() });
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue(undefined);
    vi.spyOn(ConversationRepository, 'saveMessage').mockResolvedValue('msg-123');
    vi.spyOn(LongTermMemoryService, 'retrieveRelevantMemories').mockResolvedValue([]);
    vi.spyOn(LongTermMemoryService, 'storeMemory').mockResolvedValue('mem-123');
  });

  it('executes 3+ dependent tools sequentially and feeds tool output back to the model in each step', async () => {
    const receivedMessagesHistory: any[][] = [];

    // Mock ActionWorker to return 3 sequential tool calls across 3 iterations
    vi.spyOn(ActionWorker, 'planAndCallTools').mockImplementation(async (input: any) => {
      receivedMessagesHistory.push([...input.messages]);
      const currentTurn = receivedMessagesHistory.length;

      if (currentTurn === 1) {
        return {
          toolCalls: [
            {
              id: 'call_search_1',
              toolName: 'mcp_search_knowledge',
              arguments: { query: '봄맞이 이벤트 규정' }
            }
          ],
          totalTokens: 120,
          modelId: 'gpt-5.6-luna-max',
          role: 'action',
          profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
        };
      }

      if (currentTurn === 2) {
        // Assert tool output from step 1 is present in messages
        const toolMsg = input.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_search_1');
        expect(toolMsg).toBeDefined();

        return {
          toolCalls: [
            {
              id: 'call_content_2',
              toolName: 'mcp_generate_content',
              arguments: {
                topic: '봄맞이 속눈썹 펌 이벤트',
                channel: 'INSTAGRAM',
                tone: '친근하고 세련된'
              }
            }
          ],
          totalTokens: 180,
          modelId: 'gpt-5.6-luna-max',
          role: 'action',
          profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
        };
      }

      if (currentTurn === 3) {
        // Assert tool output from step 2 is present in messages
        const toolMsg2 = input.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_content_2');
        expect(toolMsg2).toBeDefined();

        return {
          toolCalls: [
            {
              id: 'call_publish_3',
              toolName: 'mcp_publish_live',
              arguments: {
                channel: 'INSTAGRAM',
                contentVersionId: 'version-reviewed',
                expectedFingerprint: 'fingerprint-reviewed'
              }
            }
          ],
          totalTokens: 150,
          modelId: 'gpt-5.6-luna-max',
          role: 'action',
          profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
        };
      }

      // Turn 4: Finished
      return {
        toolCalls: [],
        rawContent: '원고 작성 및 게시 승인 요청이 모두 완료되었습니다.',
        totalTokens: 90,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      };
    });

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '봄맞이 이벤트 규정 찾아보고 인스타 원고 써서 게시 준비해줘',
      intentMode: 'DRAFT',
      isTestAccount: true
    });

    // Step 3 was publish.create with isDraft: true -> halts at AWAITING_APPROVAL
    expect(result.status).toBe('AWAITING_APPROVAL');
    expect(result.executedSteps.length).toBe(3);
    expect(result.actionGraph.steps.length).toBe(3);
    expect(result.actionGraph.steps[0].toolId).toBe('knowledge.search');
    expect(result.actionGraph.steps[1].toolId).toBe('content.generate');
    expect(result.actionGraph.steps[2].toolId).toBe('publish.create');
    expect(result.actionGraph.steps[2].status).toBe('AWAITING_APPROVAL');
    expect(result.cards.approvalCard).not.toBeNull();
    expect(result.cards.planCard?.steps.length).toBe(3);
  });

  it('executes safe independent read tools concurrently in parallel', async () => {
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        toolCalls: [
          {
            id: 'call_k_1',
            toolName: 'mcp_search_knowledge',
            arguments: { query: '원장님 시술 철학' }
          },
          {
            id: 'call_c_2',
            toolName: 'mcp_check_credits',
            arguments: {}
          }
        ],
        totalTokens: 100,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      })
      .mockResolvedValueOnce({
        toolCalls: [],
        rawContent: '지식과 크레딧 조회를 마쳤습니다.',
        totalTokens: 50,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      });

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '매장 정보와 잔여 크레딧 한번에 조회해줘',
      options: { allowParallelReads: true }
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.executedSteps.length).toBe(2);
    expect(result.executedSteps[0].iteration).toBe(1);
    expect(result.executedSteps[1].iteration).toBe(1);
    expect(result.actionGraph.totalSteps).toBe(2);
    expect(result.actionGraph.iterations).toBe(2);
  });

  it('catches malformed arguments and feeds structured error back to the model for autonomous correction', async () => {
    let callCount = 0;

    vi.spyOn(ActionWorker, 'planAndCallTools').mockImplementation(async (input: any) => {
      callCount++;
      if (callCount === 1) {
        // Missing required 'channel' according to SOHEE_CAPABILITY_REGISTRY['content.generate']
        return {
          toolCalls: [
            {
              id: 'call_bad_args',
              toolName: 'mcp_generate_content',
              arguments: { topic: '누락된 인자 테스트' } // 'channel' is required!
            }
          ],
          totalTokens: 80,
          modelId: 'gpt-5.6-luna-max',
          role: 'action',
          profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
        };
      }

      if (callCount === 2) {
        // Assert error message was fed to the model
        const toolMsg = input.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_bad_args');
        expect(toolMsg).toBeDefined();
        const parsed = JSON.parse(toolMsg.content);
        expect(parsed.error?.code).toBe('MALFORMED_ARGUMENTS');
        expect(parsed.error?.message).toContain('channel');

        // Model retries with required parameter included
        return {
          toolCalls: [
            {
              id: 'call_good_args',
              toolName: 'mcp_generate_content',
              arguments: { topic: '인자 보완 테스트', channel: 'INSTAGRAM' }
            }
          ],
          totalTokens: 110,
          modelId: 'gpt-5.6-luna-max',
          role: 'action',
          profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
        };
      }

      return {
        toolCalls: [],
        rawContent: '인자 보완 후 원고 생성이 성공적으로 완료되었습니다.',
        totalTokens: 70,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      };
    });

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '원고 써줘'
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.executedSteps.length).toBe(2);
    expect(result.executedSteps[0].status).toBe('FAILED');
    expect(result.executedSteps[0].error?.code).toBe('MALFORMED_ARGUMENTS');
    expect(result.executedSteps[1].status).toBe('COMPLETED');
  });

  it('enforces loop limit as an explicit BLOCKED state, NEVER a fake COMPLETED', async () => {
    // ActionWorker always proposes another tool call indefinitely
    vi.spyOn(ActionWorker, 'planAndCallTools').mockResolvedValue({
      toolCalls: [
        {
          id: 'infinite_call',
          toolName: 'mcp_search_knowledge',
          arguments: { query: '반복 검색' }
        }
      ],
      totalTokens: 50,
      modelId: 'gpt-5.6-luna-max',
      role: 'action',
      profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
    });

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '끝없는 루프 테스트',
      options: { maxSteps: 3 }
    });

    // CRITICAL ACCEPTANCE: loop limit is NOT COMPLETED! It is an explicit BLOCKED!
    expect(result.status).toBe('BLOCKED');
    expect(result.status).not.toBe('COMPLETED');
    expect(result.actionGraph.status).toBe('BLOCKED');
    expect(result.failureDetails?.errorCode).toBe('MAX_STEPS_EXCEEDED');
    expect(result.cards.liveExecutionCard?.status).toBe('FAILED');
    expect(result.cards.failureCard?.errorCode).toBe('MAX_STEPS_EXCEEDED');
  });

  it('halts with explicit BLOCKED on timeout or aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '취소 테스트',
      options: { signal: controller.signal }
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.failureDetails?.errorCode).toBe('ABORTED');
  });

  it('halts with explicit BLOCKED when Kill Switch is active', async () => {
    AgentControlPlaneService.toggleKillSwitch(
      WORKSPACE_ID,
      true,
      'admin',
      '단위 테스트 긴급 정지'
    );

    vi.spyOn(ActionWorker, 'planAndCallTools').mockResolvedValueOnce({
      toolCalls: [
        {
          id: 'call_kill',
          toolName: 'mcp_generate_visual_image',
          arguments: { prompt: '이미지 시안' }
        }
      ],
      totalTokens: 50,
      modelId: 'gpt-5.6-luna-max',
      role: 'action',
      profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
    });

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '이미지 생성해줘'
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.failureDetails?.errorCode).toBe('EXECUTION_BLOCKED');
  });

  it('integrates full turn in AgentOrchestrator, populating actionGraph and synthesized report', async () => {
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        toolCalls: [
          {
            id: 'call_step_1',
            toolName: 'mcp_search_knowledge',
            arguments: { query: '원장님 추천' }
          }
        ],
        totalTokens: 100,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      })
      .mockResolvedValueOnce({
        toolCalls: [],
        rawContent: '조회가 완료되었습니다.',
        totalTokens: 60,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' }
      });

    vi.spyOn(ConversationBrain, 'generateResponse').mockResolvedValue({
      content: '원장님, 매장 지식베이스에서 확인된 추천 지침을 안내해 드립니다.',
      totalTokens: 150,
      modelId: 'gpt-5.6-luna-max',
      role: 'conversation',
      profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.7, versionTag: '1.0' }
    });

    const output = await AgentOrchestrator.executeTurn({
      workspaceId: WORKSPACE_ID,
      userMessage: '우리 매장 추천 시술 기준 찾아봐줘',
      isTestAccount: true
    });

    expect(output.actionGraph).toBeDefined();
    expect(output.actionGraph?.status).toBe('COMPLETED');
    expect(output.actionGraph?.steps.length).toBe(1);
    expect(output.step).toBe('MCP_TOOL_EXECUTED');
    expect(output.replyContent).toContain('원장님');
    expect(output.liveExecutionCard).toBeDefined();
    expect(output.liveExecutionCard?.status).toBe('COMPLETED');
  });

  it('generates user-friendly Korean plan/execution cards without internal jargon or parentheses statuses', async () => {
    vi.spyOn(ActionWorker, 'planAndCallTools')
      .mockResolvedValueOnce({
        toolCalls: [
          {
            id: 'call_content_gen_1',
            toolName: 'content.generate',
            arguments: {
              topic: '봄맞이 이벤트',
              channel: 'INSTAGRAM',
            },
          },
        ],
        totalTokens: 100,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' },
      })
      .mockResolvedValueOnce({
        toolCalls: [],
        rawContent: '초안이 준비되었습니다.',
        totalTokens: 50,
        modelId: 'gpt-5.6-luna-max',
        role: 'action',
        profileSnapshot: { modelId: 'gpt-5.6-luna-max', provider: 'openai', temperature: 0.1, versionTag: '1.0' },
      });

    const result = await AgentLoopEngine.run({
      workspaceId: WORKSPACE_ID,
      actionRunId: ACTION_RUN_ID,
      correlationId: CORRELATION_ID,
      userPrompt: '눈썹 이벤트 글 작성해줘',
    });

    expect(result.status).toBe('COMPLETED');
    const { planCard, liveExecutionCard } = result.cards;

    expect(planCard).toBeDefined();
    // 1) Title must be Korean task name + 계획 (not 'content.generate 실행 플랜')
    expect(planCard?.title).not.toContain('content.generate');
    expect(planCard?.title).not.toContain('실행 플랜');
    expect(planCard?.title).toBe('콘텐츠 원고 작성 계획');

    // 2) Risk label must be '안전' (not raw LOW)
    expect(planCard?.steps[0].riskLabel).toBe('안전');

    // 3) currentStepName must not have parentheses status code like '(COMPLETED)'
    expect(liveExecutionCard).toBeDefined();
    expect(liveExecutionCard?.currentStepName).not.toMatch(/\((COMPLETED|RUNNING|FAILED|BLOCKED)\)/);
    expect(liveExecutionCard?.currentStepName).toBe('콘텐츠 원고 작성 완료');

    // 4) logs must not contain internal technical log lines
    expect(liveExecutionCard?.logs.some(l => l.includes('서피스'))).toBe(false);
    expect(liveExecutionCard?.logs.some(l => l.includes('활성 도구'))).toBe(false);
    expect(liveExecutionCard?.logs.some(l => l.includes('Iteration'))).toBe(false);
    expect(liveExecutionCard?.logs.some(l => l.includes('실행 모드'))).toBe(false);
  });
});
