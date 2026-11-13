import { describe, it, expect, vi } from 'vitest'
import {
  calculateBundleFingerprint,
  validateCreativeBundleInput,
  createCreativeBundle,
} from '../../src/features/creative/creative-bundle-engine'
import type { CreativeBundleInput, BundleOrderedMediaItem } from '../../src/features/creative/creative-bundle-types'
import {
  SupabaseCreativeBundleStore,
  CrossTenantMediaAssetError,
} from '../../src/features/creative/creative-bundle-store'

describe('ANI-1129: CreativeBundle Persistence + Ordered Media Fingerprint Real DB Wiring', () => {
  const workspaceId = '11111111-1111-4111-a111-111111111111'
  const alienWorkspaceId = '99999999-9999-4999-a999-999999999999'
  const contentId = '22222222-2222-4222-a222-222222222222'
  const versionId = '33333333-3333-4333-a333-333333333333'
  const mediaAssetId1 = '44444444-4444-4444-a444-444444444441'
  const mediaAssetId2 = '44444444-4444-4444-a444-444444444442'
  const sha256_1 = 'a'.repeat(64)
  const sha256_2 = 'b'.repeat(64)

  const sampleOrderedMedia: BundleOrderedMediaItem[] = [
    {
      mediaAssetId: mediaAssetId1,
      sha256Digest: sha256_1,
      position: 0,
      role: 'primary',
    },
    {
      mediaAssetId: mediaAssetId2,
      sha256Digest: sha256_2,
      position: 1,
      role: 'carousel_item',
    },
  ]

  describe('1. Canonical Serialization & Ordered Media Fingerprint Gate', () => {
    it('generates a deterministic 64-character hex SHA-256 digest', () => {
      const fp1 = calculateBundleFingerprint({
        channel: 'instagram',
        caption: '신선한 단호박 타르트가 나왔습니다!',
        hashtags: ['#베이커리', '#단호박타르트'],
        orderedMedia: sampleOrderedMedia,
        creativeBriefVersion: 'v10.0',
      })
      expect(fp1).toMatch(/^[a-f0-9]{64}$/)

      const fp2 = calculateBundleFingerprint({
        channel: 'instagram',
        caption: '신선한 단호박 타르트가 나왔습니다!',
        hashtags: ['#단호박타르트', '#베이커리'], // order swapped
        orderedMedia: sampleOrderedMedia,
        creativeBriefVersion: 'v10.0',
      })
      // Hashtags normalization sorts them, so fp1 === fp2
      expect(fp1).toBe(fp2)
    })

    it('changes fingerprint when media ordering is changed (Ordered Media Lineage)', () => {
      const originalFp = calculateBundleFingerprint({
        channel: 'instagram',
        caption: '단호박 타르트',
        hashtags: ['#베이커리'],
        orderedMedia: [
          { mediaAssetId: mediaAssetId1, sha256Digest: sha256_1, position: 0, role: 'primary' },
          { mediaAssetId: mediaAssetId2, sha256Digest: sha256_2, position: 1, role: 'carousel_item' },
        ],
      })

      // Swapping positions
      const swappedFp = calculateBundleFingerprint({
        channel: 'instagram',
        caption: '단호박 타르트',
        hashtags: ['#베이커리'],
        orderedMedia: [
          { mediaAssetId: mediaAssetId2, sha256Digest: sha256_2, position: 0, role: 'primary' },
          { mediaAssetId: mediaAssetId1, sha256Digest: sha256_1, position: 1, role: 'carousel_item' },
        ],
      })

      expect(originalFp).not.toBe(swappedFp)
    })

    it('changes fingerprint when caption, channel, or brief version changes', () => {
      const baseArgs = {
        channel: 'instagram',
        caption: '단호박 타르트',
        hashtags: ['#베이커리'],
        orderedMedia: sampleOrderedMedia,
        creativeBriefVersion: 'v10.0',
      }
      const baseFp = calculateBundleFingerprint(baseArgs)

      const diffCaption = calculateBundleFingerprint({ ...baseArgs, caption: '단호박 타르트 특가 세일' })
      expect(diffCaption).not.toBe(baseFp)

      const diffChannel = calculateBundleFingerprint({ ...baseArgs, channel: 'threads' })
      expect(diffChannel).not.toBe(baseFp)

      const diffBrief = calculateBundleFingerprint({ ...baseArgs, creativeBriefVersion: 'v11.0' })
      expect(diffBrief).not.toBe(baseFp)
    })
  })

  describe('2. Cross-Workspace Tenant Isolation Guard Gate', () => {
    it('blocks persisting bundle if media asset belongs to another workspace (Fail-Closed)', async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'media_assets') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { id: mediaAssetId1, workspace_id: workspaceId },
                    { id: mediaAssetId2, workspace_id: alienWorkspaceId }, // Alien tenant!
                  ],
                  error: null,
                }),
              }),
            }
          }
          return {}
        }),
      }

      const store = new SupabaseCreativeBundleStore(mockSupabase as any)
      const input: CreativeBundleInput = {
        workspaceId,
        contentId,
        versionId,
        channel: 'instagram',
        caption: '단호박 타르트',
        hashtags: ['#베이커리'],
        orderedMedia: sampleOrderedMedia,
      }

      await expect(store.persistBundle(input)).rejects.toThrow(CrossTenantMediaAssetError)
    })
  })

  describe('3. Supabase CreativeBundleStore Persistence Gate', () => {
    it('persists creative_bundles and creative_bundle_media rows with deterministic lineage', async () => {
      let insertedBundle: any = null
      let insertedMedia: any[] = []

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'media_assets') {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { id: mediaAssetId1, workspace_id: workspaceId },
                    { id: mediaAssetId2, workspace_id: workspaceId },
                  ],
                  error: null,
                }),
              }),
            }
          }
          if (table === 'creative_bundles') {
            return {
              insert: vi.fn().mockImplementation((bundleRow: any) => {
                insertedBundle = bundleRow
                return {
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { ...bundleRow, id: bundleRow.id || 'bundle-123' },
                      error: null,
                    }),
                  }),
                }
              }),
              update: vi.fn().mockReturnValue({
                match: vi.fn().mockResolvedValue({ data: [], error: null }),
                eq: vi.fn().mockReturnThis(),
              }),
            }
          }
          if (table === 'creative_bundle_media') {
            return {
              insert: vi.fn().mockImplementation((mediaRows: any[]) => {
                insertedMedia = mediaRows
                return Promise.resolve({ data: mediaRows, error: null })
              }),
            }
          }
          return {}
        }),
      }

      const store = new SupabaseCreativeBundleStore(mockSupabase as any)
      const input: CreativeBundleInput = {
        workspaceId,
        contentId,
        versionId,
        channel: 'instagram',
        caption: '단호박 타르트 출시',
        hashtags: ['#베이커리'],
        orderedMedia: sampleOrderedMedia,
      }

      const bundle = await store.persistBundle(input)

      expect(bundle).toBeDefined()
      expect(bundle.bundleFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(bundle.approvalStatus).toBe('PENDING')
      expect(insertedBundle).toBeDefined()
      expect(insertedBundle.workspace_id).toBe(workspaceId)
      expect(insertedBundle.bundle_fingerprint).toBe(bundle.bundleFingerprint)
      expect(insertedMedia.length).toBe(2)
      expect(insertedMedia[0].position).toBe(0)
      expect(insertedMedia[0].role).toBe('primary')
      expect(insertedMedia[1].position).toBe(1)
      expect(insertedMedia[1].role).toBe('carousel_item')
    })

    it('restores bundle identity and ordered media correctly on fetch (F5/re-login recovery)', async () => {
      const mockBundleRow = {
        id: 'bundle-uuid-1',
        workspace_id: workspaceId,
        content_id: contentId,
        version_id: versionId,
        channel: 'instagram',
        caption: '단호박 타르트 출시',
        hashtags: ['#베이커리'],
        creative_brief_version: 'v10.0',
        bundle_fingerprint: 'f'.repeat(64),
        approval_status: 'PENDING',
        created_at: '2026-09-09T00:00:00Z',
        updated_at: '2026-09-09T00:00:00Z',
      }

      const mockMediaRows = [
        {
          id: 'cbm-1',
          bundle_id: 'bundle-uuid-1',
          media_asset_id: mediaAssetId1,
          position: 0,
          role: 'primary',
          sha256_digest: sha256_1,
          crop_data: null,
        },
        {
          id: 'cbm-2',
          bundle_id: 'bundle-uuid-1',
          media_asset_id: mediaAssetId2,
          position: 1,
          role: 'carousel_item',
          sha256_digest: sha256_2,
          crop_data: null,
        },
      ]

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'creative_bundles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: mockBundleRow,
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'creative_bundle_media') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: mockMediaRows,
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const store = new SupabaseCreativeBundleStore(mockSupabase as any)
      const bundle = await store.getBundleById(workspaceId, 'bundle-uuid-1')

      expect(bundle).not.toBeNull()
      expect(bundle!.bundleId).toBe('bundle-uuid-1')
      expect(bundle!.orderedMedia.length).toBe(2)
      expect(bundle!.orderedMedia[0].mediaAssetId).toBe(mediaAssetId1)
      expect(bundle!.orderedMedia[0].position).toBe(0)
      expect(bundle!.orderedMedia[1].mediaAssetId).toBe(mediaAssetId2)
      expect(bundle!.orderedMedia[1].position).toBe(1)
    })
  })

  describe('4. Chat Route Production Wiring Verification Gate', () => {
    it('ensures agent/chat route statically wires SupabaseCreativeBundleStore.persistBundle', async () => {
      const { readFileSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const chatRoutePath = resolve(__dirname, '../../src/app/api/workspaces/[workspaceId]/agent/chat/route.ts')
      const content = readFileSync(chatRoutePath, 'utf-8')

      expect(content).toContain('SupabaseCreativeBundleStore')
      expect(content).toContain('persistBundle(')
      expect(content).toContain('bundleFingerprint')
    })
  })
})
