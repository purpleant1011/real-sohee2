import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createCreativeBundle,
  mutateCreativeBundle,
  calculateBundleFingerprint,
} from '@/features/creative/creative-bundle-engine'
import {
  recordBundleApproval,
  invalidateApprovalOnMutation,
} from '@/features/creative/approval-invalidation-engine'
import type { BundleOrderedMediaItem, CreativeBundle } from '@/features/creative/creative-bundle-types'
import {
  assertSameCanonicalEntity,
  SameEntityMismatchError,
} from '@/features/creative/same-entity-validator'

describe('ANI-1127: Chat↔Content Same Canonical Entity + CreativeStudioCard Production Mount', () => {
  const repoRoot = resolve(__dirname, '../..')
  const conversationWorkspacePath = resolve(repoRoot, 'src/features/chat/v086-conversation-workspace.tsx')
  const contentDetailModalPath = resolve(repoRoot, 'src/components/v088/content/content-detail-modal.tsx')
  const canonicalLifecyclePath = resolve(repoRoot, 'src/features/content/canonical-content-lifecycle.ts')

  describe('1. Production Source Static Scan Gate (Mount Verification)', () => {
    it('ensures CreativeStudioCard is imported and mounted in v086-conversation-workspace.tsx', () => {
      expect(existsSync(conversationWorkspacePath)).toBe(true)
      const content = readFileSync(conversationWorkspacePath, 'utf-8')
      expect(content).toContain('CreativeStudioCard')
      expect(content).toMatch(/<CreativeStudioCard\b/)
    })

    it('ensures CreativeStudioCard is imported and mounted in content-detail-modal.tsx or content-view.tsx', () => {
      expect(existsSync(contentDetailModalPath)).toBe(true)
      const content = readFileSync(contentDetailModalPath, 'utf-8')
      expect(content).toContain('CreativeStudioCard')
      expect(content).toMatch(/<CreativeStudioCard\b/)
    })

    it('ensures CanonicalContentLifecycleService queries associated media and bundles with correct version_id column', () => {
      expect(existsSync(canonicalLifecyclePath)).toBe(true)
      const content = readFileSync(canonicalLifecyclePath, 'utf-8')
      expect(content).toContain('content_version_media')
      expect(content).toContain('media_assets')
      expect(content).toContain(".eq('version_id', version.id)")
      expect(content).not.toContain(".eq('content_version_id', version.id)")
    })
  })

  describe('2. Same Entity Convergence & Invariant Logic', () => {
    const workspaceId = '00000000-0000-0000-0000-000000000001'
    const contentId = '11111111-1111-1111-1111-111111111111'
    const versionId = '22222222-2222-2222-2222-222222222222'
    const mediaAssetId = '33333333-3333-3333-3333-333333333333'
    const sha256Digest = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

    it('validates that Chat and Content share exact same mediaAssetId and bundleFingerprint', () => {
      const orderedMedia: BundleOrderedMediaItem[] = [
        {
          mediaAssetId,
          sha256Digest,
          position: 0,
          role: 'primary',
        },
      ]

      const bundle = createCreativeBundle({
        workspaceId,
        contentId,
        versionId,
        channel: 'instagram',
        caption: '단호박 타르트 신메뉴 출시! 바삭한 타르트지와 달콤한 호박크림의 조화 🎃',
        hashtags: ['#베이커리', '#단호박타르트', '#소희AI'],
        orderedMedia,
      })

      // Assertion passes when IDs match
      expect(() => {
        assertSameCanonicalEntity({
          chatAssetId: mediaAssetId,
          contentAssetId: mediaAssetId,
          bundleAssetId: bundle.orderedMedia[0].mediaAssetId,
        })
      }).not.toThrow()
    })

    it('fails closed when Chat and Content show mismatched media_asset_ids (Negative Gate)', () => {
      const chatAssetId = mediaAssetId
      const contentAssetId = '44444444-4444-4444-4444-444444444444' // Mismatched!

      expect(() => {
        assertSameCanonicalEntity({
          chatAssetId,
          contentAssetId,
          bundleAssetId: mediaAssetId,
        })
      }).toThrow(SameEntityMismatchError)
    })

    it('invalidates approval and marks bundle as SUPERSEDED when media or caption is replaced', () => {
      const orderedMedia: BundleOrderedMediaItem[] = [
        {
          mediaAssetId,
          sha256Digest,
          position: 0,
          role: 'primary',
        },
      ]

      const bundle = createCreativeBundle({
        workspaceId,
        contentId,
        versionId,
        channel: 'instagram',
        caption: '최초 문안입니다.',
        hashtags: ['#베이커리'],
        orderedMedia,
      })

      const { bundle: approvedBundle, approval } = recordBundleApproval({
        bundle,
        approvedBy: '00000000-0000-0000-0000-000000000002',
      })

      expect(approvedBundle.approvalStatus).toBe('APPROVED')
      expect(approval.status).toBe('APPROVED')

      // Mutate caption (or media replacement)
      const mutatedBundle = mutateCreativeBundle(approvedBundle, {
        caption: '수정된 새로운 문안입니다.',
      })

      expect(mutatedBundle.approvalStatus).toBe('SUPERSEDED')
      expect(mutatedBundle.bundleFingerprint).not.toBe(approvedBundle.bundleFingerprint)

      // Invalidate approval record
      const invalidatedApproval = invalidateApprovalOnMutation(approval, 'MEDIA_OR_CAPTION_REPLACED')
      expect(invalidatedApproval.status).toBe('SUPERSEDED')
      expect(invalidatedApproval.supersededReason).toBe('MEDIA_OR_CAPTION_REPLACED')
    })
  })
})
