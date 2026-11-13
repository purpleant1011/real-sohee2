/**
 * Sohee V0.9 Action Worker (ANI-964, ANI-962, ANI-963, ANI-649)
 * 
 * Model: Google Gemini 3.8 Flash (Action Worker Profile)
 * Responsibilities:
 * 1. MCP / Tool calling 전담 의사결정
 * 2. Structured Plan / Step Argument 생성 (Strict JSON Schema)
 * 3. 낮은 temperature (0.1)로 비결정론적 환각 및 부정확한 인자 차단
 * 4. Tool 실행 결과에 대한 후속 평가 및 후속 Step DAG 결정
 * 5. Provider Credential은 직접 접근하지 않으며, 승인 및 멱등키 계약 준수
 * 6. 모델 장애(타임아웃, 속도 제한, 토큰 초과 등) 시 빈 결과를 날조하지 않고
 *    정형화된 Canonical Model Error로 투명하게 전파(Fail-Closed).
 */

import { getModelProfile, getGeminiApiKey, getGeminiApiBaseUrl } from '@/lib/ai/model-profiles'
import type { UsageEventInput } from '@/features/credits/usage-event'
import { readActionWorkerUsage } from './action-worker-usage'

export interface ActionWorkerToolCall {
  id: string
  toolName: string
  arguments: Record<string, unknown>
  argumentParseError?: string
  thoughtSignature?: string
}

export interface ActionWorkerInput {
  userPrompt?: string
  conversationHistory?: Array<{ role: string; content: string }>
  tools: Array<Record<string, unknown>>
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
  messages?: Array<any>
  signal?: AbortSignal
  deadlineAt?: number
  onUsage?: (usage: UsageEventInput | null) => void | Promise<void>
}

export interface ActionWorkerOutput {
  usage?: UsageEventInput | null
  toolCalls: ActionWorkerToolCall[]
  rawContent?: string
  rawChoiceMessage?: {
    role: 'assistant'
    content: string | null
    tool_calls?: any[]
  }
  totalTokens: number
  modelId: string
  role: 'action'
  profileSnapshot: {
    modelId: string
    provider: string
    temperature: number
    versionTag: string
  }
}

export type ActionWorkerModelErrorCode =
  | 'MODEL_TIMEOUT'
  | 'MODEL_CANCELLED'
  | 'RATE_LIMITED'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'MODEL_ERROR'

export class ActionWorkerModelError extends Error {
  public readonly code: ActionWorkerModelErrorCode
  public readonly statusCode?: number
  public readonly isRetryable: boolean
  public readonly details?: unknown

  constructor(params: {
    code: ActionWorkerModelErrorCode
    message: string
    statusCode?: number
    isRetryable?: boolean
    details?: unknown
    cause?: unknown
  }) {
    super(params.message)
    this.name = 'ActionWorkerModelError'
    this.code = params.code
    this.statusCode = params.statusCode
    this.isRetryable = params.isRetryable ?? (params.code === 'MODEL_TIMEOUT' || params.code === 'RATE_LIMITED')
    this.details = params.details
    if (params.cause) {
      this.cause = params.cause
    }
  }
}

