import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PublishRenditionService,
  PublishRenditionError,
} from '../../src/features/publishing/publish-rendition-service'
import {
  ProviderDeliveryLeaseService,
  ProviderDeliveryLeaseError,
} from '../../src/features/publishing/provider-delivery-lease-service'
import type { MediaAsset, PublishRendition, ProviderDeliveryLease } from '../../src/features/media/media-asset-types'

describe('ANI-1132: PublishRendition + ProviderDeliveryLease Persistence Gate', () => {
  const workspaceId = '11111111-1111-4111-a111-111111111111'
  const otherWorkspaceId = '99999999-9999-4999-a999-999999999999'
  const sourceMediaAssetId = '22222222-2222-4222-a222-222222222222'
  const sourceSha256 = 'a'.repeat(64)

  const sampleMediaAsset: MediaAsset = {
    id: sourceMediaAssetId,
    workspace_id: workspaceId,
    bucket_id: 'content-media',
    object_path: `originals/${workspaceId}/${sourceMediaAssetId}.png`,
    kind: 'image',
    source_type: 'GENERATED_OPENAI',
    mime_type: 'image/png',
    size_bytes: 1024 * 1024,
    width: 1024,
    height: 1024,
    sha256_digest: sourceSha256,
    rights_status: 'OWNED',
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: { model: 'gpt-image-2' },
    created_by: 'system',
    created_at: '2026-09-09T00:00:00Z',
  }

  describe('1. PublishRendition Creation & Lineage Tracking', () => {
    it('creates and persists channel-specific PublishRendition from approved source MediaAsset', async () => {
      let insertedRow: any = null

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'publish_renditions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: async () => ({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
              insert: (row: any) => {
                insertedRow = row
                return {
                  select: async () => ({ data: [row], error: null }),
                }
              },
            }
          }
          if (table === 'media_assets') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: sampleMediaAsset, error: null }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const service = new PublishRenditionService(mockSupabase as any)
      const rendition = await service.getOrCreateRendition({
        workspaceId,
        sourceMediaAssetId,
        channel: 'INSTAGRAM',
      })

      expect(rendition.workspace_id).toBe(workspaceId)
      expect(rendition.source_media_asset_id).toBe(sourceMediaAssetId)
      expect(rendition.channel).toBe('INSTAGRAM')
      expect(rendition.format).toBe('jpeg')
      expect(rendition.width).toBe(1080)
      expect(rendition.height).toBe(1080)
      expect(rendition.aspect_ratio).toBe('1:1')
      expect(rendition.rendition_sha256).toBeDefined()
      expect(rendition.rendition_sha256).toHaveLength(64)
      expect(insertedRow).not.toBeNull()
      expect(insertedRow.id).toBe(rendition.id)
    })

    it('returns existing cached PublishRendition if already created (Idempotent)', async () => {
      const existingRendition: PublishRendition = {
        id: 'rendition-1',
        workspace_id: workspaceId,
        source_media_asset_id: sourceMediaAssetId,
        channel: 'INSTAGRAM',
        transform_policy_version: 'v1.0',
        format: 'jpeg',
        quality: 90,
        width: 1080,
        height: 1080,
        aspect_ratio: '1:1',
        storage_bucket: 'content-media',
        object_path: 'renditions/w/r.jpeg',
        rendition_sha256: 'b'.repeat(64),
        created_at: '2026-09-09T00:00:00Z',
      }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'publish_renditions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: async () => ({ data: [existingRendition], error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const service = new PublishRenditionService(mockSupabase as any)
      const rendition = await service.getOrCreateRendition({
        workspaceId,
        sourceMediaAssetId,
        channel: 'INSTAGRAM',
      })

      expect(rendition.id).toBe('rendition-1')
      expect(rendition.rendition_sha256).toBe('b'.repeat(64))
    })

    it('rejects cross-tenant media asset rendition derivation (Fail-Closed)', async () => {
      const crossTenantAsset: MediaAsset = {
        ...sampleMediaAsset,
        workspace_id: otherWorkspaceId,
      }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'publish_renditions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: async () => ({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'media_assets') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: crossTenantAsset, error: null }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const service = new PublishRenditionService(mockSupabase as any)
      await expect(
        service.getOrCreateRendition({
          workspaceId,
          sourceMediaAssetId,
          channel: 'INSTAGRAM',
        })
      ).rejects.toThrow(PublishRenditionError)
    })

    it('rejects rendition creation for media asset ineligible for publish', async () => {
      const ineligibleAsset: MediaAsset = {
        ...sampleMediaAsset,
        publish_eligibility: false,
        lifecycle_status: 'QUARANTINED',
      }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'publish_renditions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      limit: async () => ({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'media_assets') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: ineligibleAsset, error: null }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const service = new PublishRenditionService(mockSupabase as any)
      await expect(
        service.getOrCreateRendition({
          workspaceId,
          sourceMediaAssetId,
          channel: 'INSTAGRAM',
        })
      ).rejects.toThrow(PublishRenditionError)
    })
  })

  describe('2. ProviderDeliveryLease Lifecycle & Reconcile Boundaries', () => {
    const sampleRendition: PublishRendition = {
      id: 'rendition-123',
      workspace_id: workspaceId,
      source_media_asset_id: sourceMediaAssetId,
      channel: 'INSTAGRAM',
      transform_policy_version: 'v1.0',
      format: 'jpeg',
      quality: 90,
      width: 1080,
      height: 1080,
      aspect_ratio: '1:1',
      storage_bucket: 'content-media',
      object_path: `renditions/${workspaceId}/rendition-123.jpeg`,
      rendition_sha256: 'c'.repeat(64),
      created_at: '2026-09-09T00:00:00Z',
    }

    it('issues and persists a time-limited delivery lease from Supabase Storage', async () => {
      let insertedLease: any = null

      const mockSupabase = {
        storage: {
          from: (bucket: string) => ({
            createSignedUrl: async (path: string, ttl: number) => ({
              data: { signedUrl: `https://storage.supabase.co/${bucket}/${path}?token=abc` },
              error: null,
            }),
          }),
        },
        from: (table: string) => {
          if (table === 'provider_delivery_leases') {
            return {
              insert: (row: any) => {
                insertedLease = row
                return {
                  select: async () => ({ data: [row], error: null }),
                }
              },
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        },
      }

      const leaseService = new ProviderDeliveryLeaseService(mockSupabase as any)
      const lease = await leaseService.issueDeliveryLease({
        workspaceId,
        rendition: sampleRendition,
        provider: 'instagram',
        purpose: 'meta_publish',
        ttlSeconds: 3600,
        skipProbe: true,
      })

      expect(lease.id).toBeDefined()
      expect(lease.workspace_id).toBe(workspaceId)
      expect(lease.rendition_id).toBe('rendition-123')
      expect(lease.provider).toBe('instagram')
      expect(lease.delivery_url).toContain('https://storage.supabase.co/content-media/')
      expect(lease.status).toBe('ACTIVE')
      expect(insertedLease).not.toBeNull()
      expect(insertedLease.id).toBe(lease.id)
    })

    it('rejects cross-workspace delivery lease issuance (Fail-Closed)', async () => {
      const mockSupabase = {
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      }

      const leaseService = new ProviderDeliveryLeaseService(mockSupabase as any)
      await expect(
        leaseService.issueDeliveryLease({
          workspaceId: otherWorkspaceId, // Mismatched workspace!
          rendition: sampleRendition,
          provider: 'instagram',
        })
      ).rejects.toThrow(ProviderDeliveryLeaseError)
    })

    it('reuses active lease with sufficient TTL in ensureActiveDeliveryLease', async () => {
      const now = Date.now()
      const futureExpiry = new Date(now + 1800 * 1000).toISOString() // 30 min remaining

      const activeLease: ProviderDeliveryLease = {
        id: 'lease-existing',
        workspace_id: workspaceId,
        rendition_id: sampleRendition.id,
        provider: 'instagram',
        purpose: 'meta_publish',
        delivery_url: 'https://storage.supabase.co/content-media/valid-url',
        issued_at: new Date(now - 600 * 1000).toISOString(),
        expires_at: futureExpiry,
        status: 'ACTIVE',
      }

      const mockSupabase = {} as any
      const leaseService = new ProviderDeliveryLeaseService(mockSupabase)

      const ensured = await leaseService.ensureActiveDeliveryLease({
        workspaceId,
        rendition: sampleRendition,
        provider: 'instagram',
        currentLease: activeLease,
        minRemainingSeconds: 300,
      })

      expect(ensured.id).toBe('lease-existing')
    })

    it('blocks unsafe blind republish when provider side-effect occurred without recorded lease', async () => {
      const mockSupabase = {} as any
      const leaseService = new ProviderDeliveryLeaseService(mockSupabase)

      await expect(
        leaseService.ensureActiveDeliveryLease({
          workspaceId,
          rendition: sampleRendition,
          provider: 'instagram',
          currentLease: null,
          providerSideEffectOccurred: true, // Post already submitted to Meta!
        })
      ).rejects.toThrow(ProviderDeliveryLeaseError)
    })
  })

  describe('3. Instant Publish Route 3-Tier Pipeline Wiring Gate', () => {
    it('verifies publishing/instant route wires PublishRendition and ProviderDeliveryLease', () => {
      const routePath = resolve(__dirname, '../../src/app/api/workspaces/[workspaceId]/publishing/instant/route.ts')
      const content = readFileSync(routePath, 'utf-8')

      // Must instantiate and invoke PublishRenditionService
      expect(content).toContain('PublishRenditionService')
      expect(content).toContain('getOrCreateRendition')

      // Must instantiate and invoke ProviderDeliveryLeaseService
      expect(content).toContain('ProviderDeliveryLeaseService')
      expect(content).toContain('issueDeliveryLease')

      // Must pass lease delivery_url to authoritativeImageUrl
      expect(content).toContain('authoritativeImageUrl = lease.delivery_url')
    })
  })
})
