import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionWorker } from '@/features/tool-runtime/action-worker'

beforeEach(() => {
  // 예전 설정이 남아 있어도 텍스트는 Gemini 로만 간다(OpenAI 텍스트·루나 삭제).
  vi.stubEnv('AI_ACTION_PROVIDER', 'openai')
  vi.stubEnv('GEMINI_API_KEY', 'gemini-test-only')
  vi.stubEnv('OPENAI_API_KEY', 'openai-test-only')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const geminiResponse = () => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: '확인했어요.' }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
}), { status: 200 })

describe('action model credential isolation', () => {
  it('OpenAI 설정이 있어도 OpenAI 엔드포인트로 텍스트 요청을 보내지 않는다', async () => {
    const fetch = vi.fn().mockResolvedValue(geminiResponse())
    vi.stubGlobal('fetch', fetch)
    await ActionWorker.execute({ tools: [], userPrompt: '자료 확인' })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).not.toContain('api.openai.com')
    expect(url).toContain(':generateContent')
    expect(JSON.stringify(init.headers)).not.toContain('openai-test-only')
  })
  it('Gemini 키가 없으면 다른 공급자 키로 대체하지 않고 외부 호출 없이 거절한다', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    const fetch = vi.fn().mockResolvedValue(geminiResponse())
    vi.stubGlobal('fetch', fetch)
    await expect(ActionWorker.execute({ tools: [], userPrompt: '자료 확인' })).rejects.toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('fails closed for an unsupported provider rather than silently routing credentials', async () => {
    vi.stubEnv('AI_ACTION_PROVIDER', 'unsupported-provider')
    const fetch = vi.fn().mockResolvedValue(geminiResponse())
    vi.stubGlobal('fetch', fetch)
    await expect(ActionWorker.execute({ tools: [], userPrompt: '자료 확인' })).rejects.toThrow('ACTION_PROVIDER_UNSUPPORTED')
    expect(fetch).not.toHaveBeenCalled()
  })
})
