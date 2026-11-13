import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  issueRequestToken,
  verifyRequestToken,
  getPassTokenSecret,
} from './request-token'

describe('request-token', () => {
  const originalEnv = process.env.PASS_TOKEN_SECRET
  const testSecret = 'test-pass-token-secret-very-secure-32bytes!'
  const testWorkspaceId = 'ws_test_salon_123'

  beforeEach(() => {
    process.env.PASS_TOKEN_SECRET = testSecret
  })

  afterEach(() => {
    process.env.PASS_TOKEN_SECRET = originalEnv
  })

  describe('getPassTokenSecret', () => {
    it('returns trimmed PASS_TOKEN_SECRET if present', () => {
      process.env.PASS_TOKEN_SECRET = '   secret_key_abc   '
      expect(getPassTokenSecret()).toBe('secret_key_abc')
    })

    it('returns null if PASS_TOKEN_SECRET is missing or empty', () => {
      delete process.env.PASS_TOKEN_SECRET
      expect(getPassTokenSecret()).toBeNull()
      process.env.PASS_TOKEN_SECRET = '   '
      expect(getPassTokenSecret()).toBeNull()
    })
  })

  describe('issueRequestToken', () => {
    it('issues a valid signed token with default 30-day expiration', async () => {
      const fixedNow = 1762300000
      const token = await issueRequestToken({
        workspaceId: testWorkspaceId,
        now: fixedNow,
      })

      expect(token).not.toBeNull()
      expect(typeof token).toBe('string')
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

      const result = await verifyRequestToken(token!, { now: fixedNow })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.payload.workspaceId).toBe(testWorkspaceId)
        expect(result.payload.scope).toBe('booking_request')
        expect(result.payload.iat).toBe(fixedNow)
        expect(result.payload.exp).toBe(fixedNow + 30 * 86400)
      }
    })

    it('returns null if workspaceId is missing or empty', async () => {
      expect(await issueRequestToken({ workspaceId: '' })).toBeNull()
      expect(await issueRequestToken({ workspaceId: '   ' })).toBeNull()
      // @ts-expect-error invalid input
      expect(await issueRequestToken({ workspaceId: null })).toBeNull()
    })

    it('returns null if PASS_TOKEN_SECRET is not configured and no secret provided', async () => {
      delete process.env.PASS_TOKEN_SECRET
      const token = await issueRequestToken({ workspaceId: testWorkspaceId })
      expect(token).toBeNull()
    })

    it('supports custom ttlSeconds and custom explicit secret', async () => {
      const customSecret = 'another-custom-secret'
      const token = await issueRequestToken({
        workspaceId: testWorkspaceId,
        secret: customSecret,
        ttlSeconds: 3600,
      })
      expect(token).not.toBeNull()

      // Verification fails with wrong secret
      const failResult = await verifyRequestToken(token!, { secret: 'wrong-secret' })
      expect(failResult.ok).toBe(false)

      // Verification succeeds with matching secret
      const successResult = await verifyRequestToken(token!, { secret: customSecret })
      expect(successResult.ok).toBe(true)
    })
  })

  describe('verifyRequestToken', () => {
    it('verifies a valid token successfully', async () => {
      const token = await issueRequestToken({ workspaceId: testWorkspaceId })
      expect(token).not.toBeNull()

      const result = await verifyRequestToken(token!)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.payload.workspaceId).toBe(testWorkspaceId)
        expect(result.payload.scope).toBe('booking_request')
      }
    })

    it('fails when token is expired', async () => {
      const fixedNow = 1762300000
      const token = await issueRequestToken({
        workspaceId: testWorkspaceId,
        ttlSeconds: 60,
        now: fixedNow,
      })

      const result = await verifyRequestToken(token!, { now: fixedNow + 61 })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('expired')
      }
    })

    it('fails when token is tampered', async () => {
      const token = await issueRequestToken({ workspaceId: testWorkspaceId })
      const [payloadPart, sigPart] = token!.split('.')
      const tamperedSig = sigPart.slice(0, -2) + 'aa'
      const tamperedToken = `${payloadPart}.${tamperedSig}`

      const result = await verifyRequestToken(tamperedToken)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('tampered')
      }
    })

    it('fails with secret_missing when PASS_TOKEN_SECRET is missing', async () => {
      const token = await issueRequestToken({ workspaceId: testWorkspaceId })
      delete process.env.PASS_TOKEN_SECRET

      const result = await verifyRequestToken(token!)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('secret_missing')
      }
    })

    it('fails when token format is malformed', async () => {
      expect((await verifyRequestToken('')).ok).toBe(false)
      expect((await verifyRequestToken('invalid')).ok).toBe(false)
      expect((await verifyRequestToken('a.b.c')).ok).toBe(false)
      expect((await verifyRequestToken('not_base64.signature')).ok).toBe(false)
    })

    it('fails with tenant_mismatch when expectedWorkspaceId does not match', async () => {
      const token = await issueRequestToken({ workspaceId: testWorkspaceId })
      const result = await verifyRequestToken(token!, { expectedWorkspaceId: 'other_workspace' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('tenant_mismatch')
      }
    })

    it('never contains PII in token payload', async () => {
      const token = await issueRequestToken({ workspaceId: testWorkspaceId })
      const result = await verifyRequestToken(token!)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const payload = result.payload as unknown as Record<string, unknown>
        expect(payload).not.toHaveProperty('phone')
        expect(payload).not.toHaveProperty('name')
        expect(payload).not.toHaveProperty('customerName')
        expect(payload).not.toHaveProperty('email')
        const allowedKeys = new Set(['workspaceId', 'scope', 'iat', 'exp'])
        for (const key of Object.keys(payload)) {
          expect(allowedKeys.has(key)).toBe(true)
        }
      }
    })
  })
})
