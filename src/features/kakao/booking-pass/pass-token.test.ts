import { describe, expect, it } from 'vitest'
import {
  issuePassToken,
  verifyPassToken,
  type BookingPassPayload,
} from './pass-token'

describe('booking pass token', () => {
  const secret = 'test-secret-key-for-booking-pass-12345'
  const workspaceId = 'ws_salon_gangnam_01'
  const bookingId = 'bk_20261105_9981'

  it('issues a base64url token with HMAC signature and verifies it successfully', async () => {
    const fixedNow = 1762300000 // epoch seconds
    const ttlSeconds = 3600 // 1 hour

    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds,
      now: fixedNow,
    })

    expect(typeof token).toBe('string')
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

    const result = await verifyPassToken(token, {
      secret,
      now: fixedNow + 1800,
      expectedWorkspaceId: workspaceId,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.workspaceId).toBe(workspaceId)
      expect(result.payload.bookingId).toBe(bookingId)
      expect(result.payload.iat).toBe(fixedNow)
      expect(result.payload.exp).toBe(fixedNow + ttlSeconds)
      expect(result.payload.requiresReauth).toBe(true)
      expect(result.payload.scope.requiresReauth).toBe(true)
    }
  })

  it('strictly excludes PII from the token payload (IDs and expiration only)', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 1800,
    })

    const result = await verifyPassToken(token, {
      secret,
      expectedWorkspaceId: workspaceId,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      const payload = result.payload as Record<string, unknown>
      // Verify no PII fields exist
      expect(payload).not.toHaveProperty('name')
      expect(payload).not.toHaveProperty('userName')
      expect(payload).not.toHaveProperty('customerName')
      expect(payload).not.toHaveProperty('phone')
      expect(payload).not.toHaveProperty('phoneNumber')
      expect(payload).not.toHaveProperty('email')
      expect(payload).not.toHaveProperty('userPhone')

      // Ensure allowed keys are strictly bounded
      const allowedKeys = new Set(['workspaceId', 'bookingId', 'iat', 'exp', 'scope', 'requiresReauth'])
      for (const key of Object.keys(payload)) {
        expect(allowedKeys.has(key)).toBe(true)
      }
    }
  })

  it('flags sensitive actions as requiring re-authentication (requiresReauth: true) in scope', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
    })

    const result = await verifyPassToken(token, { secret })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.scope).toEqual({ requiresReauth: true })
      expect(result.payload.requiresReauth).toBe(true)
    }
  })

  it('rejects expired tokens with reason "expired"', async () => {
    const baseNow = 1762300000
    const ttlSeconds = 600

    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds,
      now: baseNow,
    })

    // At exact expiration or past expiration
    const expiredResult = await verifyPassToken(token, {
      secret,
      now: baseNow + 601,
      expectedWorkspaceId: workspaceId,
    })
    expect(expiredResult).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('rejects tampered payload or signature with reason "tampered"', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
    })

    const [payloadB64, sigB64] = token.split('.')

    // Decode, tamper payload (e.g. swap to another booking), re-encode with original signature
    const rawPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as BookingPassPayload
    const tamperedPayload = { ...rawPayload, bookingId: 'bk_hacked_attacker_booking' }
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')
    const tamperedToken = `${tamperedPayloadB64}.${sigB64}`

    const tamperedResult = await verifyPassToken(tamperedToken, {
      secret,
      expectedWorkspaceId: workspaceId,
    })
    expect(tamperedResult).toEqual({
      ok: false,
      reason: 'tampered',
    })

    // Corrupted signature
    const corruptedSigToken = `${payloadB64}.${sigB64.slice(0, -2)}AA`
    const corruptedSigResult = await verifyPassToken(corruptedSigToken, {
      secret,
      expectedWorkspaceId: workspaceId,
    })
    expect(corruptedSigResult).toEqual({
      ok: false,
      reason: 'tampered',
    })

    // Wrong secret verification
    const wrongSecretResult = await verifyPassToken(token, {
      secret: 'completely-wrong-secret-key-attacker',
      expectedWorkspaceId: workspaceId,
    })
    expect(wrongSecretResult).toEqual({
      ok: false,
      reason: 'tampered',
    })
  })

  it('rejects tokens from a different workspace with reason "tenant_mismatch"', async () => {
    const token = await issuePassToken({
      workspaceId: 'ws_tenant_A',
      bookingId,
      secret,
    })

    const mismatchResult = await verifyPassToken(token, {
      secret,
      expectedWorkspaceId: 'ws_tenant_B',
    })

    expect(mismatchResult).toEqual({
      ok: false,
      reason: 'tenant_mismatch',
    })
  })

  it('blocks access to a different booking when expectedBookingId does not match', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId: 'bk_legit_100',
      secret,
    })

    const mismatchBookingResult = await verifyPassToken(token, {
      secret,
      expectedWorkspaceId: workspaceId,
      expectedBookingId: 'bk_another_200',
    })

    expect(mismatchBookingResult).toEqual({
      ok: false,
      reason: 'tampered',
    })
  })

  it('rejects malformed tokens with reason "malformed"', async () => {
    const malformedInputs = [
      '',
      'not-a-token',
      'part1.part2.part3',
      'singlepartwithnodot',
      '!!!not_base64!!!.valid_sig',
      Buffer.from('not json text').toString('base64url') + '.validsig',
      Buffer.from(JSON.stringify({ not: 'valid payload' })).toString('base64url') + '.validsig',
      '..',
    ]

    for (const badToken of malformedInputs) {
      const res = await verifyPassToken(badToken, { secret })
      expect(res).toEqual({
        ok: false,
        reason: 'malformed',
      })
    }

    // Invalid secret option
    const validToken = await issuePassToken({ workspaceId, bookingId, secret })
    const invalidSecretRes = await verifyPassToken(validToken, { secret: '' })
    expect(invalidSecretRes).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('supports Date objects for "now" parameter', async () => {
    const issueDate = new Date('2026-11-05T12:00:00.000Z')
    const verifyDate = new Date('2026-11-05T12:30:00.000Z')
    const expiredDate = new Date('2026-11-05T13:00:01.000Z')

    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 3600,
      now: issueDate,
    })

    const validRes = await verifyPassToken(token, {
      secret,
      now: verifyDate,
      expectedWorkspaceId: workspaceId,
    })
    expect(validRes.ok).toBe(true)

    const expRes = await verifyPassToken(token, {
      secret,
      now: expiredDate,
      expectedWorkspaceId: workspaceId,
    })
    expect(expRes).toEqual({ ok: false, reason: 'expired' })
  })

  it('throws an error if required parameters are missing in issuePassToken', async () => {
    await expect(
      issuePassToken({ workspaceId: '', bookingId, secret }),
    ).rejects.toThrow('workspaceId is required')

    await expect(
      issuePassToken({ workspaceId, bookingId: '', secret }),
    ).rejects.toThrow('bookingId is required')

    await expect(
      issuePassToken({ workspaceId, bookingId, secret: '' }),
    ).rejects.toThrow('secret is required')
  })
})
