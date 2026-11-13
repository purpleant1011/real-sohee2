import { describe, expect, it, beforeEach } from 'vitest'
import {
  isBlocked,
  recordFailure,
  resetAttempts,
  clearRateLimits,
  getAttempts,
  cleanupExpired,
  hashToken,
  extractClientIp,
  createRateLimiter,
  MAX_FAILURES,
  RATE_LIMIT_TTL_MS,
} from './pass-rate-limit'

describe('pass-rate-limit utility', () => {
  const testKey = 'test-token-key-01'

  beforeEach(() => {
    clearRateLimits()
  })

  describe('isBlocked & recordFailure', () => {
    it('is not blocked initially and attempts start at 0', () => {
      expect(isBlocked(testKey)).toBe(false)
      expect(getAttempts(testKey)).toBe(0)
    })

    it('increments attempts on each recordFailure and blocks at 5 attempts', () => {
      for (let i = 1; i < MAX_FAILURES; i++) {
        const result = recordFailure(testKey)
        expect(result.attempts).toBe(i)
        expect(result.blocked).toBe(false)
        expect(isBlocked(testKey)).toBe(false)
      }

      // 5th attempt: should now be blocked
      const fifth = recordFailure(testKey)
      expect(fifth.attempts).toBe(5)
      expect(fifth.blocked).toBe(true)
      expect(isBlocked(testKey)).toBe(true)

      // 6th attempt: remains blocked and count increments
      const sixth = recordFailure(testKey)
      expect(sixth.attempts).toBe(6)
      expect(sixth.blocked).toBe(true)
      expect(isBlocked(testKey)).toBe(true)
    })

    it('handles empty or whitespace-only keys gracefully without blocking', () => {
      expect(isBlocked('')).toBe(false)
      expect(isBlocked('   ')).toBe(false)
      const res = recordFailure('')
      expect(res.blocked).toBe(false)
      expect(res.attempts).toBe(0)
    })
  })

  describe('resetAttempts', () => {
    it('resets attempts and unblocks immediately', () => {
      for (let i = 0; i < 5; i++) {
        recordFailure(testKey)
      }
      expect(isBlocked(testKey)).toBe(true)

      resetAttempts(testKey)
      expect(isBlocked(testKey)).toBe(false)
      expect(getAttempts(testKey)).toBe(0)
    })

    it('ignores reset for non-existent key', () => {
      expect(() => resetAttempts('non-existent-key')).not.toThrow()
    })
  })

  describe('TTL and expiration', () => {
    it('expires after 15 minutes and unblocks automatically', () => {
      const baseTime = 1_700_000_000_000

      // 5 failures at baseTime
      for (let i = 0; i < 5; i++) {
        recordFailure(testKey, baseTime)
      }
      expect(isBlocked(testKey, baseTime)).toBe(true)

      // 14 minutes 59 seconds: still blocked
      const justBeforeExpiry = baseTime + RATE_LIMIT_TTL_MS - 1000
      expect(isBlocked(testKey, justBeforeExpiry)).toBe(true)

      // 15 minutes (900,000ms): expired and unblocked
      const atExpiry = baseTime + RATE_LIMIT_TTL_MS
      expect(isBlocked(testKey, atExpiry)).toBe(false)
      expect(getAttempts(testKey, atExpiry)).toBe(0)

      // Recording failure after expiration starts fresh at 1
      const freshResult = recordFailure(testKey, atExpiry + 1000)
      expect(freshResult.attempts).toBe(1)
      expect(freshResult.blocked).toBe(false)
    })

    it('cleanupExpired purges all entries older than 15 minutes', () => {
      const baseTime = 1_700_000_000_000
      recordFailure('key-1', baseTime)
      recordFailure('key-2', baseTime + 10_000)

      const afterExpiry = baseTime + RATE_LIMIT_TTL_MS + 1
      const purged = cleanupExpired(afterExpiry)
      expect(purged).toBeGreaterThanOrEqual(1)
      expect(getAttempts('key-1', afterExpiry)).toBe(0)
    })
  })

  describe('LRU eviction / max capacity', () => {
    it('evicts oldest entries when capacity exceeds maxEntries', () => {
      const smallLimiter = createRateLimiter({
        maxEntries: 3,
        maxFailures: 5,
        ttlMs: 60_000,
      })

      smallLimiter.recordFailure('key-1')
      smallLimiter.recordFailure('key-2')
      smallLimiter.recordFailure('key-3')

      expect(smallLimiter.getAttempts('key-1')).toBe(1)
      expect(smallLimiter.getAttempts('key-2')).toBe(1)
      expect(smallLimiter.getAttempts('key-3')).toBe(1)

      // Adding 4th entry evicts key-1 (oldest)
      smallLimiter.recordFailure('key-4')
      expect(smallLimiter.getAttempts('key-1')).toBe(0)
      expect(smallLimiter.getAttempts('key-2')).toBe(1)
      expect(smallLimiter.getAttempts('key-3')).toBe(1)
      expect(smallLimiter.getAttempts('key-4')).toBe(1)
    })
  })

  describe('hashToken', () => {
    it('produces deterministic sha256 hex string', async () => {
      const token = 'sample.jwt.like.token.string'
      const hash1 = await hashToken(token)
      const hash2 = await hashToken(token)
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/u)

      const differentTokenHash = await hashToken(token + 'diff')
      expect(differentTokenHash).not.toBe(hash1)
    })

    it('returns empty string or fallback for empty token', async () => {
      const emptyHash = await hashToken('')
      expect(emptyHash).toBe('')
    })
  })

  describe('extractClientIp', () => {
    it('extracts cf-connecting-ip as highest priority', () => {
      const headers = new Headers({
        'cf-connecting-ip': '203.0.113.195',
        'x-forwarded-for': '198.51.100.1, 192.0.2.1',
        'x-real-ip': '198.51.100.1',
      })
      expect(extractClientIp(headers)).toBe('203.0.113.195')
    })

    it('extracts first IP from x-forwarded-for when cf-connecting-ip is absent', () => {
      const headers = new Headers({
        'x-forwarded-for': ' 198.51.100.2 , 10.0.0.1 ',
      })
      expect(extractClientIp(headers)).toBe('198.51.100.2')
    })

    it('extracts x-real-ip when other headers are absent', () => {
      const headers = new Headers({
        'x-real-ip': '198.51.100.3',
      })
      expect(extractClientIp(headers)).toBe('198.51.100.3')
    })

    it('returns null when no IP headers are present', () => {
      const headers = new Headers({})
      expect(extractClientIp(headers)).toBeNull()
    })
  })
})
