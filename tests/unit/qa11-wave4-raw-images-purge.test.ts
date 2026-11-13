import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  validatePublishInputContract,
  resolveApprovedBundlePublishContext,
  RawImagesContractViolationError,
  ApprovedBundleRequiredError,
} from '../../src/features/publishing/publish-contract-validator'
import type { CreativeBundle } from '../../src/features/creative/creative-bundle-types'
import { calculateBundleFingerprint } from '../../src/features/creative/creative-bundle-engine'

describe('ANI-1131: Instant/Scheduled Publish API raw images[]/imageUrl Purge Gate', () => {
  const workspaceId = '11111111-1111-4111-a111-111111111111'
  const bundleId = '22222222-2222-4222-a222-222222222222'

  const orderedMedia = [
    {
      mediaAssetId: 'asset-1',
      sha256Digest: 'a'.repeat(64),
      position: 0,
      role: 'primary' as const,
    },
  ]
  const caption = '단호박 타르트 정본 문구'
  const hashtags = ['#베이커리']
  const creativeBriefVersion = 'v10.0'

  const validFingerprint = calculateBundleFingerprint({
    channel: 'instagram',
    caption,
    hashtags,
    orderedMedia,
    creativeBriefVersion,
  })

  const approvedBundle: CreativeBundle = {
    bundleId,
    workspaceId,
    contentId: 'content-1',
    versionId: 'version-1',
    channel: 'instagram',
    caption,
    hashtags,
    orderedMedia,
    creativeBriefVersion,
    bundleFingerprint: validFingerprint,
    approvalStatus: 'APPROVED',
    approvedFingerprint: validFingerprint,
    approvedAt: '2026-09-09T00:00:00Z',
    approvedBy: 'user-1',
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
  }

  describe('1. Raw images[] / imageUrl Input Rejection Gate', () => {
    it('rejects arbitrary external image URLs supplied in request body (Fail-Closed)', () => {
      const maliciousPayload = {
        channel: 'INSTAGRAM',
        bundleId,
        expectedFingerprint: validFingerprint,
        images: ['https://malicious-external-site.com/fake.png'], // Arbitrary URL injection!
      }

      expect(() => validatePublishInputContract(maliciousPayload)).toThrow(
        RawImagesContractViolationError
      )
    })

    it('rejects payload with imageUrl field in request body', () => {
      const maliciousPayload = {
        channel: 'INSTAGRAM',
        bundleId,
        expectedFingerprint: validFingerprint,
        imageUrl: 'https://malicious-external-site.com/fake.png',
      }

      expect(() => validatePublishInputContract(maliciousPayload)).toThrow(
        RawImagesContractViolationError
      )
    })

    it('accepts valid canonical publish request specifying only bundle identity & channel', () => {
      const canonicalPayload = {
        channel: 'INSTAGRAM',
        bundleId,
        expectedFingerprint: validFingerprint,
        idempotencyKey: 'publish-idem-1',
      }

      const validated = validatePublishInputContract(canonicalPayload)
      expect(validated.bundleId).toBe(bundleId)
      expect(validated.expectedFingerprint).toBe(validFingerprint)
    })
  })

  describe('2. Server Authority & Approved Bundle Resolution Gate', () => {
    it('resolves publish context from approved bundle without trusting client caption or media', async () => {
      const mockBundleStore = {
        getBundleById: async () => approvedBundle,
      }

      const context = await resolveApprovedBundlePublishContext({
        workspaceId,
        bundleId,
        expectedFingerprint: validFingerprint,
        bundleStore: mockBundleStore as any,
      })

      expect(context.resolvedCaption).toBe('단호박 타르트 정본 문구\n\n#베이커리')
      expect(context.primaryMediaAssetId).toBe('asset-1')
      expect(context.primaryMediaSha256).toBe('a'.repeat(64))
      expect(context.fingerprint).toBe(validFingerprint)
    })

    it('rejects publishing when bundle is not approved (PENDING/SUPERSEDED/REJECTED)', async () => {
      const pendingBundle: CreativeBundle = {
        ...approvedBundle,
        approvalStatus: 'PENDING',
        approvedFingerprint: undefined,
      }

      const mockBundleStore = {
        getBundleById: async () => pendingBundle,
      }

      await expect(
        resolveApprovedBundlePublishContext({
          workspaceId,
          bundleId,
          expectedFingerprint: validFingerprint,
          bundleStore: mockBundleStore as any,
        })
      ).rejects.toThrow(ApprovedBundleRequiredError)
    })
  })

  describe('3. Instant Publish Route Static Purge Gate', () => {
    it('ensures publishing/instant route no longer passes raw imageUrl: images[0] to executor', () => {
      const routePath = resolve(__dirname, '../../src/app/api/workspaces/[workspaceId]/publishing/instant/route.ts')
      const content = readFileSync(routePath, 'utf-8')

      // Must NOT contain the legacy vulnerable call pattern:
      expect(content).not.toContain('imageUrl: images[0]')
      // Must contain bundle resolution and contract validation:
      expect(content).toContain('validatePublishInputContract')
    })
  })
})
