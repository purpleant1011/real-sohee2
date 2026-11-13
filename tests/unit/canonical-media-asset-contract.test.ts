import { describe, it, expect } from 'vitest'
import {
  type MediaAsset,
  type ContentVersionMediaBinding,
  type PublishRendition,
  type ProviderDeliveryLease,
  VALID_MEDIA_PROVENANCE_KINDS,
  VALID_MEDIA_LIFECYCLE_STATUSES,
  validateMediaAssetIntegrity,
  validateContentVersionMediaBinding,
  validatePublishRendition,
  validateProviderDeliveryLease,
} from '@/features/media/media-asset-types'

/**
 * Wave 1: Canonical Media Asset SSOT Contract Tests
 * Linear: ANI-1071, ANI-1072, ANI-1073, ANI-1064
 */
describe('Wave 1: Canonical Media Asset SSOT Contract (ANI-1071, ANI-1072, ANI-1073, ANI-1064)', () => {
  const WORKSPACE_A = '00000000-0000-4000-8000-0000000000a2'
  const WORKSPACE_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  describe('ANI-1064: Media Provenance Taxonomy & Eligibility', () => {
    it('defines canonical provenance taxonomy', () => {
      expect(VALID_MEDIA_PROVENANCE_KINDS).toEqual([
        'GENERATED_OPENAI',
        'USER_UPLOAD',
        'OWNED_LIBRARY',
        'LEGACY_STATIC',
        'LEGACY_STOCK',
        'LEGACY_UNKNOWN',
      ])
    })

    it('requires 64-hex sha256_digest and valid MIME for canonical MediaAsset', () => {
      const validAsset: MediaAsset = {
        id: '11111111-2222-3333-4444-555555555555',
        workspace_id: WORKSPACE_A,
        bucket_id: 'content-media',
        object_path: `workspaces/${WORKSPACE_A}/media/source/11111111-2222-3333-4444-555555555555/original.png`,
        kind: 'image',
        source_type: 'GENERATED_OPENAI',
        mime_type: 'image/png',
        size_bytes: 1048576,
        width: 1024,
        height: 1024,
        sha256_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        rights_status: 'OWNED',
        lifecycle_status: 'READY',
        publish_eligibility: true,
        generation_metadata: {
          model: 'gpt-image-2',
          prompt_digest: 'abc123digest',
          visual_brief_version: '1.0',
        },
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: new Date().toISOString(),
      }

      const result = validateMediaAssetIntegrity(validAsset)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('marks LEGACY_STATIC and LEGACY_STOCK assets as NOT eligible for new production publishing', () => {
      const legacyStaticAsset: MediaAsset = {
        id: '22222222-3333-4444-5555-666666666666',
        workspace_id: WORKSPACE_A,
        bucket_id: 'content-media',
        object_path: 'legacy/sohee_insta_post.jpg',
        kind: 'image',
        source_type: 'LEGACY_STATIC',
        mime_type: 'image/jpeg',
        size_bytes: 204800,
        width: 800,
        height: 800,
        sha256_digest: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        rights_status: 'UNKNOWN',
        lifecycle_status: 'QUARANTINED',
        publish_eligibility: false, // Legacy static is not eligible for production publish!
        generation_metadata: {},
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: new Date().toISOString(),
      }

      const result = validateMediaAssetIntegrity(legacyStaticAsset)
      expect(result.isValid).toBe(true)
      expect(result.publishEligible).toBe(false)
    })

    it('rejects asset when sha256_digest is missing or invalid format', () => {
      const corruptAsset: MediaAsset = {
        id: '33333333-4444-5555-6666-777777777777',
        workspace_id: WORKSPACE_A,
        bucket_id: 'content-media',
        object_path: 'media/test.png',
        kind: 'image',
        source_type: 'GENERATED_OPENAI',
        mime_type: 'image/png',
        size_bytes: 1024,
        width: 100,
        height: 100,
        sha256_digest: 'invalid-sha', // Not 64 hex!
        rights_status: 'OWNED',
        lifecycle_status: 'READY',
        publish_eligibility: true,
        generation_metadata: {},
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: new Date().toISOString(),
      }

      const result = validateMediaAssetIntegrity(corruptAsset)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('INVALID_SHA256_DIGEST')
    })
  })

  describe('ANI-1073: ContentVersionMedia Ordered Binding Invariants', () => {
    it('validates ordered media binding with positive position and explicit role', () => {
      const binding: ContentVersionMediaBinding = {
        workspace_id: WORKSPACE_A,
        version_id: '44444444-5555-6666-7777-888888888888',
        media_asset_id: '11111111-2222-3333-4444-555555555555',
        position: 0,
        role: 'primary',
        created_at: new Date().toISOString(),
      }

      const result = validateContentVersionMediaBinding(binding)
      expect(result.isValid).toBe(true)
    })

    it('rejects binding when position is negative or role is invalid', () => {
      const invalidBinding: ContentVersionMediaBinding = {
        workspace_id: WORKSPACE_A,
        version_id: '44444444-5555-6666-7777-888888888888',
        media_asset_id: '11111111-2222-3333-4444-555555555555',
        position: -1, // Negative!
        role: 'invalid_role' as any,
        created_at: new Date().toISOString(),
      }

      const result = validateContentVersionMediaBinding(invalidBinding)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('INVALID_POSITION')
      expect(result.errors).toContain('INVALID_ROLE')
    })

    it('rejects cross-workspace binding between version and media asset', () => {
      const assetWorkspaceB: MediaAsset = {
        id: '55555555-6666-7777-8888-999999999999',
        workspace_id: WORKSPACE_B, // Workspace B!
        bucket_id: 'content-media',
        object_path: 'workspaces/B/test.png',
        kind: 'image',
        source_type: 'USER_UPLOAD',
        mime_type: 'image/png',
        size_bytes: 1024,
        width: 100,
        height: 100,
        sha256_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        rights_status: 'OWNED',
        lifecycle_status: 'READY',
        publish_eligibility: true,
        generation_metadata: {},
        created_by: '00000000-0000-0000-0000-000000000001',
        created_at: new Date().toISOString(),
      }

      const bindingWorkspaceA: ContentVersionMediaBinding = {
        workspace_id: WORKSPACE_A, // Workspace A!
        version_id: '44444444-5555-6666-7777-888888888888',
        media_asset_id: assetWorkspaceB.id,
        position: 0,
        role: 'primary',
        created_at: new Date().toISOString(),
      }

      const result = validateContentVersionMediaBinding(bindingWorkspaceA, assetWorkspaceB)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('CROSS_WORKSPACE_MEDIA_BINDING_FORBIDDEN')
    })
  })

  describe('ANI-1071 & ANI-1095: PublishRendition & ProviderDeliveryLease Contract', () => {
    it('validates channel-specific PublishRendition with distinct rendition SHA', () => {
      const rendition: PublishRendition = {
        id: '66666666-7777-8888-9999-000000000000',
        workspace_id: WORKSPACE_A,
        source_media_asset_id: '11111111-2222-3333-4444-555555555555',
        channel: 'instagram',
        transform_policy_version: 'v1.0_1080x1080_center_crop',
        crop_data: { x: 0, y: 0, width: 1080, height: 1080 },
        format: 'jpeg',
        quality: 85,
        width: 1080,
        height: 1080,
        aspect_ratio: '1:1',
        storage_bucket: 'content-media',
        object_path: `workspaces/${WORKSPACE_A}/media/renditions/66666666-7777-8888-9999-000000000000/publish.jpg`,
        rendition_sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
        created_at: new Date().toISOString(),
      }

      const result = validatePublishRendition(rendition)
      expect(result.isValid).toBe(true)
    })

    it('validates active delivery lease and rejects expired lease', () => {
      const activeLease: ProviderDeliveryLease = {
        id: '77777777-8888-9999-0000-111111111111',
        workspace_id: WORKSPACE_A,
        rendition_id: '66666666-7777-8888-9999-000000000000',
        provider: 'meta_instagram',
        purpose: 'container_creation',
        delivery_url: 'https://supabase.co/storage/v1/object/sign/content-media/test.jpg?token=valid',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 600000).toISOString(), // 10 minutes in future
        status: 'ACTIVE',
      }

      const activeResult = validateProviderDeliveryLease(activeLease)
      expect(activeResult.isValid).toBe(true)
      expect(activeResult.isExpired).toBe(false)

      const expiredLease: ProviderDeliveryLease = {
        ...activeLease,
        expires_at: new Date(Date.now() - 1000).toISOString(), // Past!
      }

      const expiredResult = validateProviderDeliveryLease(expiredLease)
      expect(expiredResult.isValid).toBe(false)
      expect(expiredResult.isExpired).toBe(true)
      expect(expiredResult.errors).toContain('DELIVERY_LEASE_EXPIRED')
    })
  })
})