export function categorizeModelError(
  err: unknown,
  statusCode?: number,
  responseText?: string
): ActionWorkerModelError {
  if (err instanceof ActionWorkerModelError) {
    return err
  }

  const errorObj = err instanceof Error ? err : null
  const errName = errorObj?.name || ''
  const errMsg = (errorObj?.message || String(err || '')).toLowerCase()
  const textMsg = (responseText || '').toLowerCase()
  const combined = `${errMsg} ${textMsg}`

  // 1. Timeout / Abort Error
  if (
    errName === 'AbortError' ||
    combined.includes('aborted') ||
    combined.includes('timeout') ||
    combined.includes('timed out')
  ) {
    return new ActionWorkerModelError({
      code: 'MODEL_TIMEOUT',
      message: errorObj?.message || 'Model invocation timed out or aborted',
      statusCode: statusCode || 408,
      isRetryable: true,
      cause: err
    })
  }

  // 2. Rate Limit (429)
  if (
    statusCode === 429 ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('tpm') ||
    combined.includes('rpm') ||
    combined.includes('too many requests')
  ) {
    return new ActionWorkerModelError({
      code: 'RATE_LIMITED',
      message: responseText || errorObj?.message || 'Model rate limit exceeded',
      statusCode: 429,
      isRetryable: true,
      cause: err
    })
  }

  // 3. Token / Context Limit (400 context_length_exceeded, etc.)
  if (
    statusCode === 400 &&
    (combined.includes('context') ||
      combined.includes('token') ||
      combined.includes('max_tokens') ||
      combined.includes('too long') ||
      combined.includes('maximum context length'))
  ) {
    return new ActionWorkerModelError({
      code: 'TOKEN_LIMIT_EXCEEDED',
      message: responseText || errorObj?.message || 'Context length or token limit exceeded',
      statusCode: 400,
      isRetryable: false,
      cause: err
    })
  }

  // 4. Server error (5xx) -> retriable model error
  if (statusCode && statusCode >= 500) {
    return new ActionWorkerModelError({
      code: 'MODEL_ERROR',
      message: responseText || errorObj?.message || `Model provider server error: ${statusCode}`,
      statusCode,
      isRetryable: true,
      cause: err
    })
  }

  // 5. General Model Error
  return new ActionWorkerModelError({
    code: 'MODEL_ERROR',
    message: responseText || errorObj?.message || 'Model execution encountered an unrecoverable error',
    statusCode,
    isRetryable: false,
    cause: err
  })
}

export class ActionWorker {
  public async execute(input: ActionWorkerInput): Promise<ActionWorkerOutput> {
    return ActionWorker.execute(input)
  }

  public async planAndCallTools(input: ActionWorkerInput): Promise<ActionWorkerOutput> {
    return ActionWorker.execute(input)
  }

  public static async planAndCallTools(input: ActionWorkerInput): Promise<ActionWorkerOutput> {
    return this.execute(input)
  }

  public static async execute(input: ActionWorkerInput): Promise<ActionWorkerOutput> {
    const profile = getModelProfile('action')
    if (profile.provider !== 'gemini' && profile.provider !== 'openai') {
      throw new ActionWorkerModelError({ code: 'MODEL_ERROR', message: 'ACTION_PROVIDER_UNSUPPORTED', isRetryable: false })
    }
    const controller = new AbortController()
    const cancel = () => controller.abort(new ActionWorkerModelError({
      code: 'MODEL_CANCELLED', message: 'Model request cancelled by caller', isRetryable: false,
    }))
    const remaining = input.deadlineAt === undefined ? profile.timeoutMs : input.deadlineAt - Date.now()
    if (!Number.isFinite(remaining)) throw new ActionWorkerModelError({ code: 'MODEL_ERROR', message: 'Invalid model deadline', isRetryable: false })
    const timeoutError = new ActionWorkerModelError({ code: 'MODEL_TIMEOUT', message: 'Model request deadline exceeded', isRetryable: true })
    const timeout = setTimeout(() => controller.abort(timeoutError), Math.max(0, Math.min(profile.timeoutMs, remaining)))
    input.signal?.addEventListener('abort', cancel, { once: true })
    if (input.signal?.aborted) cancel()
    if (remaining <= 0 && !controller.signal.aborted) controller.abort(timeoutError)
    try {
      controller.signal.throwIfAborted()
      const result = await this.executeRequest({ ...input, signal: controller.signal }, profile)
      await input.onUsage?.(result.usage ?? null)
      return result
    } catch (err) {
      throw categorizeModelError(controller.signal.aborted ? controller.signal.reason : err)
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', cancel)
    }
  }

