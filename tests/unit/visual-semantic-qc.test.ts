import { describe, it, expect } from 'vitest'
import { evaluateVisualSemanticQC } from '@/features/creative/visual-semantic-qc'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'
import type { MediaAsset } from '@/features/media/media-asset-types'

describe('ANI-1078: Visual Semantic QC Gate (Tart vs Salon check)', () => {
  const brief = buildVisualBrief({
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    contentVersionId: 'cv-qc-01',
    businessContext: {
      name: '소희네 베이커리',
      industry: 'bakery',
      keywords: ['타르트'],
      targetAudience: '디저트 애호가',
    },
    productContext: {
      name: '단호박 타르트',
      sellingPoints: ['은은한 단맛'],
    },
    channel: 'instagram',
    caption: '가을 신메뉴 단호박 타르트가 출시되었습니다!',
  })

  const validAsset: MediaAsset = {
    id: 'asset-tart-01',
    workspace_id: brief.workspaceId,
    bucket_id: 'content-media',
    object_path: `workspaces/${brief.workspaceId}/media/source/asset-tart-01/original.png`,
    kind: 'content',
    source_type: 'GENERATED_OPENAI',
    mime_type: 'image/png',
    size_bytes: 1_200_000,
    width: 1024,
    height: 1024,
    sha256_digest: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
    rights_status: 'approved',
    lifecycle_status: 'READY',
    publish_eligibility: true,
    generation_metadata: {
      model: 'gpt-image-2',
      promptDigest: brief.promptDigest,
    },
    created_by: 'system',
    created_at: new Date().toISOString(),
  }

  it('passes QC for matching caption, visual brief, and valid generated asset', () => {
    const result = evaluateVisualSemanticQC({
      caption: '가을 신메뉴 단호박 타르트가 출시되었습니다!',
      visualBrief: brief,
      mediaAsset: validAsset,
    })
    expect(result.decision).toBe('PASS')
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('fails QC with DOMAIN_INCONGRUENCE_DETECTED when salon/beauty media is linked to bakery post', () => {
    const incongruentAsset: MediaAsset = {
      ...validAsset,
      object_path: `workspaces/${brief.workspaceId}/media/source/asset-tart-01/hair_salon_view.png`,
      generation_metadata: {
        model: 'gpt-image-2',
        promptDigest: 'some-hash',
        description: 'Beauty salon interior with hair dryer',
      },
    }

    const result = evaluateVisualSemanticQC({
      caption: '가을 신메뉴 단호박 타르트가 출시되었습니다!',
      visualBrief: brief,
      mediaAsset: incongruentAsset,
    })

    expect(result.decision).toBe('FAIL')
    expect(result.passed).toBe(false)
    expect(result.violations).toContain('DOMAIN_INCONGRUENCE_DETECTED')
  })

  it('fails QC when legacy static unverified asset is supplied', () => {
    const legacyAsset: MediaAsset = {
      ...validAsset,
      source_type: 'LEGACY_STATIC',
    }

    const result = evaluateVisualSemanticQC({
      caption: '가을 신메뉴 단호박 타르트가 출시되었습니다!',
      visualBrief: brief,
      mediaAsset: legacyAsset,
    })

    expect(result.decision).toBe('FAIL')
    expect(result.violations).toContain('LEGACY_ASSET_DISALLOWED_FOR_NEW_PUBLISH')
  })

  it('fails QC when caption product conflicts with media hero product', () => {
    const result = evaluateVisualSemanticQC({
      caption: '오늘 구운 바삭하고 달콤한 마카롱 세트입니다!', // Mentions 마카롱
      visualBrief: brief, // Product is 단호박 타르트
      mediaAsset: validAsset,
    })

    expect(result.decision).toBe('FAIL')
    expect(result.violations).toContain('CAPTION_PRODUCT_DISCREPANCY')
  })

  it('fails QC for comprehensive hard negatives: eyebrow, aesthetic clinic, stock watermark (ANI-1101)', () => {
    const hardNegatives = [
      { marker: 'eyebrow microblading salon studio', desc: '자연눈썹 반영구 뷰티샵 시술실' },
      { marker: 'dermatology clinic botox care', desc: '피부과 클리닉 레이저 룸' },
      { marker: 'stock watermark shutterstock getty preview', desc: '워터마크 스톡 사진' },
    ]

    for (const neg of hardNegatives) {
      const negAsset: MediaAsset = {
        ...validAsset,
        object_path: `workspaces/${brief.workspaceId}/media/source/${neg.marker.replace(/\s+/g, '_')}.png`,
        generation_metadata: {
          model: 'gpt-image-2',
          promptDigest: 'some-hash',
          description: neg.desc,
        },
      }

      const result = evaluateVisualSemanticQC({
        caption: '가을 신메뉴 단호박 타르트가 출시되었습니다!',
        visualBrief: brief,
        mediaAsset: negAsset,
      })

      expect(result.decision).toBe('FAIL')
      expect(result.passed).toBe(false)
    }
  })
})
