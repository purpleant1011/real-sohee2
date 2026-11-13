import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const payloadSchema = z.object({
  algorithm: z.literal('HMAC-SHA256'),
  user_id: z.union([z.string(), z.number()]).transform(String).refine((value) => /^[A-Za-z0-9._-]{1,255}$/u.test(value)),
  issued_at: z.number().int().positive(),
}).passthrough()

function invalid(): never {
  throw new Error('META_SIGNED_REQUEST_INVALID')
}

export async function verifyMetaSignedRequest(signedRequest: string, appSecret: string) {
  if (signedRequest.length < 20 || signedRequest.length > 16_384 || appSecret.length < 8) invalid()
  const parts = signedRequest.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) invalid()
  let received: Buffer
  let expected: Buffer
  let rawPayload: string
  try {
    received = Buffer.from(parts[0], 'base64url')
    expected = createHmac('sha256', appSecret).update(parts[1]).digest()
    rawPayload = Buffer.from(parts[1], 'base64url').toString('utf8')
  } catch {
    invalid()
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) invalid()
  let source: unknown
  try {
    source = JSON.parse(rawPayload)
  } catch {
    invalid()
  }
  const parsed = payloadSchema.safeParse(source)
  if (!parsed.success || Math.abs(Date.now() / 1000 - parsed.data.issued_at) > 24 * 60 * 60) invalid()
  return Object.freeze({ externalAccountId: parsed.data.user_id })
}
