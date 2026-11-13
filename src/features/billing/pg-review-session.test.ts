import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  REVIEW_STORE_ID,
  channel,
  openReviewSession,
  resolveReviewConfig,
  sealReviewSession,
  store,
  type ReviewSession,
} from './pg-review-session'

describe('pg-review-session', () => {
  describe('constants', () => {
    it('exports required constants and aliases matching specifications', () => {
      expect(REVIEW_STORE_ID).toBe('store-42cc855c-71b9-4fd7-99c9-4ef1a8a29f63')
      expect(REVIEW_CHANNEL_KEY).toBe('channel-key-a54326f5-27c7-4e36-95a1-3e2a3f28355b')
      expect(REVIEW_COOKIE_NAME).toBe('sohee-pg-review')
      expect(store).toBe(REVIEW_STORE_ID)
      expect(channel).toBe(REVIEW_CHANNEL_KEY)
    })
  })

  describe('resolveReviewConfig', () => {
    const validEnv = {
      NODE_ENV: 'development',
      PORTONE_REVIEW_ENABLED: '1',
      PORTONE_REVIEW_MODE: 'TEST',
      PORTONE_REVIEW_SESSION_SECRET: 'this-is-a-very-long-secret-key-32-chars-min',
      PORTONE_REVIEW_USER_IDS: 'user_1, user_2 ,user_3',
    }

    it('returns config when all gates are satisfied in development or test', () => {
      const devConfig = resolveReviewConfig({ ...validEnv, NODE_ENV: 'development' })
      expect(devConfig).not.toBeNull()
      expect(devConfig?.sessionSecret).toBe(validEnv.PORTONE_REVIEW_SESSION_SECRET)
      expect(devConfig?.userIds).toEqual(['user_1', 'user_2', 'user_3'])

      const testConfig = resolveReviewConfig({ ...validEnv, NODE_ENV: 'test' })
      expect(testConfig).not.toBeNull()
      expect(testConfig?.sessionSecret).toBe(validEnv.PORTONE_REVIEW_SESSION_SECRET)
      expect(testConfig?.userIds).toEqual(['user_1', 'user_2', 'user_3'])
    })

    it('blocks in non-development and non-test environments unless PORTONE_REVIEW_ALLOW_PRODUCTION is 1', () => {
      expect(resolveReviewConfig({ ...validEnv, NODE_ENV: 'production' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, NODE_ENV: 'preview' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, NODE_ENV: 'staging' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, NODE_ENV: '' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, NODE_ENV: undefined })).toBeNull()

      const prodAllowed = resolveReviewConfig({
        ...validEnv,
        NODE_ENV: 'production',
        PORTONE_REVIEW_ALLOW_PRODUCTION: '1',
      })
      expect(prodAllowed).not.toBeNull()
      expect(prodAllowed?.userIds).toEqual(['user_1', 'user_2', 'user_3'])
    })

    it('blocks when PORTONE_REVIEW_ENABLED is not 1', () => {
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_ENABLED: '0' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_ENABLED: undefined })).toBeNull()
    })

    it('blocks when PORTONE_REVIEW_MODE is not TEST', () => {
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_MODE: 'LIVE' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_MODE: undefined })).toBeNull()
    })

    it('blocks when PORTONE_REVIEW_SESSION_SECRET is less than 32 characters or missing', () => {
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_SESSION_SECRET: 'short-secret' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_SESSION_SECRET: undefined })).toBeNull()
    })

    it('blocks when PORTONE_REVIEW_USER_IDS is empty or missing', () => {
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_USER_IDS: '' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_USER_IDS: '   ,  ' })).toBeNull()
      expect(resolveReviewConfig({ ...validEnv, PORTONE_REVIEW_USER_IDS: undefined })).toBeNull()
    })
  })

  describe('sealReviewSession & openReviewSession', () => {
    const secret = 'valid-session-secret-key-for-test-32chars'
    const now = 1730900000000
    const sampleSession: ReviewSession = {
      issueId: 'test-review-uuid-1234',
      userId: 'user_1',
      workspaceId: 'ws-uuid-5678',
      planCode: 'GROWTH_300K',
      createdAt: now,
      expiresAt: now + 15 * 60 * 1000,
    }

    it('seals and opens a valid session successfully', () => {
      const token = sealReviewSession(sampleSession, secret)
      expect(typeof token).toBe('string')
      expect(token.includes('.')).toBe(true)

      const opened = openReviewSession(token, secret, now + 1000)
      expect(opened).toEqual(sampleSession)
    })

    it('does not contain PII or secrets in the encoded payload', () => {
      const token = sealReviewSession(sampleSession, secret)
      const [payloadBase64] = token.split('.')
      const rawPayload = Buffer.from(payloadBase64, 'base64url').toString('utf8')

      expect(rawPayload).not.toContain('email')
      expect(rawPayload).not.toContain('phone')
      expect(rawPayload).not.toContain('name')
      expect(rawPayload).not.toContain(secret)
    })

    it('rejects tampered tokens', () => {
      const token = sealReviewSession(sampleSession, secret)
      const [payloadBase64, sigBase64] = token.split('.')

      // Tampered payload
      const tamperedPayload = Buffer.from(
        JSON.stringify({ ...sampleSession, userId: 'attacker' }),
        'utf8'
      ).toString('base64url')
      expect(openReviewSession(`${tamperedPayload}.${sigBase64}`, secret, now + 1000)).toBeNull()

      // Tampered signature
      const badSig = sigBase64.substring(0, sigBase64.length - 2) + 'aa'
      expect(openReviewSession(`${payloadBase64}.${badSig}`, secret, now + 1000)).toBeNull()
    })

    it('rejects expired tokens', () => {
      const token = sealReviewSession(sampleSession, secret)
      expect(openReviewSession(token, secret, sampleSession.expiresAt + 1)).toBeNull()
    })

    it('rejects future tokens beyond acceptable clock skew', () => {
      const futureSession: ReviewSession = {
        ...sampleSession,
        createdAt: now + 120_000, // 2 minutes in the future
        expiresAt: now + 120_000 + 15 * 60 * 1000,
      }
      const token = sealReviewSession(futureSession, secret)
      expect(openReviewSession(token, secret, now)).toBeNull()
    })

    it('rejects tokens exceeding max 15 minute TTL', () => {
      const longTtlSession: ReviewSession = {
        ...sampleSession,
        expiresAt: sampleSession.createdAt + 16 * 60 * 1000, // 16 minutes
      }
      const token = sealReviewSession(longTtlSession, secret)
      expect(openReviewSession(token, secret, now)).toBeNull()
    })

    it('rejects tokens opened with wrong secret', () => {
      const token = sealReviewSession(sampleSession, secret)
      expect(openReviewSession(token, 'different-secret-key-32chars-min-size', now)).toBeNull()
    })

    it('rejects malformed tokens or payloads with unexpected keys', () => {
      expect(openReviewSession('invalid-format', secret, now)).toBeNull()
      expect(openReviewSession('a.b.c', secret, now)).toBeNull()

      // Payload with extra properties
      const extraPayload = Buffer.from(
        JSON.stringify({ ...sampleSession, extra: 'forbidden' }),
        'utf8'
      ).toString('base64url')
      const extraSig = createHmac('sha256', secret)
        .update(extraPayload)
        .digest('base64url')
      expect(openReviewSession(`${extraPayload}.${extraSig}`, secret, now)).toBeNull()
    })
  })
})
