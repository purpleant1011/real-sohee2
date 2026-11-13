import { describe, expect, it, vi } from 'vitest'
import {
  verifyLearningOwnership,
  createMarkerChallenge,
  confirmMarkerChallenge,
  createProductionOwnershipDeps,
  type OwnershipVerificationDeps,
  type MarkerChallengeDeps,
} from './ownership'
import type { LearningSource } from './contracts'
import { tenantASource } from './test-fixtures'

describe('learning ownership verification', () => {
  const fixedNow = new Date('2026-11-10T12:00:00.000Z')

  describe('OAuth ownership verification', () => {
    it('successfully verifies ownership with valid OAuth token, subject match, and read scope', async () => {
      const mockFetchProviderMe = vi.fn().mockResolvedValue({
        id: 'ig_act_tenant_a',
        username: 'tenant_a_biz',
      })

      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid_meta_access_token',
          scopes: ['instagram_basic', 'instagram_content_publish'],
          providerAccountId: 'ig_act_tenant_a',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: mockFetchProviderMe,
        now: () => fixedNow,
      }

      const lease = await verifyLearningOwnership(tenantASource, deps)

      expect(lease).toEqual({
        workspaceId: tenantASource.workspaceId,
        sourceId: tenantASource.sourceId,
        revision: tenantASource.revision,
        providerAccountId: 'ig_act_tenant_a',
        method: 'oauth',
        verifiedAt: '2026-11-10T12:00:00.000Z',
        expiresAt: '2026-11-11T12:00:00.000Z', // min(now+24h, credentialExp) -> now+24h
        revokedAt: null,
        evidenceRevision: 2,
      })

      expect(mockFetchProviderMe).toHaveBeenCalledWith('instagram', 'valid_meta_access_token')
    })

    it('bounds lease expiration to credential expiration when credential expires within 24h', async () => {
      // Credential expires in 6 hours (18:00:00)
      const credentialExp = '2026-11-10T18:00:00.000Z'

      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'short_lived_token',
          scopes: ['instagram_basic'],
          providerAccountId: 'ig_act_tenant_a',
          expiresAt: credentialExp,
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: 'ig_act_tenant_a',
          username: 'tenant_a_biz',
        }),
        now: () => fixedNow,
      }

      const lease = await verifyLearningOwnership(tenantASource, deps)
      // Must be bounded to credential expiration, not full 24h
      expect(lease.expiresAt).toBe(credentialExp)
    })

    it('rejects verification if providerAccountId in credential or me.id is missing or blank', async () => {
      const depsMissingCredId: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'token',
          scopes: ['instagram_basic'],
          providerAccountId: '', // blank!
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: 'valid_id',
          username: 'tenant_a_biz',
        }),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(tenantASource, depsMissingCredId)).rejects.toThrowError(
        /oauth_credential_invalid/i,
      )

      const depsMissingMeId: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'token',
          scopes: ['instagram_basic'],
          providerAccountId: 'valid_id',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: '', // blank!
          username: 'tenant_a_biz',
        }),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(tenantASource, depsMissingMeId)).rejects.toThrowError(
        /provider_identity_invalid/i,
      )
    })

    it('rejects verification if OAuth token is expired', async () => {
      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'expired_meta_token',
          scopes: ['instagram_basic'],
          providerAccountId: 'ig_act_tenant_a',
          expiresAt: '2026-11-09T00:00:00.000Z', // already expired before fixedNow (11-10)
        }),
        fetchProviderMe: vi.fn(),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(tenantASource, deps)).rejects.toThrowError(
        /oauth_token_expired/i,
      )
    })

    it('rejects verification if token subject does not match /me response id', async () => {
      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'token_subject_123',
          scopes: ['instagram_basic'],
          providerAccountId: 'expected_id_123',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: 'actual_different_id_456',
          username: 'tenant_a_biz',
        }),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(tenantASource, deps)).rejects.toThrowError(
        /oauth_subject_mismatch/i,
      )
    })

    it('rejects verification if username does not match canonical identity', async () => {
      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid_meta_access_token',
          scopes: ['instagram_basic'],
          providerAccountId: 'ig_act_another',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: 'ig_act_another',
          username: 'completely_different_user',
        }),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(tenantASource, deps)).rejects.toThrowError(
        /identity_mismatch/i,
      )
    })

    it('rejects verification if required read scopes are missing (e.g. only publish scope)', async () => {
      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid_meta_access_token',
          scopes: ['instagram_content_publish'], // missing instagram_basic
          providerAccountId: 'ig_act_tenant_a',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: 'ig_act_tenant_a',
          username: 'tenant_a_biz',
        }),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(tenantASource, deps)).rejects.toThrowError(
        /insufficient_scopes/i,
      )
    })

    it('rejects verification if source is deleted or revoked', async () => {
      const deletedSource: LearningSource = {
        ...tenantASource,
        deletedAt: '2026-11-09T00:00:00.000Z',
      }
      const revokedSource: LearningSource = {
        ...tenantASource,
        verification: 'revoked',
      }

      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn(),
        fetchProviderMe: vi.fn(),
        now: () => fixedNow,
      }

      await expect(verifyLearningOwnership(deletedSource, deps)).rejects.toThrowError(
        /source_deleted/i,
      )
      await expect(verifyLearningOwnership(revokedSource, deps)).rejects.toThrowError(
        /source_revoked/i,
      )
    })

    it('fails closed when providerAccountId changes (account reassignment) to prevent stale facts reuse', async () => {
      const deps: OwnershipVerificationDeps = {
        getOAuthCredential: vi.fn().mockResolvedValue({
          accessToken: 'valid_meta_access_token',
          scopes: ['instagram_basic'],
          providerAccountId: 'new_reassigned_id_999',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        fetchProviderMe: vi.fn().mockResolvedValue({
          id: 'new_reassigned_id_999',
          username: 'tenant_a_biz',
        }),
        now: () => fixedNow,
      }

      // Existing lease had 'ig_act_tenant_a', new one has 'new_reassigned_id_999'
      // Must fail closed with IDENTITY_REASSIGNED and refuse lease issuance
      await expect(verifyLearningOwnership(tenantASource, deps)).rejects.toThrowError(
        /identity_reassigned/i,
      )
    })
  })

  describe('production dependency factory', () => {
    it('does not forge default scopes when scopes are missing from record', async () => {
      const factory = createProductionOwnershipDeps({
        getCredentialRecord: vi.fn().mockResolvedValue({
          accessToken: 'raw_token',
          // scopes is undefined
        }),
        fetchMe: vi.fn(),
      })

      const cred = await factory.getOAuthCredential(tenantASource.workspaceId, 'instagram')
      expect(cred).not.toBeNull()
      expect(cred?.scopes).toEqual([]) // must be empty array, NOT forged default scopes
    })
  })

  describe('profile marker challenge security', () => {
    it('blocks marker issuance and confirmation for platforms without capability', async () => {
      const markerStore = new Map()
      const deps: MarkerChallengeDeps = {
        saveChallenge: vi.fn().mockImplementation(async (c) => markerStore.set(c.challengeId, c)),
        findChallenge: vi.fn().mockImplementation(async (id) => markerStore.get(id) ?? null),
        consumeChallengeCAS: vi.fn().mockResolvedValue(true),
        fetchProfileMarker: vi.fn(),
        actorId: 'actor_1',
        now: () => fixedNow,
      }

      // Instagram does not have profile_marker capability
      await expect(
        createMarkerChallenge(tenantASource, 'actor_1', deps),
      ).rejects.toThrowError(/marker_verification_blocked/i)

      await expect(
        confirmMarkerChallenge(tenantASource, 'chal_1', deps),
      ).rejects.toThrowError(/marker_verification_blocked/i)
    })

    it('rejects marker issuance if actorId is empty', async () => {
      const deps: MarkerChallengeDeps = {
        saveChallenge: vi.fn(),
        findChallenge: vi.fn(),
        consumeChallengeCAS: vi.fn(),
        fetchProfileMarker: vi.fn(),
        actorId: '',
      }

      await expect(createMarkerChallenge(tenantASource, '', deps)).rejects.toThrowError(
        /invalid_actor/i,
      )
    })
  })
})
