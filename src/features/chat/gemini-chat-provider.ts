import type {
  ChatProvider,
  ChatProviderEvent,
  ChatProviderInput,
} from '@/lib/providers/chat-provider'
import { SOHEE_SYSTEM_INSTRUCTIONS } from './system-instructions'
import { mapGeminiTextUsage } from '@/features/credits/usage-event'

import { getGeminiApiBaseUrl } from '@/lib/ai/model-profiles'

export class GeminiChatProviderError extends Error {
  readonly code: string
  constructor(code: string, message?: string) {
    super(message || '소희의 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    this.name = 'GeminiChatProviderError'
    this.code = code
  }
}

export function createGeminiChatProvider(input: {
  apiKey: string
  model: string
}): ChatProvider {
  return Object.freeze({
    mode: 'openai' as const,
    async *stream(request: ChatProviderInput): AsyncIterable<ChatProviderEvent> {
      if (request.signal?.aborted) {
        throw new GeminiChatProviderError('GEMINI_CANCELLED', '응답 생성을 중단했습니다.')
      }

      try {
        const baseUrl = getGeminiApiBaseUrl()
        const url = `${baseUrl}/v1beta/models/${input.model}:generateContent?key=${input.apiKey}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SOHEE_SYSTEM_INSTRUCTIONS }]
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: `[문맥 정보]\n${JSON.stringify(request.context)}\n\n[사용자 요청]\n${request.message}` }]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
            }
          }),
          signal: request.signal
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new GeminiChatProviderError('GEMINI_RESPONSE_FAILED', `Gemini API error: ${res.status} - ${errText}`)
        }

        const data = (await res.json()) as any
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

        yield Object.freeze({ type: 'text.delta' as const, delta: text })
        if (data.usageMetadata !== undefined) {
          yield Object.freeze({ type: 'usage' as const,
            usage: mapGeminiTextUsage(data.responseId ?? null, input.model, data.usageMetadata) })
        }
        yield Object.freeze({ type: 'completed' as const })
      } catch (err) {
        if (err instanceof GeminiChatProviderError) throw err
        if (request.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw new GeminiChatProviderError('GEMINI_CANCELLED', '응답 생성을 중단했습니다.')
        }
        throw new GeminiChatProviderError('GEMINI_UNAVAILABLE', err instanceof Error ? err.message : String(err))
      }
    }
  })
}
