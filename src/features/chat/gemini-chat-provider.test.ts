import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeminiChatProvider } from './gemini-chat-provider'
import type { ChatProviderInput } from '@/lib/providers/chat-provider'

vi.mock('@/lib/ai/model-profiles', () => ({ getGeminiApiBaseUrl: () => 'https://gemini.test' }))
afterEach(() => vi.unstubAllGlobals())

const request = { message: '조회한 내용을 설명해줘', context: {}, signal: new AbortController().signal } as ChatProviderInput

describe('Gemini conversation usage', () => {
  it('emits actual usage before completion with thinking and cache counted once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      responseId: 'gemini-response-1', candidates: [{ content: { parts: [{ text: '확인한 결과입니다.' }] } }],
      usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 10, totalTokenCount: 140 },
    }), { status: 200 })))
    const events = []
    for await (const event of createGeminiChatProvider({ apiKey: 'test-only', model: 'gemini-3.5-flash-lite' }).stream(request)) events.push(event)
    expect(events.map(event => event.type)).toEqual(['text.delta', 'usage', 'completed'])
    expect(events[1]).toMatchObject({ usage: { provider: 'gemini', providerRequestId: 'gemini-response-1',
      usageSource: 'actual', usage: { textInputTokens: 100, cachedTextInputTokens: 20, textOutputTokens: 40, providerTotalTokens: 140 } } })
  })

  it('does not fabricate actual usage when the provider omitted it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '응답' }] } }],
    }), { status: 200 })))
    const events = []
    for await (const event of createGeminiChatProvider({ apiKey: 'test-only', model: 'gemini-3.5-flash-lite' }).stream(request)) events.push(event)
    expect(events.map(event => event.type)).toEqual(['text.delta', 'completed'])
  })
})
