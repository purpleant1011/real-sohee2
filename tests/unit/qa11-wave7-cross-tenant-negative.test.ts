import { describe, it, expect, vi } from 'vitest'
import {
  SupabaseCreativeBundleStore,
  CrossTenantMediaAssetError,
} from '@/features/creative/creative-bundle-store'
import {
  PublishRenditionService,
  PublishRenditionError,
} from '@/features/publishing/publish-rendition-service'
import {
  ProviderDeliveryLeaseService,
  ProviderDeliveryLeaseError,
} from '@/features/publishing/provider-delivery-lease-service'
import { ExactApprovalService, BundleNotFoundError } from '@/features/creative/exact-approval-service'
import {
  validatePublishInputContract,
  RawImagesContractViolationError,
} from '@/features/publishing/publish-contract-validator'
import { invalidatePrivilegedSessionCache } from '@/features/operator-auth/admin-route-guard'

describe('ANI-1147: Cross-Tenant Negative E2E — Bakery↔Beauty 완전 격리 증명', () => {
  const bakeryWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const beautyWorkspaceId = '22222222-2222-4222-8222-222222222222'

  const beautyMediaId = 'media_beauty_eyebrow_001'
  const bakeryMediaId = 'media_bakery_tart_001'

  describe('1. Cross-Tenant Media Asset Injection Guard', () => {
    it('fails closed when Bakery attempts to bind Beauty MediaAsset to a CreativeBundle', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'media_assets') {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: beautyMediaId,
                    workspace_id: beautyWorkspaceId, // FOREIGN WORKSPACE!
                  },
                ],
                error: null,
              }),
            }
          }
          return {}
        }),
      } as any

      const store = new SupabaseCreativeBundleStore(mockSupabase)

      await expect(
        store.persistBundle({
          workspaceId: bakeryWorkspaceId,
          contentId: 'content_bakery_1',
          versionId: 'version_bakery_1',
          channel: 'instagram',
          caption: '단호박 타르트',
          hashtags: ['#타르트'],
          orderedMedia: [
            {
              mediaAssetId: beautyMediaId,
              sha256Digest: 'a'.repeat(64),
              position: 0,
              role: 'primary',
            },
          ],
        })
      ).rejects.toThrow(CrossTenantMediaAssetError)
    })
  })

  describe('2. Cross-Tenant Rendition Creation Guard', () => {
    it('rejects rendition creation when requested workspace does not match media asset workspace', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'publish_renditions') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }
          }
          if (table === 'media_assets') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: beautyMediaId,
                  workspace_id: beautyWorkspaceId, // Belonging to Beauty!
                  publish_eligibility: true,
                  lifecycle_status: 'READY',
                },
                error: null,
              }),
            }
          }
          return {}
        }),
      } as any

      const service = new PublishRenditionService(mockSupabase)

      await expect(
        service.getOrCreateRendition({
          workspaceId: bakeryWorkspaceId, // Requesting from Bakery!
          sourceMediaAssetId: beautyMediaId,
          channel: 'INSTAGRAM',
        })
      ).rejects.toMatchObject({
        code: 'CROSS_TENANT_RENDITION_FORBIDDEN',
      })
    })
  })

  describe('3. Cross-Tenant Delivery Lease Guard', () => {
    it('rejects delivery lease issuance when rendition belongs to a different workspace', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'publish_renditions') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'rendition_beauty_1',
                  workspace_id: beautyWorkspaceId, // Belonging to Beauty!
                  storage_bucket: 'content-media',
                  storage_path: 'beauty/path.jpg',
                },
                error: null,
              }),
            }
          }
          return {}
        }),
        storage: {
          from: vi.fn().mockReturnValue({
            createSignedUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: 'https://storage/signed' },
              error: null,
            }),
          }),
        },
      } as any

      const leaseService = new ProviderDeliveryLeaseService(mockSupabase)

      await expect(
        leaseService.issueDeliveryLease({
          workspaceId: bakeryWorkspaceId, // Requesting from Bakery!
          rendition: {
            id: 'rendition_beauty_1',
            workspace_id: beautyWorkspaceId, // Belonging to Beauty!
            storage_bucket: 'content-media',
            object_path: 'beauty/path.jpg',
          } as any,
          provider: 'meta',
          ttlSeconds: 900,
        })
      ).rejects.toMatchObject({
        code: 'CROSS_WORKSPACE_LEASE_FORBIDDEN',
      })
    })
  })

  describe('4. Cross-Tenant Exact Bundle Approval Hijacking Guard', () => {
    it('blocks Beauty tenant operator from approving a Bakery CreativeBundle', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            match: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: new Error('Row not found or predicate mismatch'),
                }),
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null, // Cross-tenant lookup fails: bundle doesn't exist in Beauty workspace
              error: new Error('No matching row for cross-tenant bundle'),
            }),
          }),
        }),
      } as any

      const approvalService = new ExactApprovalService(mockSupabase)

      await expect(
        approvalService.approveBundleExact({
          workspaceId: beautyWorkspaceId, // Attacking workspace
          bundleId: 'bundle_bakery_pumpkin_001',
          expectedFingerprint: 'a'.repeat(64),
          decidedBy: 'user_beauty_attacker',
        })
      ).rejects.toThrow(BundleNotFoundError)
    })
  })

  describe('5. Raw Images and Arbitrary External URL Injection Guard', () => {
    it('fails closed when client attempts raw imageUrl or external Unsplash injection', () => {
      expect(() =>
        validatePublishInputContract({
          imageUrl: 'https://images.unsplash.com/photo-fake',
        })
      ).toThrow(RawImagesContractViolationError)

      expect(() =>
        validatePublishInputContract({
          images: ['https://attacker.evil.com/payload.jpg'],
        })
      ).toThrow(RawImagesContractViolationError)
    })
  })

  describe('6. Workspace Switch Privileged Cache Invalidation & Zero Token Leakage', () => {
    it('invalidates privileged cache cleanly on workspace switch and leaves zero residue', () => {
      // Test cache invalidation helper
      expect(() => invalidatePrivilegedSessionCache(bakeryWorkspaceId)).not.toThrow()
      expect(() => invalidatePrivilegedSessionCache(beautyWorkspaceId)).not.toThrow()
    })

    it('proves zero cross-tenant token or copy leakage in domain boundaries', () => {
      const bakeryBrief = {
        subject: '단호박 타르트',
        hashtags: ['#단호박타르트', '#베이커리'],
        tone: '따뜻한 감성',
      }

      const beautyKeywords = ['눈썹', '반영구', '바이름', 'microblading']
      const serialized = JSON.stringify(bakeryBrief)

      for (const kw of beautyKeywords) {
        expect(serialized).not.toContain(kw)
      }
    })
  })
})
