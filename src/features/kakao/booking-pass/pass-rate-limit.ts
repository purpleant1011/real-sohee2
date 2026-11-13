/**
 * In-memory LRU rate limiter for public booking pass verification.
 * Protects against brute-force enumeration attacks on the 4-digit phone PIN.
 *
 * Enforces:
 * - 5 max failed attempts per key (token hash and/or client IP).
 * - 15-minute sliding TTL per key.
 * - Max 1,000 entries with LRU eviction to prevent memory exhaustion on Edge / Worker isolates.
 */

export const MAX_FAILURES = 5
export const RATE_LIMIT_TTL_MS = 15 * 60 * 1000 // 15 minutes in milliseconds
export const DEFAULT_MAX_ENTRIES = 1000

export interface RateLimitRecord {
  readonly count: number
  readonly updatedAt: number
  readonly expiresAt: number
}

export interface RateLimiterOptions {
  readonly maxFailures?: number
  readonly ttlMs?: number
  readonly maxEntries?: number
}

export interface RateLimiter {
  isBlocked(key: string, now?: number): boolean
  recordFailure(key: string, now?: number): { blocked: boolean; attempts: number }
  resetAttempts(key: string): void
  clear(): void
  getAttempts(key: string, now?: number): number
  cleanupExpired(now?: number): number
  size(): number
}

const encoder = new TextEncoder()

/**
 * Creates an in-memory rate limiter instance with LRU eviction and TTL expiration.
 */
export function createRateLimiter(options?: RateLimiterOptions): RateLimiter {
  const maxFailures = options?.maxFailures ?? MAX_FAILURES
  const ttlMs = options?.ttlMs ?? RATE_LIMIT_TTL_MS
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES

  const map = new Map<string, RateLimitRecord>()

  function cleanupExpired(now: number = Date.now()): number {
    let purged = 0
    for (const [key, record] of map.entries()) {
      if (record.expiresAt <= now) {
        map.delete(key)
        purged++
      }
    }
    return purged
  }

  function getAttempts(key: string, now: number = Date.now()): number {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed) return 0

    const record = map.get(trimmed)
    if (!record) return 0

    if (record.expiresAt <= now) {
      map.delete(trimmed)
      return 0
    }

    return record.count
  }

  function isBlocked(key: string, now: number = Date.now()): boolean {
    const attempts = getAttempts(key, now)
    return attempts >= maxFailures
  }

  function recordFailure(
    key: string,
    now: number = Date.now(),
  ): { blocked: boolean; attempts: number } {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed) {
      return { blocked: false, attempts: 0 }
    }

    // Opportunistic cleanup if map reaches max capacity
    if (map.size >= maxEntries) {
      cleanupExpired(now)
    }

    const existing = map.get(trimmed)
    let count = 1
    if (existing && existing.expiresAt > now) {
      count = existing.count + 1
    }

    // Refresh position to MRU (tail of Map)
    map.delete(trimmed)
    map.set(trimmed, {
      count,
      updatedAt: now,
      expiresAt: now + ttlMs,
    })

    // Evict oldest entry if still exceeding capacity
    while (map.size > maxEntries) {
      const oldestKey = map.keys().next().value
      if (oldestKey !== undefined) {
        map.delete(oldestKey)
      } else {
        break
      }
    }

    return {
      blocked: count >= maxFailures,
      attempts: count,
    }
  }

  function resetAttempts(key: string): void {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed) return
    map.delete(trimmed)
  }

  function clear(): void {
    map.clear()
  }

  function size(): number {
    return map.size
  }

  return {
    isBlocked,
    recordFailure,
    resetAttempts,
    clear,
    getAttempts,
    cleanupExpired,
    size,
  }
}

// Module-level default singleton for worker lifecycle
const defaultLimiter = createRateLimiter()

export function isBlocked(key: string, now?: number): boolean {
  return defaultLimiter.isBlocked(key, now)
}

export function recordFailure(
  key: string,
  now?: number,
): { blocked: boolean; attempts: number } {
  return defaultLimiter.recordFailure(key, now)
}

export function resetAttempts(key: string): void {
  defaultLimiter.resetAttempts(key)
}

export function clearRateLimits(): void {
  defaultLimiter.clear()
}

export function getAttempts(key: string, now?: number): number {
  return defaultLimiter.getAttempts(key, now)
}

export function cleanupExpired(now?: number): number {
  return defaultLimiter.cleanupExpired(now)
}

/**
 * Computes a deterministic SHA-256 hex digest for a pass token.
 * Uses Web Crypto API for native Cloudflare Workers and Node 18+ compatibility.
 */
export async function hashToken(token: string): Promise<string> {
  if (typeof token !== 'string') return ''
  const trimmed = token.trim()
  if (!trimmed) return ''

  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(trimmed))
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Extracts client IP from incoming request headers.
 * Respects Cloudflare CF-Connecting-IP first, then standard X-Forwarded-For, then X-Real-IP.
 */
export function extractClientIp(headers: Headers): string | null {
  const cfIp = headers.get('cf-connecting-ip')
  if (cfIp && cfIp.trim()) {
    return cfIp.trim()
  }

  const xff = headers.get('x-forwarded-for')
  if (xff && xff.trim()) {
    const first = xff.split(',')[0].trim()
    if (first) {
      return first
    }
  }

  const xRealIp = headers.get('x-real-ip')
  if (xRealIp && xRealIp.trim()) {
    return xRealIp.trim()
  }

  return null
}
