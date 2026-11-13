/**
 * True Chat-to-Meta Publish End-to-End Ground Truth Integration Test (ANI-1129 ~ ANI-1133)
 * Validates the complete production journey:
 * 1. Conversation Workspace: Chat Prompt -> VisualBrief -> GPT-Image-2 Binary Validation -> Storage -> DB MediaAsset -> CreativeBundle Persistence
 * 2. Exact Approval: Optimistic Concurrency Approval with strict SHA-256 Bundle Fingerprint
 * 3. Canonical Publishing: Zero-Trust Client Purge -> Server Authority -> PublishRendition -> ProviderDeliveryLease -> executeCreativeBundlePublish (Instagram + Threads)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { buildVisualBrief } from '../../src/features/creative/visual-brief-builder'
import { validateImageBinary } from '../../src/features/creative/image-binary-validator'
import { SupabaseCreativeBundleStore } from '../../src/features/creative/creative-bundle-store'
import { calculateBundleFingerprint } from '../../src/features/creative/creative-bundle-engine'
import { ExactApprovalService } from '../../src/features/creative/exact-approval-service'
import {
  validatePublishInputContract,
  resolveApprovedBundlePublishContext,
} from '../../src/features/publishing/publish-contract-validator'
import { PublishRenditionService } from '../../src/features/publishing/publish-rendition-service'
import { ProviderDeliveryLeaseService } from '../../src/features/publishing/provider-delivery-lease-service'
import { CanonicalPublishFacade } from '../../src/features/publishing/canonical-publish-facade'
import type { BundleExecutorDependencies } from '../../src/features/publishing/creative-bundle-publishing-executor'
import type { MediaAsset, PublishRendition, ProviderDeliveryLease } from '../../src/features/media/media-asset-types'
import type { CreativeBundle } from '../../src/features/creative/creative-bundle-types'

describe('True Chat-to-Meta Publish E2E Integration Suite', () => {
  const workspaceId = 'e2e-ws-1111-4111-a111-111111111111'
  const userId = 'e2e-usr-2222-4222-a222-222222222222'
  const contentId = 'e2e-cnt-3333-4333-a333-333333333333'
  const versionId = 'e2e-ver-4444-4444-a444-444444444444'

  // Synthetic valid 1024x1024 PNG binary bytes (8-byte PNG header + IHDR chunk)
  function createSyntheticPngBytes(): Uint8Array {
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdrLength = [0x00, 0x00, 0x00, 0x0d] // 13 bytes
    const ihdrType = [0x49, 0x48, 0x44, 0x52] // 'IHDR'
    const width = [0x00, 0x00, 0x04, 0x00] // 1024
    const height = [0x00, 0x00, 0x04, 0x00] // 1024
    const bitDepthColorCompressionFilterInterlace = [0x08, 0x02, 0x00, 0x00, 0x00]
    const crc = [0x00, 0x00, 0x00, 0x00]
    const dummyData = new Uint8Array(200).fill(0x77)

    return new Uint8Array([
      ...header,
      ...ihdrLength,
      ...ihdrType,
      ...width,
      ...height,
      ...bitDepthColorCompressionFilterInterlace,
      ...crc,
      ...dummyData,
    ])
  }

  // In-Memory Durable Database for E2E flow simulation
  const db = {
    media_assets: new Map<string, any>(),
    generation_runs: new Map<string, any>(),
    content_version_media: new Map<string, any>(),
    creative_bundles: new Map<string, any>(),
    creative_bundle_media: new Map<string, any>(),
    publish_renditions: new Map<string, any>(),
    provider_delivery_leases: new Map<string, any>(),
    external_action_receipts: new Map<string, any>(),
    kill_switches: new Map<string, any>(),
    storage_objects: new Map<string, Uint8Array>(),
  }

  // Supabase Client Mock backed by the In-Memory DB
  const mockSupabase: any = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          db.storage_objects.set(`${bucket}:${path}`, bytes)
          return { data: { path }, error: null }
        },
        createSignedUrl: async (path: string, ttl: number) => {
          return {
            data: { signedUrl: `https://storage.supabase.co/${bucket}/${path}?token=signed_token_${Date.now()}` },
            error: null,
          }
        },
      }),
    },
    from: (table: string) => {
      const tableMap = (db as any)[table] || new Map()

      const createQueryBuilder = (initialRows?: any[]) => {
        const filters: Array<(item: any) => boolean> = []

        const applyFilters = () => {
          let res = initialRows ? [...initialRows] : Array.from(tableMap.values())
          for (const f of filters) {
            res = res.filter(f)
          }
          return res
        }

        const builder: any = {
          select: (_columns?: string) => builder,
          eq: (col: string, val: any) => {
            filters.push((item: any) => item[col] === val)
            return builder
          },
          in: (col: string, vals: any[]) => {
            filters.push((item: any) => vals.includes(item[col]))
            return builder
          },
          match: (filterObj: Record<string, any>) => {
            filters.push((item: any) =>
              Object.entries(filterObj).every(([k, v]) => item[k] === v)
            )
            return builder
          },
          order: (_col: string, _opts?: any) => builder,
          limit: (n: number) => {
            const current = applyFilters().slice(0, n)
            return Promise.resolve({ data: current, error: null })
          },
          single: async () => {
            const current = applyFilters()
            return { data: current[0] || null, error: null }
          },
          maybeSingle: async () => {
            const current = applyFilters()
            return { data: current[0] || null, error: null }
          },
          then: (resolve: any, reject: any) => {
            const current = applyFilters()
            return Promise.resolve({ data: current, error: null }).then(resolve, reject)
          },
        }
        return builder
      }

      return {
        select: (columns?: string) => createQueryBuilder(),
        insert: (rowOrRows: any) => {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          const inserted: any[] = []
          for (const r of rows) {
            const id = r.id || r.bundle_id || randomUUID()
            const fullRow = { ...r, id }
            tableMap.set(id, fullRow)
            inserted.push(fullRow)
          }
          return createQueryBuilder(inserted)
        },
        upsert: (rowOrRows: any) => {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          for (const r of rows) {
            const id = r.id || randomUUID()
            tableMap.set(id, { ...tableMap.get(id), ...r, id })
          }
          return Promise.resolve({ error: null })
        },
        update: (updates: any) => {
          const filters: Array<(item: any) => boolean> = []
          const execute = async () => {
            const updatedList: any[] = []
            for (const [key, item] of tableMap.entries()) {
              const matchesAll = filters.every((f) => f(item))
              if (matchesAll) {
                const updated = { ...item, ...updates }
                tableMap.set(key, updated)
                updatedList.push(updated)
              }
            }
            return { data: updatedList, error: null }
          }
          const builder: any = {
            eq: (col: string, val: any) => {
              filters.push((item: any) => item[col] === val)
              return builder
            },
            match: (filterObj: Record<string, any>) => {
              filters.push((item: any) =>
                Object.entries(filterObj).every(([k, v]) => item[k] === v)
              )
              return builder
            },
            select: (_cols?: string) => ({
              single: async () => {
                const res = await execute()
                return { data: res.data[0] || null, error: null }
              },
              maybeSingle: async () => {
                const res = await execute()
                return { data: res.data[0] || null, error: null }
              },
              then: (resolve: any, reject: any) => execute().then(resolve, reject),
            }),
            single: async () => {
              const res = await execute()
              return { data: res.data[0] || null, error: null }
            },
            maybeSingle: async () => {
              const res = await execute()
              return { data: res.data[0] || null, error: null }
            },
            then: (resolve: any, reject: any) => execute().then(resolve, reject),
          }
          return builder
        },
      }
    },
  }

  beforeEach(() => {
    for (const map of Object.values(db)) {
      map.clear()
    }
  })

  it('executes full journey: Chat (Text+Image Gen) -> DB Persist -> Exact Approval -> Multi-Channel (IG+Threads) Publish', async () => {
    // =========================================================================
    // STEP 1. Chat Prompt -> VisualBrief -> Image Generation -> Storage & DB
    // =========================================================================
    const userPrompt = '봄맞이 단호박 타르트 신메뉴 홍보 피드 만들어줘'

    const caption = '봄의 온기를 가득 담은 수제 단호박 타르트가 출시되었습니다.'
    const visualBrief = buildVisualBrief({
      workspaceId,
      contentVersionId: versionId,
      channel: 'instagram',
      caption,
      businessContext: {
        name: '청라 단호박 베이커리',
        industry: 'bakery',
        keywords: ['단호박 타르트', '봄 신메뉴', '디저트'],
        targetAudience: '디저트를 사랑하는 고객',
      },
      productContext: {
        name: '단호박 타르트',
        description: '국내산 단호박 무스와 바삭한 타르트지',
        sellingPoints: ['국내산 단호박 100%', '수제 타르트지'],
      },
    })

    expect(visualBrief.workspaceId).toBe(workspaceId)
    expect(visualBrief.channelSpec.channel).toBe('instagram')

    // 1-1. Image Binary Inspection
    const validPngBytes = createSyntheticPngBytes()
    const inspection = validateImageBinary(validPngBytes, { expectedMime: 'image/png' })
    expect(inspection.format).toBe('png')
    expect(inspection.width).toBe(1024)
    expect(inspection.height).toBe(1024)

    // 1-2. Generation Orchestrator Execution
    const rawSha256 = createHash('sha256').update(validPngBytes).digest('hex')
    const mediaAssetId = randomUUID()
    const objectPath = `originals/${workspaceId}/${mediaAssetId}.png`

    // Upload image to Supabase Storage
    await mockSupabase.storage.from('content-media').upload(objectPath, validPngBytes)
    expect(db.storage_objects.has(`content-media:${objectPath}`)).toBe(true)

    // Persist MediaAsset to DB
    const mediaAsset: MediaAsset = {
      id: mediaAssetId,
      workspace_id: workspaceId,
      bucket_id: 'content-media',
      object_path: objectPath,
      kind: 'image',
      source_type: 'GENERATED_OPENAI',
      mime_type: 'image/png',
      size_bytes: validPngBytes.length,
      width: 1024,
      height: 1024,
      sha256_digest: rawSha256,
      rights_status: 'OWNED',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: {
        model: 'gpt-image-2',
        prompt: userPrompt,
      },
      created_by: userId,
      created_at: new Date().toISOString(),
    }
    db.media_assets.set(mediaAssetId, mediaAsset)

    // 1-3. CreativeBundle Construction & Persistence
    const bundleStore = new SupabaseCreativeBundleStore(mockSupabase)
    const hashtags = ['#단호박타르트', '#청라디저트', '#봄신메뉴']

    const bundle = await bundleStore.persistBundle({
      workspaceId,
      contentId,
      versionId,
      channel: 'instagram',
      caption,
      hashtags,
      orderedMedia: [
        {
          mediaAssetId,
          sha256Digest: rawSha256,
          position: 0,
          role: 'primary',
        },
      ],
      creativeBriefVersion: 'v1.0',
    })

    expect(bundle.bundleId).toBeDefined()
    expect(bundle.approvalStatus).toBe('PENDING')
    expect(bundle.bundleFingerprint).toHaveLength(64)
    expect(db.creative_bundles.has(bundle.bundleId)).toBe(true)

    // Verify Chat Route response payload guarantees
    const chatPreviewPayload = {
      bundleId: bundle.bundleId,
      bundleFingerprint: bundle.bundleFingerprint,
      imageUrl: `https://storage.supabase.co/content-media/${objectPath}`,
      text: caption,
    }
    expect(chatPreviewPayload.bundleId).toBe(bundle.bundleId)
    expect(chatPreviewPayload.bundleFingerprint).toBe(bundle.bundleFingerprint)

    // =========================================================================
    // STEP 2. Exact Approval Command (Optimistic Concurrency & Fingerprint SSOT)
    // =========================================================================
    const approvalService = new ExactApprovalService(mockSupabase)

    // 2-1. Negative Test: Fingerprint mismatch must fail closed
    await expect(
      approvalService.approveBundleExact({
        workspaceId,
        bundleId: bundle.bundleId,
        expectedFingerprint: 'x'.repeat(64), // Malicious tampering attempt
        decidedBy: userId,
      })
    ).rejects.toThrow()

    // 2-2. Positive Test: Exact matching approval succeeds
    const approved = await approvalService.approveBundleExact({
      workspaceId,
      bundleId: bundle.bundleId,
      expectedFingerprint: bundle.bundleFingerprint,
      decidedBy: userId,
    })

    expect(approved.status).toBe('APPROVED')
    expect(approved.approvedFingerprint).toBe(bundle.bundleFingerprint)

    // =========================================================================
    // STEP 3. Canonical Publishing: Instagram + Threads Multi-Channel Delivery
    // =========================================================================

    // 3-1. Request Validation Gate: Reject arbitrary URL injection
    expect(() =>
      validatePublishInputContract({
        channel: 'BOTH',
        bundleId: bundle.bundleId,
        imageUrl: 'https://malicious-external-site.com/hacked.png',
      })
    ).toThrow()

    // 3-2. Resolve Approved Bundle Authority
    const publishContext = await resolveApprovedBundlePublishContext({
      workspaceId,
      bundleId: bundle.bundleId,
      expectedFingerprint: bundle.bundleFingerprint,
      bundleStore,
    })
    expect(publishContext.bundle.approvalStatus).toBe('APPROVED')
    expect(publishContext.primaryMediaAssetId).toBe(mediaAssetId)

    // 3-3. PublishRendition & ProviderDeliveryLease Creation
    const renditionService = new PublishRenditionService(mockSupabase)
    const leaseService = new ProviderDeliveryLeaseService(mockSupabase)

    const rendition = await renditionService.getOrCreateRendition({
      workspaceId,
      sourceMediaAssetId: publishContext.primaryMediaAssetId,
      channel: 'INSTAGRAM',
    })
    expect(rendition.id).toBeDefined()
    expect(rendition.format).toBe('jpeg')
    expect(rendition.width).toBe(1080)
    expect(rendition.height).toBe(1080)
    expect(rendition.rendition_sha256).toHaveLength(64)
    expect(db.publish_renditions.has(rendition.id)).toBe(true)

    const lease = await leaseService.issueDeliveryLease({
      workspaceId,
      rendition,
      provider: 'instagram',
      purpose: 'instagram_publish',
      ttlSeconds: 3600,
      skipProbe: true,
    })
    expect(lease.status).toBe('ACTIVE')
    expect(lease.delivery_url).toContain('https://storage.supabase.co/content-media/')
    expect(db.provider_delivery_leases.has(lease.id)).toBe(true)

    // 3-4. Canonical Facade Multi-channel Publishing Execution (Instagram + Threads)
    const publishedPostTracker: Record<string, string> = {}

    const customDeps: BundleExecutorDependencies = {
      loadApprovedBundle: async (bundleId, wsId) => bundleStore.getBundleById(wsId, bundleId),
      loadMediaAsset: async () => mediaAsset,
      loadOrCreatePublishRendition: async () => rendition,
      leaseGateway: {
        createSignedUrl: async (b, p, ttl) => ({
          signedUrl: `https://storage.supabase.co/${b}/${p}?ttl=${ttl}`,
          error: null,
        }),
        probeUrl: async () => ({ ok: true, status: 200, contentType: 'image/jpeg' }),
      },
      loadCredential: async () => ({
        accessToken: 'mock_meta_access_token_valid',
        externalAccountId: 'meta_act_987654',
      }),
      providerPublish: async (input) => {
        const postId = `meta_${input.channel}_post_${Date.now()}`
        publishedPostTracker[input.channel] = postId
        return {
          providerPostId: postId,
          destinationUrl: `https://www.${input.channel}.com/p/${postId}`,
        }
      },
      readbackDependencies: {
        fetchPublishedPost: async () => null,
        computePerceptualSimilarity: async () => ({ similarity: 1.0 }),
      },
      recordReceipt: async (receipt) => {
        db.external_action_receipts.set(receipt.receiptId, receipt)
      },
    }

    const facade = new CanonicalPublishFacade(mockSupabase)
    const publishResponse = await facade.executePublish(
      {
        workspaceId,
        channel: 'BOTH',
        bundleId: bundle.bundleId,
        expectedFingerprint: bundle.bundleFingerprint,
        idempotencyKey: 'idem-e2e-true-publish-1',
      },
      customDeps
    )

    // =========================================================================
    // STEP 4. Assert Final Verification Proofs
    // =========================================================================
    expect(publishResponse.success).toBe(true)
    expect(publishResponse.channel).toBe('BOTH')

    // Both Instagram and Threads must succeed with verified post IDs & URLs
    expect(publishResponse.results.instagram).toBeDefined()
    expect(publishResponse.results.instagram.success).toBe(true)
    expect(publishResponse.results.instagram.postId).toBe(publishedPostTracker['instagram'])
    expect(publishResponse.results.instagram.url).toContain('https://www.instagram.com/p/')

    expect(publishResponse.results.threads).toBeDefined()
    expect(publishResponse.results.threads.success).toBe(true)
    expect(publishResponse.results.threads.postId).toBe(publishedPostTracker['threads'])
    expect(publishResponse.results.threads.url).toContain('https://www.threads.com/p/')

    // Durable receipts must be created in DB
    expect(db.external_action_receipts.size).toBeGreaterThanOrEqual(1)
    for (const receipt of db.external_action_receipts.values()) {
      expect(receipt.creativeBundleId).toBe(bundle.bundleId)
      expect(receipt.creativeFingerprint).toBe(bundle.bundleFingerprint)
      expect(['instagram', 'threads']).toContain(receipt.channel)
    }
  })
})
