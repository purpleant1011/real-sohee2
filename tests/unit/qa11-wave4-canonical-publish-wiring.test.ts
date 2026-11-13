import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CanonicalPublishFacade,
  CanonicalPublishError,
} from '../../src/features/publishing/canonical-publish-facade'
import { PublishingExecutor } from '../../src/lib/agent-os/executors/publishing-executor'
import type { CreativeBundle } from '../../src/features/creative/creative-bundle-types'
import type { BundleExecutorDependencies } from '../../src/features/publishing/creative-bundle-publishing-executor'

describe('ANI-1133: executeCreativeBundlePublish Production Wiring & Kill Switch Gate', () => {
  const workspaceId = '11111111-1111-4111-a111-111111111111'
  const bundleId = '22222222-2222-4222-a222-222222222222'
  const fingerprint = 'a'.repeat(64)
  let origAllowlist: string | undefined

  beforeEach(() => {
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  const sampleApprovedBundle: CreativeBundle = {
    bundleId,
    workspaceId,
    contentId: 'content-1',
    versionId: 'version-1',
    channel: 'instagram',
    caption: '정본 승인 문구',
    hashtags: ['#태그'],
    orderedMedia: [
      {
        mediaAssetId: 'media-1',
        sha256Digest: 'b'.repeat(64),
        position: 0,
        role: 'primary',
      },
    ],
    creativeBriefVersion: 'v1.0',
    bundleFingerprint: fingerprint,
    approvalStatus: 'APPROVED',
    approvedFingerprint: fingerprint,
    approvedAt: '2026-09-09T00:00:00Z',
    approvedBy: 'user-1',
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
  }

  describe('1. CanonicalPublishFacade Execution & Receipt Gate', () => {
    it('executes canonical bundle publish pipeline for Instagram and records receipt', async () => {
      let recordedReceipt: any = null

      const mockDeps: BundleExecutorDependencies = {
        loadApprovedBundle: async () => sampleApprovedBundle,
        loadMediaAsset: async () => ({
          id: 'media-1',
          workspace_id: workspaceId,
          bucket_id: 'content-media',
          object_path: 'renditions/w/r.jpeg',
          kind: 'image',
          source_type: 'GENERATED_OPENAI',
          mime_type: 'image/jpeg',
          size_bytes: 1024,
          width: 1080,
          height: 1080,
          sha256_digest: 'b'.repeat(64),
          rights_status: 'OWNED',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: {},
          created_by: 'system',
          created_at: '2026-09-09T00:00:00Z',
        }),
        loadOrCreatePublishRendition: async () => ({
          id: 'rendition-1',
          workspace_id: workspaceId,
          source_media_asset_id: 'media-1',
          channel: 'INSTAGRAM',
          transform_policy_version: 'v1.0',
          format: 'jpeg',
          quality: 90,
          width: 1080,
          height: 1080,
          aspect_ratio: '1:1',
          storage_bucket: 'content-media',
          object_path: 'renditions/w/r.jpeg',
          rendition_sha256: 'c'.repeat(64),
          created_at: '2026-09-09T00:00:00Z',
        }),
        leaseGateway: {
          createSignedUrl: async () => ({ signedUrl: 'https://storage.supabase.co/signed-url', error: null }),
          probeUrl: async () => ({ ok: true, status: 200, contentType: 'image/jpeg' }),
        },
        loadCredential: async () => ({ accessToken: 'tok_meta', externalAccountId: 'acc_ig' }),
        providerPublish: async () => ({ providerPostId: 'ig_post_123', destinationUrl: 'https://instagram.com/p/123' }),
        readbackDependencies: {
          fetchPublishedPost: async () => null,
          computePerceptualSimilarity: async () => ({ similarity: 1.0 }),
        },
        recordReceipt: async (receipt) => {
          recordedReceipt = receipt
        },
      }

      const mockSupabase = {
        from: (table: string) => {
          if (table === 'kill_switches') {
            return {
              select: () => ({
                eq: async () => ({ data: [], error: null }),
              }),
            }
          }
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase as any)
      const res = await facade.executePublish(
        {
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId,
          expectedFingerprint: fingerprint,
          idempotencyKey: 'idem-1',
        },
        mockDeps
      )

      expect(res.success).toBe(true)
      expect(res.results.instagram).toBeDefined()
      expect(res.results.instagram.postId).toBe('ig_post_123')
      expect(res.results.instagram.url).toBe('https://instagram.com/p/123')
      expect(recordedReceipt).not.toBeNull()
      expect(recordedReceipt.creativeBundleId).toBe(bundleId)
    })

    it('blocks publishing when emergency kill switch is engaged', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'kill_switches') {
            return {
              select: () => ({
                eq: async () => ({
                  data: [{ is_active: true, scope: 'GLOBAL', reason: '긴급 점검으로 인한 발행 중단' }],
                  error: null,
                }),
              }),
            }
          }
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
        },
      }

      const facade = new CanonicalPublishFacade(mockSupabase as any)
      const res = await facade.executePublish(
        {
          workspaceId,
          channel: 'INSTAGRAM',
          bundleId,
          expectedFingerprint: fingerprint,
        },
        {} as any
      )

      expect(res.success).toBe(false)
      expect(res.results.instagram.errorCode).toBe('KILL_SWITCH_ENGAGED')
      expect(res.results.instagram.message).toContain('긴급 킬스위치')
    })
  })

  describe('2. Legacy PublishingExecutor Production Kill Switch Gate', () => {
    it('blocks legacy raw publish requests without version/fingerprint in production (Fail-Closed)', async () => {
      try {
        vi.stubEnv('NODE_ENV', 'production')

        const rawResult = await PublishingExecutor.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          caption: '레거시 문안',
          imageUrl: 'https://signed-storage.com/image.png',
          // Missing contentVersionId & expectedFingerprint!
        })

        expect(rawResult.success).toBe(false)
        expect(rawResult.errorCode).toBe('LEGACY_RAW_PUBLISH_KILL_SWITCH')
        expect(rawResult.statusMessage).toContain('Kill Switch')
      } finally {
        vi.unstubAllEnvs()
      }
    })
  })

  describe('3. Instant Publish Route Canonical Facade Wiring Gate', () => {
    it('verifies publishing/instant route wires CanonicalPublishFacade for Meta channels', () => {
      const routePath = resolve(__dirname, '../../src/app/api/workspaces/[workspaceId]/publishing/instant/route.ts')
      const content = readFileSync(routePath, 'utf-8')

      expect(content).toContain('CanonicalPublishFacade')
      expect(content).toContain('canonicalFacade.executePublish')
    })
  })
})
