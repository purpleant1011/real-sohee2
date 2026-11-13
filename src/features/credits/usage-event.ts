import { z } from 'zod'
import type { TokenUsage } from './token-credit-policy'

const nonnegative = z.number().int().nonnegative()
const textUsageSchema = z.object({
  input_tokens: nonnegative,
  input_tokens_details: z.object({ cached_tokens: nonnegative }).passthrough(),
  output_tokens: nonnegative,
  total_tokens: nonnegative,
}).passthrough()
const imageUsageSchema = z.object({
  input_tokens: nonnegative,
  input_tokens_details: z.object({
    text_tokens: nonnegative,
    image_tokens: nonnegative,
  }).strict(),
  output_tokens: nonnegative,
  total_tokens: nonnegative,
}).passthrough()

export type UsageEventInput = Readonly<{
  provider: 'openai' | 'gemini'
  providerRequestId: string | null
  model: string
  operation: 'text_response' | 'image_generation' | 'image_edit'
  usage: TokenUsage & Readonly<{ providerTotalTokens: number }>
  usageSource: 'actual' | 'estimated_missing_usage'
}>

function identifiers(requestId: string | null, model: string) {
  const parsedModel = z.string().trim().min(1).max(120).safeParse(model)
  const parsedRequest = requestId === null
    ? { success: true as const, data: null }
    : z.string().trim().min(1).max(255).safeParse(requestId)
  if (!parsedModel.success || !parsedRequest.success) throw new Error('PROVIDER_USAGE_INVALID')
  return { requestId: parsedRequest.data, model: parsedModel.data }
}

export function mapTextResponseUsage(
  requestId: string | null,
  model: string,
  rawUsage: unknown,
): UsageEventInput {
  const usage = textUsageSchema.safeParse(rawUsage)
  const id = identifiers(requestId, model)
  if (!usage.success || usage.data.input_tokens_details.cached_tokens > usage.data.input_tokens) {
    throw new Error('PROVIDER_USAGE_INVALID')
  }
  return Object.freeze({
    provider: 'openai' as const,
    providerRequestId: id.requestId,
    model: id.model,
    operation: 'text_response' as const,
    usage: Object.freeze({
      textInputTokens: usage.data.input_tokens,
      cachedTextInputTokens: usage.data.input_tokens_details.cached_tokens,
      textOutputTokens: usage.data.output_tokens,
      imageInputTokens: 0,
      imageOutputTokens: 0,
      providerTotalTokens: usage.data.total_tokens,
    }),
    usageSource: 'actual' as const,
  })
}

export function mapGeminiTextUsage(
  requestId: string | null,
  model: string,
  rawUsage: unknown,
): UsageEventInput {
  const parsed = z.object({
    promptTokenCount: nonnegative,
    cachedContentTokenCount: nonnegative.optional().default(0),
    candidatesTokenCount: nonnegative,
    thoughtsTokenCount: nonnegative.optional().default(0),
    totalTokenCount: nonnegative,
  }).passthrough().safeParse(rawUsage)
  const id = identifiers(requestId, model)
  if (!parsed.success) throw new Error('PROVIDER_USAGE_INVALID')
  const usage = parsed.data
  const output = usage.candidatesTokenCount + usage.thoughtsTokenCount
  if (!Number.isSafeInteger(output)
    || usage.cachedContentTokenCount > usage.promptTokenCount
    || usage.promptTokenCount + output > usage.totalTokenCount) throw new Error('PROVIDER_USAGE_INVALID')
  return Object.freeze({
    provider: 'gemini' as const,
    providerRequestId: id.requestId,
    model: id.model,
    operation: 'text_response' as const,
    usage: Object.freeze({
      textInputTokens: usage.promptTokenCount,
      cachedTextInputTokens: usage.cachedContentTokenCount,
      textOutputTokens: output,
      imageInputTokens: 0,
      imageOutputTokens: 0,
      providerTotalTokens: usage.totalTokenCount,
    }),
    usageSource: 'actual' as const,
  })
}

export function mapImageUsage(
  requestId: string | null,
  model: string,
  rawUsage: unknown,
  operation: 'image_generation' | 'image_edit' = 'image_generation',
): UsageEventInput {
  const usage = imageUsageSchema.safeParse(rawUsage)
  const id = identifiers(requestId, model)
  if (!usage.success
    || usage.data.input_tokens_details.text_tokens + usage.data.input_tokens_details.image_tokens !== usage.data.input_tokens
  ) throw new Error('PROVIDER_USAGE_INVALID')
  return Object.freeze({
    provider: 'openai' as const,
    providerRequestId: id.requestId,
    model: id.model,
    operation,
    usage: Object.freeze({
      textInputTokens: usage.data.input_tokens_details.text_tokens,
      cachedTextInputTokens: 0,
      textOutputTokens: 0,
      imageInputTokens: usage.data.input_tokens_details.image_tokens,
      imageOutputTokens: usage.data.output_tokens,
      providerTotalTokens: usage.data.total_tokens,
    }),
    usageSource: 'actual' as const,
  })
}
