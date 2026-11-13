import { describe, expect, it, vi } from 'vitest'
import {
  isRenewalEligible,
  renewLearningVerification,
  type VerificationRenewalDeps,
} from './verification-renewal'
import type { EvidenceLease, LearningSource } from './contracts'
import { tenantASource, tenantALease } from './test-fixtures'

describe('learning verification renewal', () => {
  // Base verifiedAt: 2026-11-10T09:00:00.000Z
  // Base expiresAt:  2026-11-11T09:00:00.000Z (24h)
  const baseLease: EvidenceLease = { ...tenantALease }

  describe('isRenewalEligible', () => {
    it('is not eligible before 18 hours have passed', () => {
      // 10 hours after verification
      const at10h = new Date('2026-11-10T19:00:00.000Z')
      expect(isRenewalEligible(baseLease, at10h)).toBe(false)
    })

    it('is eligible once 18 hours have elapsed', () => {
      // Exactly 18 hours after verification (03:00 next day)
      const at18h = new Date('2026-11-11T03:00:00.000Z')
      expect(isRenewalEligible(baseLease, at18h)).toBe(true)
    })

    it('is eligible at or after 24h expiration', () => {
      const at25h = new Date('2026-11-11T10:00:00.000Z')
      expect(isRenewalEligible(baseLease, at25h)).toBe(true)
    })
  })

  describe('renewLearningVerification', () => {
    it('successfully renews lease at 18 hours with new 24h expiration', async () => {
      const at19h = new Date('2026-11-11T04:00:00.000Z')
      const source: LearningSource = {
        ...tenantASource,
        lease: baseLease,
      }

      const deps: VerificationRenewalDeps = {
        verifyOwnership: vi.fn().mockResolvedValue({
          ...baseLease,
          verifiedAt: at19h.toISOString(),
          expiresAt: new Date(at19h.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          evidenceRevision: baseLease.evidenceRevision + 1,
        }),
        now: () => at19h,
      }

      const result = await renewLearningVerification(source, deps)

      expect(result.state).toBe('renewed')
      expect(result.lease?.verifiedAt).toBe('2026-11-11T04:00:00.000Z')
      expect(result.lease?.expiresAt).toBe('2026-11-12T04:00:00.000Z')
      expect(result.lease?.evidenceRevision).toBe(baseLease.evidenceRevision + 1)
      expect(deps.verifyOwnership).toHaveBeenCalledWith(source)
    })

    it('retains still-valid lease and returns retry when provider returns 429 rate limit before 24h', async () => {
      // 20 hours after verification (still within 24h lease)
      const at20h = new Date('2026-11-11T05:00:00.000Z')
      const source: LearningSource = {
        ...tenantASource,
        lease: baseLease,
      }

      const rateLimitError = new Error('Rate limit exceeded (429)')
      ;(rateLimitError as any).status = 429

      const deps: VerificationRenewalDeps = {
        verifyOwnership: vi.fn().mockRejectedValue(rateLimitError),
        now: () => at20h,
      }

      const result = await renewLearningVerification(source, deps)

      expect(result.state).toBe('retry')
      // Lease remains intact and unrevoked
      expect(result.lease).toEqual(baseLease)
      expect(result.nextCheckAt).toBeDefined()
    })

    it('returns expired if provider fails or rate limits after 24h lease expired', async () => {
      // 25 hours after verification (past 24h expiration)
      const at25h = new Date('2026-11-11T10:00:00.000Z')
      const source: LearningSource = {
        ...tenantASource,
        lease: baseLease,
      }

      const networkError = new Error('Rate limit or connection failure (429)')
      ;(networkError as any).status = 429

      const deps: VerificationRenewalDeps = {
        verifyOwnership: vi.fn().mockRejectedValue(networkError),
        now: () => at25h,
      }

      const result = await renewLearningVerification(source, deps)

      expect(result.state).toBe('expired')
    })

    it('returns revoked immediately if provider returns 401 or permission revoked', async () => {
      const at19h = new Date('2026-11-11T04:00:00.000Z')
      const source: LearningSource = {
        ...tenantASource,
        lease: baseLease,
      }

      const authError = new Error('Unauthorized or revoked token')
      ;(authError as any).code = 'OAUTH_NOT_CONNECTED'

      const deps: VerificationRenewalDeps = {
        verifyOwnership: vi.fn().mockRejectedValue(authError),
        now: () => at19h,
      }

      const result = await renewLearningVerification(source, deps)

      expect(result.state).toBe('revoked')
    })

    it('returns revoked if source is deleted or already revoked', async () => {
      const deletedSource: LearningSource = {
        ...tenantASource,
        lease: baseLease,
        deletedAt: '2026-11-10T12:00:00.000Z',
      }

      const deps: VerificationRenewalDeps = {
        verifyOwnership: vi.fn(),
        now: () => new Date('2026-11-11T04:00:00.000Z'),
      }

      const result = await renewLearningVerification(deletedSource, deps)
      expect(result.state).toBe('revoked')
      expect(deps.verifyOwnership).not.toHaveBeenCalled()
    })
  })
})
