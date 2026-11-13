import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionWorker } from '@/features/tool-runtime/action-worker'

beforeEach(() => { vi.stubEnv('AI_ACTION_PROVIDER', 'gemini'); vi.stubEnv('GEMINI_API_KEY', 'test-only') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const tools = [{ type: 'function', function: { name: 'knowledge.search', parameters: { type: 'object', properties: {} } } }]
function provider() {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '조회 결과를 확인했어요.' }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('native Gemini tool result identity', () => {
  it('matches responses to their original calls even when parallel reads finish out of order', async () => {
    const fetch = provider()
    await ActionWorker.execute({ tools, messages: [
      { role: 'user', content: '자료 확인' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'call-knowledge', thoughtSignature: 'test-only-signature', function: { name: 'knowledge.search', arguments: '{"query":"예약금"}' } },
        { id: 'call-reservation', function: { name: 'reservation.list', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'call-reservation', content: '{"reservations":[]}' },
      { role: 'tool', tool_call_id: 'call-knowledge', name: 'publish.create', content: '{"facts":[]}' },
    ] })
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    const names = body.contents.flatMap((message: { parts: { functionResponse?: { name: string } }[] }) => message.parts)
      .filter((part: { functionResponse?: unknown }) => part.functionResponse)
      .map((part: { functionResponse: { name: string } }) => part.functionResponse.name)
    expect(names).toEqual(['reservation.list', 'knowledge.search'])
    const parts = body.contents.flatMap((message: { parts: unknown[] }) => message.parts)
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ functionResponse: expect.objectContaining({ id: 'call-reservation', name: 'reservation.list' }) }),
      expect.objectContaining({ functionCall: expect.objectContaining({ id: 'call-knowledge', name: 'knowledge.search' }), thoughtSignature: 'test-only-signature' }),
    ]))
  })

  it('does not send an incomplete function-response set to the next model call', async () => {
    const fetch = provider()
    await expect(ActionWorker.execute({ tools, messages: [
      { role: 'assistant', tool_calls: [{ id: 'unanswered', function: { name: 'knowledge.search', arguments: '{}' } }] },
    ] })).rejects.toThrow('TOOL_HISTORY_RESPONSE_MISSING')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unknown tool result references before another provider call', async () => {
    const fetch = provider()
    await expect(ActionWorker.execute({ tools, messages: [
      { role: 'tool', tool_call_id: 'unknown', name: 'knowledge.search', content: '{}' },
    ] })).rejects.toThrow('TOOL_HISTORY_REFERENCE_MISSING')
    expect(fetch).not.toHaveBeenCalled()
  })
})
