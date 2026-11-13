import { z } from 'zod'
import { VAULT_FUNNEL_CHANNELS, type VaultFunnelPayload } from './types'

export const FORBIDDEN_PAYLOAD_KEYS = [
  'title',
  'text',
  'caption',
  'body',
  'rawText',
  'description',
  'content',
  'hashtags',
  'coupon',
  'images',
  'media',
  'previewArtifacts',
  'prompt',
  'message',
] as const

export class VaultFunnelPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultFunnelPayloadError'
  }
}

function containsForbiddenKeys(obj: unknown, path = ''): string | null {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const hit = containsForbiddenKeys(obj[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  const record = obj as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const lowerKey = key.toLowerCase()
    if (FORBIDDEN_PAYLOAD_KEYS.some(f => lowerKey === f.toLowerCase())) {
      return path ? `${path}.${key}` : key
    }
    const hit = containsForbiddenKeys(record[key], path ? `${path}.${key}` : key)
    if (hit) return hit
  }
  return null
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const vaultFunnelPayloadSchema = z.object({
  channel: z.enum(VAULT_FUNNEL_CHANNELS).optional(),
  contentId: z.string().regex(uuidRegex).optional(),
  versionId: z.string().regex(uuidRegex).optional(),
  vaultItemId: z.string().regex(uuidRegex).optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fingerprint: z.string().max(128).optional(),
  previousFingerprint: z.string().max(128).optional(),
  reason: z.string().max(100).optional(),
  idempotencyKey: z.string().max(250).optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict()

/**
 * Validates that the payload contains only allowed metadata and NO raw text/personal content.
 * Throws VaultFunnelPayloadError if forbidden keys are present.
 */
export function validateVaultFunnelPayload(input: unknown): VaultFunnelPayload {
  const forbiddenHit = containsForbiddenKeys(input)
  if (forbiddenHit) {
    throw new VaultFunnelPayloadError(
      `보관함 퍼널 이벤트에 원문이나 개인정보(${forbiddenHit})를 포함할 수 없어요.`,
    )
  }

  const result = vaultFunnelPayloadSchema.safeParse(input)
  if (!result.success) {
    throw new VaultFunnelPayloadError(
      `보관함 퍼널 이벤트 형식이 올바르지 않아요: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`,
    )
  }

  return result.data as VaultFunnelPayload
}

/**
 * Strips any forbidden content fields defensively and validates metadata.
 */
export function sanitizeOrValidateVaultFunnelPayload(input: unknown): VaultFunnelPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  const raw = { ...(input as Record<string, unknown>) }
  for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
    delete raw[forbidden]
  }
  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    const meta = { ...(raw.metadata as Record<string, unknown>) }
    for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
      delete meta[forbidden]
    }
    raw.metadata = meta
  }
  return validateVaultFunnelPayload(raw)
}
