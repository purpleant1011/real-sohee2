export type BookingPassScope = Readonly<{
  requiresReauth: boolean
}>

export type BookingPassPayload = Readonly<{
  workspaceId: string
  bookingId: string
  iat: number
  exp: number
  scope: BookingPassScope
  requiresReauth: boolean
}>

export type VerifyPassTokenFailureReason =
  | 'expired'
  | 'tampered'
  | 'tenant_mismatch'
  | 'malformed'

export type VerifyPassTokenResult =
  | Readonly<{ ok: true; payload: BookingPassPayload }>
  | Readonly<{ ok: false; reason: VerifyPassTokenFailureReason }>

export type IssuePassTokenOptions = Readonly<{
  workspaceId: string
  bookingId: string
  secret: string
  ttlSeconds?: number
  now?: Date | number
  requiresReauth?: boolean
  scope?: {
    requiresReauth?: boolean
  }
}>

export type VerifyPassTokenOptions = Readonly<{
  secret: string
  now?: Date | number
  expectedWorkspaceId?: string
  expectedBookingId?: string
}>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function resolveTimestamp(now?: Date | number): number {
  if (now instanceof Date) {
    return Math.floor(now.getTime() / 1000)
  }
  if (typeof now === 'number' && !Number.isNaN(now)) {
    return now > 1e11 ? Math.floor(now / 1000) : Math.floor(now)
  }
  return Math.floor(Date.now() / 1000)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '')
}

function base64UrlToBytes(base64url: string): Uint8Array | null {
  if (typeof base64url !== 'string' || base64url.length === 0) return null
  if (!/^[A-Za-z0-9_-]+$/u.test(base64url)) return null
  try {
    const normalized = base64url.replace(/-/gu, '+').replace(/_/gu, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * Constant-time byte array comparison helper for timing-attack resilience.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/**
 * Issues an HMAC-SHA256 signed booking pass token for customer viewing.
 * Pure function compatible with Cloudflare Workers (Web Crypto API).
 * Never includes PII in the payload — only IDs and expiration.
 */
export async function issuePassToken(options: IssuePassTokenOptions): Promise<string> {
  const { workspaceId, bookingId, secret, ttlSeconds = 7 * 86400, now } = options

  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('workspaceId is required')
  }
  if (!bookingId || typeof bookingId !== 'string') {
    throw new Error('bookingId is required')
  }
  if (!secret || typeof secret !== 'string') {
    throw new Error('secret is required')
  }

  const iat = resolveTimestamp(now)
  const exp = iat + ttlSeconds
  const requiresReauth = options.requiresReauth ?? options.scope?.requiresReauth ?? true

  const payload: BookingPassPayload = Object.freeze({
    workspaceId,
    bookingId,
    iat,
    exp,
    scope: Object.freeze({ requiresReauth }),
    requiresReauth,
  })

  const payloadJson = JSON.stringify(payload)
  const encodedPayload = bytesToBase64Url(encoder.encode(payloadJson))

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(encodedPayload),
  )

  const encodedSignature = bytesToBase64Url(new Uint8Array(signatureBuffer))
  return `${encodedPayload}.${encodedSignature}`
}

/**
 * Verifies an HMAC-SHA256 signed booking pass token.
 * Prevents tampering, expiration, and cross-workspace/cross-booking access.
 * Performs constant-time signature verification via Web Crypto API.
 */
export async function verifyPassToken(
  token: string,
  options: VerifyPassTokenOptions,
): Promise<VerifyPassTokenResult> {
  if (typeof token !== 'string' || !token) {
    return { ok: false, reason: 'malformed' }
  }
  if (!options || typeof options.secret !== 'string' || !options.secret) {
    return { ok: false, reason: 'malformed' }
  }

  const dotIndex = token.indexOf('.')
  if (dotIndex === -1 || dotIndex !== token.lastIndexOf('.')) {
    return { ok: false, reason: 'malformed' }
  }

  const encodedPayload = token.slice(0, dotIndex)
  const encodedSignature = token.slice(dotIndex + 1)

  const payloadBytes = base64UrlToBytes(encodedPayload)
  const signatureBytes = base64UrlToBytes(encodedSignature)

  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: 'malformed' }
  }

  let payload: BookingPassPayload
  try {
    const jsonStr = decoder.decode(payloadBytes)
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.workspaceId !== 'string' ||
      !parsed.workspaceId ||
      typeof parsed.bookingId !== 'string' ||
      !parsed.bookingId ||
      typeof parsed.exp !== 'number' ||
      Number.isNaN(parsed.exp) ||
      typeof parsed.iat !== 'number' ||
      Number.isNaN(parsed.iat)
    ) {
      return { ok: false, reason: 'malformed' }
    }
    const requiresReauth = Boolean(
      parsed.requiresReauth ?? (parsed.scope as { requiresReauth?: boolean } | undefined)?.requiresReauth ?? true,
    )
    payload = Object.freeze({
      workspaceId: parsed.workspaceId,
      bookingId: parsed.bookingId,
      iat: parsed.iat,
      exp: parsed.exp,
      scope: Object.freeze({ requiresReauth }),
      requiresReauth,
    })
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // Cryptographic HMAC-SHA256 signature verification FIRST (constant time)
  let isValidSignature = false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(options.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    isValidSignature = await crypto.subtle.verify(
      'HMAC',
      key,
      Uint8Array.from(signatureBytes).buffer,
      encoder.encode(encodedPayload),
    )
  } catch {
    return { ok: false, reason: 'tampered' }
  }

  if (!isValidSignature) {
    return { ok: false, reason: 'tampered' }
  }

  // Cross-booking access barrier: if an expected booking ID is provided, prevent mismatch
  if (options.expectedBookingId && payload.bookingId !== options.expectedBookingId) {
    return { ok: false, reason: 'tampered' }
  }

  // Check expiration
  const currentTimestamp = resolveTimestamp(options.now)
  if (payload.exp <= currentTimestamp) {
    return { ok: false, reason: 'expired' }
  }

  // Check tenant workspace isolation
  if (
    options.expectedWorkspaceId &&
    payload.workspaceId !== options.expectedWorkspaceId
  ) {
    return { ok: false, reason: 'tenant_mismatch' }
  }

  return { ok: true, payload }
}
