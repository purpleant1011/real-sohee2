import type OpenAI from 'openai'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import { createGeminiTextGenerator } from '@/features/vault/transform/adapters/gemini'

/**
 * 소희 텍스트 생성은 Gemini 만 쓴다(OpenAI 텍스트 모델·루나 사용 금지).
 * 기존 공급자들은 OpenAI Responses 형태(`client.responses.create`)로 짜여 있어, 같은 모양의 클라이언트를 Gemini 위에 얹어 호출부를 바꾸지 않고 공급자만 교체한다.
 */
type ResponsesCreate = OpenAI['responses']['create']
type CreateParams = Parameters<ResponsesCreate>[0]

export interface GeminiResponsesResult {
  id: string
  output_text: string
  usage?: undefined
}

export interface GeminiResponsesClient {
  responses: {
    create(request: CreateParams | Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<GeminiResponsesResult>
  }
}

/** 코드펜스·앞뒤 설명을 걷어 내고 첫 JSON 객체만 남긴다. */
export function extractJsonText(raw: string): string {
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced
}

function inputToText(input: unknown): string {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (typeof item === 'string') return item
        const content = (item as { content?: unknown })?.content
        return typeof content === 'string' ? content : JSON.stringify(item)
      })
      .join('\n')
  }
  return JSON.stringify(input ?? '')
}

function isJsonObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

export function createGeminiResponsesClient(generator: TextGenerator): GeminiResponsesClient {
  return {
    responses: {
      async create(request, options) {
        if (options?.signal?.aborted) throw new Error('GEMINI_REQUEST_ABORTED')
        const body = request as { instructions?: string; input?: unknown; text?: { format?: { type?: string; schema?: unknown } } }
        const schema = body.text?.format?.type === 'json_schema' ? body.text.format.schema : undefined
        const parts = [
          body.instructions,
          schema
            ? `출력은 아래 JSON 스키마를 정확히 따르는 JSON 객체 하나만 반환하세요. 설명·코드펜스·주석을 붙이지 마세요. 스키마에 없는 키를 추가하지 마세요.\nJSON 스키마:\n${JSON.stringify(schema)}`
            : undefined,
          `입력:\n${inputToText(body.input)}`,
        ].filter((part): part is string => Boolean(part))
        const prompt = parts.join('\n\n')

        let text = ''
        for (let attempt = 0; attempt < (schema ? 2 : 1); attempt += 1) {
          if (options?.signal?.aborted) throw new Error('GEMINI_REQUEST_ABORTED')
          const raw = await generator.generateText(prompt, {
            responseMimeType: schema ? 'application/json' : 'text/plain',
            temperature: 0.6,
          })
          text = schema ? extractJsonText(raw) : raw
          if (!schema || isJsonObject(text)) break
        }
        return { id: `gemini-${Date.now()}`, output_text: text }
      },
    },
  }
}

/** 운영 기본 텍스트 클라이언트. 모델은 소희 사이트 내 에이전트용 Gemini(`GEMINI_ACTION_MODEL`). */
export function createProductionTextClient(): GeminiResponsesClient {
  return createGeminiResponsesClient(
    createGeminiTextGenerator({ model: process.env.GEMINI_ACTION_MODEL?.trim() || 'gemini-3.8-flash' }),
  )
}
