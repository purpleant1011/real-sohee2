import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const REVIEW_STORE_ID = 'store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63' as const
export const REVIEW_CHANNEL_KEY = 'channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b' as const
export const REVIEW_COOKIE_NAME = 'sohee-pg-review' as const

export const store = REVIEW_STORE_ID
export const channel = REVIEW_CHANNEL_KEY

export interface ReviewConfig {
  readonly sessionSecret: string
  readonly userIds: readonly string[]
}

const MAX_TTL_MS = 15 * 60 * 1000
const MAX_FUTURE_CLOCK_SKEW_MS = 60 * 1000

export function resolveReviewConfig(
  env: Record<string, string | undefined>
): ReviewConfig | null {
  if (
    env.NODE_ENV !== 'development' &&
    env.NODE_ENV !== 'test' &&
    env.PORTONE_REVIEW_ALLOW_PRODUCTION !== '1'
  ) {
    return null
  }

  if (env.PORTONE_REVIEW_ENABLED !== '1') {
    return null
  }

  if (env.PORTONE_REVIEW_MODE !== 'TEST') {
    return null
  }

  const sessionSecret = env.PORTONE_REVIEW_SESSION_SECRET
  if (!sessionSecret || sessionSecret.length < 32) {
    return null
  }

  const rawUserIds = env.PORTONE_REVIEW_USER_IDS
  if (!rawUserIds || !rawUserIds.trim()) {
    return null
  }

  const userIds = Object.freeze(
    rawUserIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  )

  if (userIds.length === 0) {
    return null
  }

  return {
    sessionSecret,
    userIds,
  }
}

export interface ReviewSession {
  readonly issueId: string
  readonly userId: string
  readonly workspaceId: string
  readonly planCode: string
  readonly createdAt: number
  readonly expiresAt: number
}

const ReviewSessionSchema = z
  .object({
    issueId: z.string().min(1),
    userId: z.string().min(1),
    workspaceId: z.string().min(1),
    planCode: z.string().min(1),
    createdAt: z.number().int().finite(),
    expiresAt: z.number().int().finite(),
  })
  .strict()

function computeHmacSignature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function sealReviewSession(session: ReviewSession, secret: string): string {
  const parsed = ReviewSessionSchema.parse(session)
  const payloadBase64 = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')
  const signatureBase64 = computeHmacSignature(payloadBase64, secret)
  return `${payloadBase64}.${signatureBase64}`
}

export function openReviewSession(
  token: string,
  secret: string,
  now: number = Date.now()
): ReviewSession | null {
  if (typeof token !== 'string' || !token) {
    return null
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }

  const [payloadBase64, providedSigBase64] = parts
  if (!payloadBase64 || !providedSigBase64) {
    return null
  }

  const expectedSigBase64 = computeHmacSignature(payloadBase64, secret)

  const providedSigBuf = Buffer.from(providedSigBase64, 'utf8')
  const expectedSigBuf = Buffer.from(expectedSigBase64, 'utf8')

  if (providedSigBuf.length !== expectedSigBuf.length) {
    return null
  }

  if (!timingSafeEqual(providedSigBuf, expectedSigBuf)) {
    return null
  }

  let rawJson: unknown
  try {
    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf8')
    rawJson = JSON.parse(jsonStr)
  } catch {
    return null
  }

  const parseResult = ReviewSessionSchema.safeParse(rawJson)
  if (!parseResult.success) {
    return null
  }

  const session = parseResult.data

  // Duration validity
  if (session.expiresAt <= session.createdAt) {
    return null
  }

  if (session.expiresAt - session.createdAt > MAX_TTL_MS) {
    return null
  }

  // Future timestamp guard (clock skew beyond 60s)
  if (session.createdAt > now + MAX_FUTURE_CLOCK_SKEW_MS) {
    return null
  }

  // Expiration guard
  if (now > session.expiresAt) {
    return null
  }

  return session
}
