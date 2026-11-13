import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionWorker } from '@/features/tool-runtime/action-worker'

beforeEach(() => {
  vi.stubEnv('AI_ACTION_PROVIDER', 'gemini')
  vi.stubEnv('GEMINI_API_KEY', 'test-only')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function response(metadata?: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    responseId: 'actual-gemini-response', candidates: [{ content: { parts: [{ text: '확인할 자료가 필요해요.' }] } }],
    ...(metadata === undefined ? {} : { usageMetadata: metadata }),
  }), { status: 200 })))
}

describe('ActionWorker usage observation', () => {
  it('awaits actual provider usage before handing tool decisions to the caller', async () => {
    response({ promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 })
    const onUsage = vi.fn(async () => {})
    const result = await ActionWorker.execute({ tools: [], userPrompt: '자료를 확인해줘', onUsage })
    expect(onUsage).toHaveBeenCalledOnce()
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', providerRequestId: 'actual-gemini-response',
      usage: expect.objectContaining({ textInputTokens: 10, textOutputTokens: 5, providerTotalTokens: 15 }) }))
    expect(result.usage?.usageSource).toBe('actual')
  })

  it('reports absent usage as unknown, not a fabricated actual 400-token record', async () => {
    response()
    const onUsage = vi.fn()
    const result = await ActionWorker.execute({ tools: [], userPrompt: '자료 확인', onUsage })
    expect(result.usage).toBeNull()
    expect(onUsage).toHaveBeenCalledWith(null)
  })

  it('stops before tool execution if durable usage observation fails', async () => {
    response({ promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 })
    await expect(ActionWorker.execute({ tools: [], userPrompt: '자료 확인', onUsage: async () => { throw new Error('USAGE_STORE_UNAVAILABLE') } }))
      .rejects.toThrow('USAGE_STORE_UNAVAILABLE')
  })

  it('does not replace explicit zero tokens with the legacy estimate', async () => {
    response({ promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 })
    const result = await ActionWorker.execute({ tools: [], userPrompt: '자료 확인' })
    expect(result.totalTokens).toBe(0)
  })
})
