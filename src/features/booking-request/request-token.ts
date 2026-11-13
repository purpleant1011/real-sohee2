/**
 * Booking Request Token Service
 *
 * HMAC-SHA256 signed tokens for public customer booking request links.
 * Exclusively uses PASS_TOKEN_SECRET (never fallbacks to any other key).
 * Pure functions compatible with Cloudflare Workers (Web Crypto API).
 * Never contains PII in token payload.
 */

export type BookingRequestTokenPayload = Readonly<{
  workspaceId: string
  scope: 'booking_request'
  iat: number
  exp: number
  igThreadId?: string
  dmThreadId?: string
}>

export type VerifyRequestTokenFailureReason =
  | 'expired'
  | 'tampered'
  | 'tenant_mismatch'
  | 'scope_mismatch'
  | 'malformed'
  | 'secret_missing'

export type VerifyRequestTokenResult =
  | Readonly<{ ok: true; payload: BookingRequestTokenPayload }>
  | Readonly<{ ok: false; reason: VerifyRequestTokenFailureReason }>

export type IssueRequestTokenOptions = Readonly<{
  workspaceId: string
  secret?: string
  ttlSeconds?: number
  now?: Date | number
  igThreadId?: string
  dmThreadId?: string
}>

export type VerifyRequestTokenOptions = Readonly<{
  secret?: string
  now?: Date | number
  expectedWorkspaceId?: string
}>

const DEFAULT_TTL_SECONDS = 30 * 86400 // 30 days
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function getPassTokenSecret(): string | null {
  const secret = process.env.PASS_TOKEN_SECRET?.trim()
  return secret && secret.length > 0 ? secret : null
}

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

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/**
 * Issues an HMAC-SHA256 signed booking request token.
 * Uses PASS_TOKEN_SECRET if secret option is not provided.
 * Returns null if secret is not configured or input is invalid.
 */
export async function issueRequestToken(
  options: IssueRequestTokenOptions,
): Promise<string | null> {
  if (!options || typeof options !== 'object') return null

  const workspaceId = typeof options.workspaceId === 'string' ? options.workspaceId.trim() : ''
  if (!workspaceId) return null

  const secret = options.secret?.trim() || getPassTokenSecret()
  if (!secret) return null

  const iat = resolveTimestamp(options.now)
  const ttlSeconds = typeof options.ttlSeconds === 'number' && options.ttlSeconds > 0
    ? options.ttlSeconds
    : DEFAULT_TTL_SECONDS
  const exp = iat + ttlSeconds

  const igThreadId = typeof options.igThreadId === 'string' && options.igThreadId.trim() ? options.igThreadId.trim() : undefined
  const dmThreadId = typeof options.dmThreadId === 'string' && options.dmThreadId.trim() ? options.dmThreadId.trim() : undefined

  const payload: BookingRequestTokenPayload = Object.freeze({
    workspaceId,
    scope: 'booking_request',
    iat,
    exp,
    ...(igThreadId ? { igThreadId } : {}),
    ...(dmThreadId ? { dmThreadId } : {}),
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
 * Verifies an HMAC-SHA256 signed booking request token.
 * Prevents tampering, expiration, and cross-workspace access.
 */
export async function verifyRequestToken(
  token: string,
  options?: VerifyRequestTokenOptions,
): Promise<VerifyRequestTokenResult> {
  if (typeof token !== 'string' || !token) {
    return { ok: false, reason: 'malformed' }
  }

  const secret = options?.secret?.trim() || getPassTokenSecret()
  if (!secret) {
    return { ok: false, reason: 'secret_missing' }
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

  let payload: BookingRequestTokenPayload
  try {
    const jsonStr = decoder.decode(payloadBytes)
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.workspaceId !== 'string' ||
      !parsed.workspaceId ||
      parsed.scope !== 'booking_request' ||
      typeof parsed.exp !== 'number' ||
      Number.isNaN(parsed.exp) ||
      typeof parsed.iat !== 'number' ||
      Number.isNaN(parsed.iat)
    ) {
      if (parsed && typeof parsed === 'object' && parsed.scope && parsed.scope !== 'booking_request') {
        return { ok: false, reason: 'scope_mismatch' }
      }
      return { ok: false, reason: 'malformed' }
    }
    const igThreadId = typeof parsed.igThreadId === 'string' && parsed.igThreadId.trim() ? parsed.igThreadId.trim() : undefined
    const dmThreadId = typeof parsed.dmThreadId === 'string' && parsed.dmThreadId.trim() ? parsed.dmThreadId.trim() : undefined

    payload = Object.freeze({
      workspaceId: parsed.workspaceId,
      scope: 'booking_request',
      iat: parsed.iat,
      exp: parsed.exp,
      ...(igThreadId ? { igThreadId } : {}),
      ...(dmThreadId ? { dmThreadId } : {}),
    })
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // HMAC-SHA256 signature verification
  let isValidSignature = false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
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

  // Check expiration
  const currentTimestamp = resolveTimestamp(options?.now)
  if (payload.exp <= currentTimestamp) {
    return { ok: false, reason: 'expired' }
  }

  // Check tenant workspace isolation
  if (
    options?.expectedWorkspaceId &&
    payload.workspaceId !== options.expectedWorkspaceId
  ) {
    return { ok: false, reason: 'tenant_mismatch' }
  }

  return { ok: true, payload }
}
