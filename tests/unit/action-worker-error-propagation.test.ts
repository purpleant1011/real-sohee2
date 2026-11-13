import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActionWorker, ActionWorkerModelError } from '@/features/tool-runtime/action-worker';
import { AgentLoopEngine } from '@/features/tool-runtime/agent-loop-engine';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';

describe('Action Worker Model Error Propagation (ANI-964, ANI-962, ANI-963)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Test the actual default Gemini branch with a synthetic key and mocked fetch.
    vi.stubEnv('AI_ACTION_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe('ActionWorker.execute unit semantics', () => {
    it('throws MODEL_TIMEOUT when model call times out or aborts, and does NOT return empty tool calls', async () => {
      // Simulate AbortError / timeout
      globalThis.fetch = vi.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      await expect(
        ActionWorker.execute({
          tools: [],
          userPrompt: '테스트 요청'
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(ActionWorkerModelError);
        expect(err.code).toBe('MODEL_TIMEOUT');
        expect(err.isRetryable).toBe(true);
        expect(err.toolCalls).toBeUndefined(); // Never returns fake empty toolCalls
        return true;
      });
    });

    it('throws retriable RATE_LIMITED error on 429 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit reached for requests per minute (TPM)'
      } as Response);

      await expect(
        ActionWorker.execute({
          tools: [],
          userPrompt: '테스트 요청'
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(ActionWorkerModelError);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.statusCode).toBe(429);
        expect(err.isRetryable).toBe(true);
        return true;
      });
    });

    it('throws TOKEN_LIMIT_EXCEEDED on 400 context length exceeded', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens."
      } as Response);

      await expect(
        ActionWorker.execute({
          tools: [],
          userPrompt: '대용량 프롬프트'
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(ActionWorkerModelError);
        expect(err.code).toBe('TOKEN_LIMIT_EXCEEDED');
        expect(err.statusCode).toBe(400);
        expect(err.isRetryable).toBe(false);
        return true;
      });
    });

    it('throws MODEL_ERROR on 500 internal server error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      } as Response);

      await expect(
        ActionWorker.execute({
          tools: [],
          userPrompt: '테스트 요청'
        })
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(ActionWorkerModelError);
        expect(err.code).toBe('MODEL_ERROR');
        expect(err.statusCode).toBe(500);
        expect(err.isRetryable).toBe(true);
        return true;
      });
    });

    it('normally generates tool calls on successful response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{
              functionCall: { name: 'mcp_search_knowledge', args: { query: '테스트' } }
            }] }
          }],
          usageMetadata: { totalTokenCount: 150 }
        })
      } as Response);

      const result = await ActionWorker.execute({
        tools: [{ type: 'function', function: { name: 'mcp_search_knowledge' } }],
        userPrompt: '지식 검색해줘'
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].toolName).toBe('mcp_search_knowledge');
      expect(result.toolCalls[0].arguments).toEqual({ query: '테스트' });
      expect(result.totalTokens).toBe(150);
    });
  });

  describe('AgentLoopEngine error handling & node transition', () => {
    const WORKSPACE_ID = 'ws-test-error-handling';
    const ACTION_RUN_ID = '00000000-0000-0000-0000-000000000099';

    beforeEach(() => {
      AgentControlPlaneService.resetForTest(WORKSPACE_ID);
      vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue(undefined);
      vi.spyOn(ConversationRepository, 'updateAgentRunStatus').mockResolvedValue(undefined);
      vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue(undefined);
    });

    it('transitions node to RETRIABLE_ERROR and loop to FAILED when model times out (never fake COMPLETED)', async () => {
      vi.spyOn(ActionWorker, 'planAndCallTools').mockRejectedValue(
        new ActionWorkerModelError({
          code: 'MODEL_TIMEOUT',
          message: 'Model request timed out',
          isRetryable: true
        })
      );

      const initialNodes = [
        {
          nodeId: 'node-1',
          toolName: 'mcp_search_knowledge',
          status: 'PENDING'
        }
      ];

      const result = await AgentLoopEngine.runLoop({
        workspaceId: WORKSPACE_ID,
        actionRunId: ACTION_RUN_ID,
        correlationId: 'corr-err-1',
        userPrompt: '검색해줘',
        actionGraphNodes: initialNodes
      });

      expect(result.status).toBe('FAILED');
      expect(result.actionGraph.status).toBe('FAILED');
      expect(result.actionGraph.nodes?.[0].status).toBe('RETRIABLE_ERROR');
      expect(result.actionGraph.nodes?.[0].error?.code).toBe('MODEL_TIMEOUT');
      expect(result.failureDetails?.errorCode).toBe('MODEL_TIMEOUT');
    });

    it('transitions node to FAILED when model throws non-retriable error', async () => {
      vi.spyOn(ActionWorker, 'planAndCallTools').mockRejectedValue(
        new ActionWorkerModelError({
          code: 'TOKEN_LIMIT_EXCEEDED',
          message: 'Context length exceeded',
          isRetryable: false,
          statusCode: 400
        })
      );

      const initialNodes = [
        {
          nodeId: 'node-1',
          toolName: 'mcp_search_knowledge',
          status: 'PENDING'
        }
      ];

      const result = await AgentLoopEngine.runLoop({
        workspaceId: WORKSPACE_ID,
        actionRunId: ACTION_RUN_ID,
        correlationId: 'corr-err-2',
        userPrompt: '검색해줘',
        actionGraphNodes: initialNodes
      });

      expect(result.status).toBe('FAILED');
      expect(result.actionGraph.status).toBe('FAILED');
      expect(result.actionGraph.nodes?.[0].status).toBe('FAILED');
      expect(result.actionGraph.nodes?.[0].error?.code).toBe('TOKEN_LIMIT_EXCEEDED');
      expect(result.failureDetails?.errorCode).toBe('TOKEN_LIMIT_EXCEEDED');
    });
  });
});
