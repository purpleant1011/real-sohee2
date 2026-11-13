import { z } from 'zod'
import { mapGeminiTextUsage, mapTextResponseUsage, type UsageEventInput } from '@/features/credits/usage-event'

const count = z.number().int().nonnegative()
const completionUsage = z.object({
  prompt_tokens: count,
  completion_tokens: count,
  total_tokens: count,
  prompt_tokens_details: z.object({ cached_tokens: count.optional().default(0) }).passthrough().optional(),
}).passthrough()

/** Missing counters stay unknown; legacy token estimates are never an actual usage record. */
export function readActionWorkerUsage(provider: 'openai' | 'gemini', model: string, data: {
  id?: unknown; responseId?: unknown; model?: unknown; usage?: unknown; usageMetadata?: unknown
}): UsageEventInput | null {
  try {
    const id = typeof data.responseId === 'string' ? data.responseId : typeof data.id === 'string' ? data.id : null
    if (provider === 'gemini' && data.usageMetadata !== undefined) return mapGeminiTextUsage(id, model, data.usageMetadata)
    const raw = completionUsage.parse(data.usage)
    if (raw.prompt_tokens + raw.completion_tokens > raw.total_tokens) return null
    const mapped = mapTextResponseUsage(id, typeof data.model === 'string' ? data.model : model, {
      input_tokens: raw.prompt_tokens,
      input_tokens_details: { cached_tokens: raw.prompt_tokens_details?.cached_tokens ?? 0 },
      output_tokens: raw.completion_tokens,
      total_tokens: raw.total_tokens,
    })
    return Object.freeze({ ...mapped, provider, providerRequestId: id })
  } catch {
    return null
  }
}