  private static async executeRequest(input: ActionWorkerInput, profile: ReturnType<typeof getModelProfile>): Promise<ActionWorkerOutput> {
    const systemPromptContent = `너는 소희 에이전트 OS의 실제 도메인 작업과 MCP 도구를 실행하는 'Action Worker'야.
[원칙]
1. 사장님의 명령을 분석하여 어떤 도구를 어떤 파라미터로 실행할지 정확하고 엄격하게 결정해.
2. 환각(Hallucination)을 금지하며 필요한 파라미터를 누락 없이 구성해.
3. 이미지 생성이 필요한 경우 'mcp_generate_visual_image'를 호출해.
4. 매장 가동/중지는 'mcp_control_autonomy', 긴급 정지는 'mcp_emergency_killswitch'를 호출해.
5. 실제 게시가 필요하면 'mcp_publish_live'를 호출해.
6. 허위/가짜 결과 생성 금지. 오직 도구 호출에 집중해.`

    let messages: any[]
    if (input.messages && input.messages.length > 0) {
      messages = [...input.messages]
      if (messages[0]?.role !== 'system') {
        messages.unshift({
          role: 'system',
          content: systemPromptContent
        })
      }
    } else {
      messages = [
        {
          role: 'system',
          content: systemPromptContent
        },
        ...(input.conversationHistory || []).slice(-8).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        })),
        {
          role: 'user',
          content: input.userPrompt || ''
        }
      ]
    }

    // Google Gemini Action Worker (Primary SSOT for Agent Brain)
    return this.callGeminiActionWorker(input, messages, systemPromptContent, profile)
  }

  private static async callGeminiActionWorker(
    input: ActionWorkerInput,
    messages: any[],
    systemPromptContent: string,
    profile: any
  ): Promise<ActionWorkerOutput> {
    const geminiKey = getGeminiApiKey()
    if (!geminiKey) {
      throw categorizeModelError(new Error('GEMINI_API_KEY is not configured for ActionWorker'))
    }

    try {
      // 1. Convert OpenAI tool definitions to Gemini functionDeclarations
      const functionDeclarations = (input.tools || []).map((t: any) => {
        const fn = t.function || t
        return {
          name: fn.name,
          description: fn.description || '',
          parameters: fn.parameters || { type: 'object', properties: {} }
        }
      })
      const geminiTools = functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined

      // 2. Build contents and system instruction
      let systemText = systemPromptContent
      const geminiContents: Array<{ role: 'user' | 'model'; parts: Array<any> }> = []
      const pendingToolCalls = new Map<string, string>()

      for (const msg of messages) {
        if (msg.role === 'system') {
          if (msg.content && msg.content !== systemPromptContent) {
            systemText += `\n${msg.content}`
          }
          continue
        }

        if (msg.role === 'tool') {
          const name = pendingToolCalls.get(msg.tool_call_id)
          if (!name) throw new Error('TOOL_HISTORY_REFERENCE_MISSING')
          pendingToolCalls.delete(msg.tool_call_id)
          geminiContents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                id: msg.tool_call_id,
                name,
                response: { result: msg.content }
              }
            }]
          })
        } else if (msg.role === 'assistant') {
          const parts: any[] = []
          if (msg.content) parts.push({ text: msg.content })
          if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
              const name = tc.function?.name || tc.toolName
              if (typeof tc.id !== 'string' || !tc.id || typeof name !== 'string' || !name) throw new Error('TOOL_HISTORY_REFERENCE_MISSING')
              if (pendingToolCalls.has(tc.id)) throw new Error('TOOL_HISTORY_REFERENCE_DUPLICATE')
              pendingToolCalls.set(tc.id, name)
              let args = {}
              try {
                args = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || tc.arguments || {})
              } catch {
                args = {}
              }
              const callPart: any = {
                functionCall: {
                  id: tc.id,
                  name,
                  args
                }
              }
              const sig = tc.thoughtSignature || (tc as any).thought_signature
              if (sig) {
                callPart.thoughtSignature = sig
              }
              parts.push(callPart)
            }
          }
          if (parts.length > 0) {
            geminiContents.push({ role: 'model', parts })
          }
        } else {
          // user message
          geminiContents.push({
            role: 'user',
            parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }]
          })
        }
      }

      if (pendingToolCalls.size > 0) throw new Error('TOOL_HISTORY_RESPONSE_MISSING')
      if (geminiContents.length === 0) {
        geminiContents.push({ role: 'user', parts: [{ text: input.userPrompt || '안녕하세요' }] })
      }

      // Gemini requires strictly alternating roles (user -> model -> user -> model).
      // Merge consecutive same-role messages
      const mergedContents: Array<{ role: 'user' | 'model'; parts: Array<any> }> = []
      for (const item of geminiContents) {
        if (mergedContents.length > 0 && mergedContents[mergedContents.length - 1].role === item.role) {
          mergedContents[mergedContents.length - 1].parts.push(...item.parts)
        } else {
          mergedContents.push({ role: item.role, parts: [...item.parts] })
        }
      }

      const payload: any = {
        contents: mergedContents,
        generationConfig: {
          temperature: profile.temperature ?? 0.1,
          maxOutputTokens: profile.maxTokens || 4096,
        }
      }

      if (systemText) {
        payload.systemInstruction = {
          parts: [{ text: systemText }]
        }
      }
      if (geminiTools) {
        payload.tools = geminiTools
      }

      const modelId = profile.modelId || 'gemini-3.8-flash'
      const baseUrl = getGeminiApiBaseUrl()
      const url = `${baseUrl}/v1beta/models/${modelId}:generateContent?key=${geminiKey}`

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: input.signal
      })

      if (!response.ok) {
        const errText = await response.text()
        console.warn(`[ActionWorker] Gemini call failed with status ${response.status}: ${errText}`)
        throw categorizeModelError(new Error(`ActionWorker Gemini Error: ${response.status} - ${errText}`), response.status, errText)
      }

      const data = (await response.json()) as any
      const parsedToolCalls: ActionWorkerToolCall[] = []
      let rawContent: string | undefined

      if (data.choices && Array.isArray(data.choices)) {
        const choice = data.choices[0]?.message
        if (choice?.tool_calls && Array.isArray(choice.tool_calls)) {
          for (const tc of choice.tool_calls) {
            let parsedArgs = {}
            let argumentParseError: string | undefined
            try {
              parsedArgs = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || tc.arguments || {})
            } catch (err: any) {
              parsedArgs = {}
              argumentParseError = err?.message || 'Invalid JSON in arguments'
            }
            parsedToolCalls.push({
              id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              toolName: tc.function?.name || tc.toolName || '',
              arguments: parsedArgs,
              argumentParseError
            })
          }
        }
        if (choice?.content) {
          rawContent = choice.content
        }
      } else {
        const candidate = data.candidates?.[0]
        const parts = candidate?.content?.parts || []

        for (const part of parts) {
          if (part.functionCall) {
            const thoughtSig = part.thoughtSignature || part.thought_signature
            parsedToolCalls.push({
              id: part.functionCall.id || `call_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
              toolName: part.functionCall.name,
              arguments: part.functionCall.args || {},
              thoughtSignature: thoughtSig
            })
          } else if (part.text) {
            rawContent = (rawContent ? rawContent + '\n' : '') + part.text
          }
        }
      }

      const totalTokens = data.usageMetadata?.totalTokenCount ?? data.usage?.total_tokens ?? 400
      const usage = readActionWorkerUsage('gemini', modelId, data)

      return {
        usage,
        toolCalls: parsedToolCalls,
        rawContent,
        rawChoiceMessage: {
          role: 'assistant',
          content: rawContent || null,
          tool_calls: parsedToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.toolName,
              arguments: JSON.stringify(tc.arguments)
            },
            thoughtSignature: tc.thoughtSignature
          }))
        },
        totalTokens,
        modelId,
        role: 'action',
        profileSnapshot: {
          modelId,
          provider: profile.provider,
          temperature: profile.temperature,
          versionTag: profile.versionTag
        }
      }
    } catch (err: unknown) {
      throw categorizeModelError(err)
    }
  }
}
