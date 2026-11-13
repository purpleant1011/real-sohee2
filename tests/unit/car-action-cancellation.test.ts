import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionWorker } from '@/features/tool-runtime/action-worker'
import { AgentLoopEngine } from '@/features/tool-runtime/agent-loop-engine'
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher'
import { contentDispatcher } from '@/features/tool-runtime/dispatchers/content-dispatcher'
import { ConversationRepository } from '@/lib/conversation/conversation-repository'
import { DynamicCapabilityDiscovery } from '@/lib/mcp-gateway/dynamic-capability-discovery'

vi.mock('@/lib/ai/model-profiles', () => ({
  getModelProfile: () => ({ provider: process.env.CAR_TEST_PROVIDER || 'gemini', timeoutMs: 1000, modelId: 'test', maxTokens: 100, temperature: 0, versionTag: 'test' }),
  getTextApiKey: () => 'test',
  getGeminiApiKey: () => 'test',
  getGeminiApiBaseUrl: () => 'https://example.invalid',
}))

const discovery = (name = 'mcp_search_knowledge') => ({ openAiTools: [{ type: 'function', function: { name } }], operationalCapabilities: [], exclusionReasons: [], surface: 'CHAT' } as any)
beforeEach(() => { vi.stubEnv('OPENAI_API_KEY', 'unit-test-openai-key') })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('CAR-04/05 dispatch boundary', () => {
  async function run(cancelDuringModel: boolean, checkpointFails = false, durableStopped = false) {
    const controller = new AbortController()
    vi.spyOn(DynamicCapabilityDiscovery, 'getRelevantOperationalCapabilities').mockResolvedValue(discovery())
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue()
    vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue()
    const record = vi.spyOn(ConversationRepository, 'beginAgentRunStep').mockImplementation(async () => {
      if (checkpointFails) throw new Error('checkpoint unavailable')
    })
    vi.spyOn(ActionWorker, 'planAndCallTools').mockImplementation(async () => {
      if (cancelDuringModel) controller.abort()
      return { toolCalls: [1, 2].map(n => ({ id: `call-${n}`, toolName: 'mcp_search_knowledge', arguments: { query: 'test' } })), totalTokens: 1 } as any
    })
    const dispatch = vi.spyOn(ToolDispatcher, 'dispatch').mockImplementation(async () => {
      controller.abort()
      return { success: true, status: 'COMPLETED', toolId: 'knowledge.search', data: {} }
    })
    const result = AgentLoopEngine.run({ workspaceId: 'ws', actionRunId: 'run', correlationId: 'trace', userPrompt: '검색', options: { signal: controller.signal, allowParallelReads: false, canContinue: async () => !durableStopped } })
    return { result, record, dispatch }
  }

  it('does not dispatch a model result returned after cancellation', async () => {
    const { result, dispatch } = await run(true)
    expect((await result).status).toBe('BLOCKED')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch the next read after cancellation during the first read', async () => {
    const { result, dispatch, record } = await run(false)
    expect((await result).status).toBe('BLOCKED')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(record.mock.calls[0][0]).toMatchObject({ stepIndex: 1, workspaceId: 'ws' })
  })

  it('durable cancellation stops execution without a browser abort signal', async () => {
    const { result, dispatch } = await run(false, false, true)
    expect((await result).status).toBe('BLOCKED')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('checkpoint failure prevents all domain dispatch', async () => {
    const { result, dispatch } = await run(false, true)
    await expect(result).rejects.toThrow('checkpoint unavailable')
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('CAR-04/06 uncertain execution fence', () => {
  it('real dispatcher and loop do not retry a write after its response is lost', async () => {
    vi.spyOn(DynamicCapabilityDiscovery, 'getRelevantOperationalCapabilities').mockResolvedValue(discovery('publish.create'))
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue()
    const record = vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue()
    vi.spyOn(ConversationRepository, 'beginAgentRunStep').mockResolvedValue()
    vi.spyOn(ToolDispatcher, 'runPreflight').mockResolvedValue({ allowed: true })
    const execute = vi.spyOn(contentDispatcher, 'execute').mockRejectedValue(new DOMException('response lost', 'AbortError'))
    const plan = vi.spyOn(ActionWorker, 'planAndCallTools').mockResolvedValue({
      toolCalls: [1, 2].map(n => ({ id: `publish-${n}`, toolName: 'publish.create', arguments: {
        channel: 'THREADS', contentVersionId: 'version', expectedFingerprint: 'fingerprint',
      } })), totalTokens: 1,
    } as any)
    const result = await AgentLoopEngine.run({ workspaceId: 'ws', actionRunId: 'run', correlationId: 'trace', userPrompt: '게시해줘' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(plan).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'BLOCKED', actionGraph: { status: 'RESULT_UNKNOWN' } })
    expect(record.mock.calls[0][0]).toMatchObject({ status: 'verifying', completed: false })
  })

  for (const allowParallelReads of [false, true]) {
    it(`halts before another model iteration after RESULT_UNKNOWN (parallel=${allowParallelReads})`, async () => {
      vi.spyOn(DynamicCapabilityDiscovery, 'getRelevantOperationalCapabilities').mockResolvedValue(discovery())
      const save = vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue()
      const record = vi.spyOn(ConversationRepository, 'recordAgentRunStep').mockResolvedValue()
      vi.spyOn(ConversationRepository, 'beginAgentRunStep').mockResolvedValue()
      const plan = vi.spyOn(ActionWorker, 'planAndCallTools').mockResolvedValue({
        toolCalls: [1, 2].map(n => ({ id: `call-${n}`, toolName: 'mcp_search_knowledge', arguments: { query: 'test' } })), totalTokens: 1,
      } as any)
      const dispatch = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({
        success: false, status: 'RESULT_UNKNOWN', toolId: 'knowledge.search',
        error: { code: 'PROVIDER_RESPONSE_LOST', message: '결과 대사가 필요합니다.' },
      })
      const result = await AgentLoopEngine.run({ workspaceId: 'ws', actionRunId: 'run', correlationId: 'trace', userPrompt: '검색', options: { allowParallelReads } })
      expect(plan).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledTimes(allowParallelReads ? 2 : 1)
      expect(result.status).toBe('BLOCKED')
      expect(result.actionGraph.status).toBe('RESULT_UNKNOWN')
      expect(result.failureDetails?.errorCode).toBe('RESULT_UNKNOWN')
      expect(record.mock.calls[0][0]).toMatchObject({ status: 'verifying', completed: false })
      expect(save.mock.calls.at(-1)?.[1]).toMatchObject({ finalStatus: 'RESULT_UNKNOWN' })
    })
  }
})

describe('CAR-05 durable cancellation propagation', () => {
  it.each(['cancelled', 'unavailable'])('aborts an in-flight model on durable state %s without a browser signal', async state => {
    vi.useFakeTimers()
    vi.spyOn(DynamicCapabilityDiscovery, 'getRelevantOperationalCapabilities').mockResolvedValue(discovery())
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue()
    const dispatch = vi.spyOn(ToolDispatcher, 'dispatch')
    let stopped = false
    const canContinue = async () => {
      if (stopped && state === 'unavailable') throw new Error('database unavailable')
      return !stopped
    }
    let modelSignal: AbortSignal | undefined
    vi.spyOn(ActionWorker, 'planAndCallTools').mockImplementation(async input => {
      modelSignal = input.signal
      return new Promise(resolve => input.signal?.addEventListener('abort', () => resolve({
        toolCalls: [{ id: 'late', toolName: 'mcp_search_knowledge', arguments: { query: 'test' } }], totalTokens: 0,
        modelId: 'test', role: 'action',
        profileSnapshot: { modelId: 'test', provider: 'gemini', temperature: 0, versionTag: 'test' },
      }), { once: true }))
    })
    const pending = AgentLoopEngine.run({ workspaceId: 'ws', actionRunId: 'run', correlationId: 'trace', userPrompt: '검색', options: { canContinue } })
    await vi.advanceTimersByTimeAsync(0)
    stopped = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(modelSignal?.aborted).toBe(true)
    expect((await pending).status).toBe('BLOCKED')
    expect(dispatch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates durable cancellation through the real model adapter to fetch', async () => {
    vi.useFakeTimers()
    vi.stubEnv('CAR_TEST_PROVIDER', 'openai')
    vi.spyOn(DynamicCapabilityDiscovery, 'getRelevantOperationalCapabilities').mockResolvedValue(discovery())
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue()
    const dispatch = vi.spyOn(ToolDispatcher, 'dispatch')
    let stopped = false
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      requestSignal = init.signal
      return new Promise((_resolve, reject) => requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true }))
    }))
    const pending = AgentLoopEngine.run({ workspaceId: 'ws', actionRunId: 'run', correlationId: 'trace', userPrompt: '검색', options: { canContinue: async () => !stopped } })
    await vi.advanceTimersByTimeAsync(0)
    expect(requestSignal).toBeDefined()
    stopped = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(requestSignal?.aborted).toBe(true)
    expect((await pending).failureDetails?.errorCode).toBe('MODEL_CANCELLED')
    expect(dispatch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes its cancellation monitor after a model failure', async () => {
    vi.useFakeTimers()
    vi.spyOn(DynamicCapabilityDiscovery, 'getRelevantOperationalCapabilities').mockResolvedValue(discovery())
    vi.spyOn(ConversationRepository, 'updateAgentRunPlanData').mockResolvedValue()
    vi.spyOn(ActionWorker, 'planAndCallTools').mockRejectedValue(new Error('model failed'))
    const canContinue = vi.fn(async () => true)
    await AgentLoopEngine.run({ workspaceId: 'ws', actionRunId: 'run', correlationId: 'trace', userPrompt: '검색', options: { canContinue } })
    const checks = canContinue.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(canContinue).toHaveBeenCalledTimes(checks)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('CAR-05 model request cancellation', () => {
  for (const provider of ['gemini', 'openai']) {
    it(`${provider}: pre-aborted callers never send a request`, async () => {
      vi.stubEnv('CAR_TEST_PROVIDER', provider)
      const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
      vi.stubGlobal('fetch', fetcher)
      const controller = new AbortController()
      controller.abort()
      await expect(ActionWorker.execute({ tools: [], signal: controller.signal })).rejects.toMatchObject({ code: 'MODEL_CANCELLED', isRetryable: false })
      expect(fetcher).not.toHaveBeenCalled()
    })

    it(`${provider}: caller abort reaches an in-flight request and removes listeners`, async () => {
      vi.stubEnv('CAR_TEST_PROVIDER', provider)
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        controller.abort()
      })))
      await expect(ActionWorker.execute({ tools: [], signal: controller.signal })).rejects.toMatchObject({ code: 'MODEL_CANCELLED', isRetryable: false })
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it(`${provider}: whole-run deadline remains active while reading the response body`, async () => {
      vi.useFakeTimers()
      vi.stubEnv('CAR_TEST_PROVIDER', provider)
      vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))),
      })))
      const result = ActionWorker.execute({ tools: [], deadlineAt: Date.now() + 20 })
      const assertion = expect(result).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(20)
      await assertion
      expect(vi.getTimerCount()).toBe(0)
    })
  }

})
