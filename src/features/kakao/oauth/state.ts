export interface OAuthStatePayload {
  readonly nonce: string
  readonly redirectUri: string
  readonly next?: string
  readonly iat: number
  readonly exp: number
}

export type VerifyOAuthStateFailureReason =
  | 'missing_state'
  | 'cookie_mismatch'
  | 'tampered'
  | 'expired'
  | 'malformed'

export type VerifyOAuthStateResult =
  | { readonly ok: true; readonly payload: OAuthStatePayload }
  | { readonly ok: false; readonly reason: VerifyOAuthStateFailureReason }

export interface CreateOAuthStateOptions {
  readonly redirectUri: string
  readonly next?: string
  readonly secret: string
  readonly ttlSeconds?: number
  readonly now?: Date | number
}

export interface VerifyOAuthStateOptions {
  readonly state: string
  readonly cookieState?: string
  readonly secret: string
  readonly now?: Date | number
}

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

function generateRandomNonce(length: number = 16): string {
  const randomBytes = new Uint8Array(length)
  crypto.getRandomValues(randomBytes)
  return bytesToBase64Url(randomBytes)
}

/**
 * Creates an HMAC-SHA256 signed OAuth state for CSRF protection and cookie binding.
 */
export async function createOAuthState(
  options: CreateOAuthStateOptions,
): Promise<{ state: string; cookieValue: string; maxAge: number }> {
  const { redirectUri, next, secret, ttlSeconds = 300, now } = options

  if (!redirectUri || typeof redirectUri !== 'string') {
    throw new Error('redirectUri is required')
  }
  if (!secret || typeof secret !== 'string') {
    throw new Error('secret is required')
  }

  const iat = resolveTimestamp(now)
  const exp = iat + ttlSeconds
  const nonce = generateRandomNonce(16)

  const payload: OAuthStatePayload = Object.freeze({
    nonce,
    redirectUri,
    next: next ?? undefined,
    iat,
    exp,
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
  const state = `${encodedPayload}.${encodedSignature}`

  return {
    state,
    cookieValue: state,
    maxAge: ttlSeconds,
  }
}

/**
 * Verifies an HMAC-SHA256 signed OAuth state and its cookie binding.
 */
export async function verifyOAuthState(
  options: VerifyOAuthStateOptions,
): Promise<VerifyOAuthStateResult> {
  const { state, cookieState, secret, now } = options

  if (typeof state !== 'string' || !state) {
    return { ok: false, reason: 'missing_state' }
  }

  if (typeof cookieState !== 'string' || !cookieState || cookieState !== state) {
    return { ok: false, reason: 'cookie_mismatch' }
  }

  if (typeof secret !== 'string' || !secret) {
    return { ok: false, reason: 'malformed' }
  }

  const dotIndex = state.indexOf('.')
  if (dotIndex === -1 || dotIndex !== state.lastIndexOf('.')) {
    return { ok: false, reason: 'malformed' }
  }

  const encodedPayload = state.slice(0, dotIndex)
  const encodedSignature = state.slice(dotIndex + 1)

  const payloadBytes = base64UrlToBytes(encodedPayload)
  const signatureBytes = base64UrlToBytes(encodedSignature)

  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: 'malformed' }
  }

  let payload: OAuthStatePayload
  try {
    const jsonStr = decoder.decode(payloadBytes)
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.exp !== 'number' ||
      Number.isNaN(parsed.exp) ||
      typeof parsed.iat !== 'number' ||
      Number.isNaN(parsed.iat)
    ) {
      return { ok: false, reason: 'malformed' }
    }
    payload = Object.freeze({
      nonce: parsed.nonce,
      redirectUri: parsed.redirectUri,
      next: typeof parsed.next === 'string' ? parsed.next : undefined,
      iat: parsed.iat,
      exp: parsed.exp,
    })
  } catch {
    return { ok: false, reason: 'malformed' }
  }

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

  const currentTimestamp = resolveTimestamp(now)
  if (payload.exp <= currentTimestamp) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, payload }
}
