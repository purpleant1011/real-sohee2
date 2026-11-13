import { describe, it, expect } from 'vitest'
import {
  evaluateP0Invariants,
  type SystemTelemetrySnapshot,
  ALL_P0_INVARIANT_CODES,
} from '@/lib/admin-ops/p0-invariant-monitor'

/**
 * Wave 0 — False-Green Reconciliation & Release Truth
 * ANI-1060: [Forensic] 잘못 게시된 9차 Production 2건의 Caption↔Media lineage 증거 고정
 * ANI-1068: [10차/P0] 9차 PASS 재분류 및 Creative Asset Release Gate 정본화
 * ANI-1069: target workspace regression fixture
 */
describe('Wave 0: Creative Asset Truth & 9th False-Green Reconciliation (ANI-1060, ANI-1068)', () => {
  const TARGET_WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2'

  // 9차에서 잘못 성공 처리되었던 실제 Instagram 게시 건 2개 (Forensic evidence)
  const FORENSIC_CASES = [
    {
      postId: 'DdAcEv8mT2N',
      channel: 'instagram',
      caption: '달빛제과가 준비한 가을 시즌 신메뉴, 단호박 타르트가 여러분을 기다립니다. 부드러운 단호박 필링과 바삭한 타르트의 조화가 입안 가득 가을의 풍미를 선사합니다.',
      payloadImageUrl: 'https://example.com/sohee_insta_post.jpg',
      workspaceId: TARGET_WORKSPACE_ID,
      actualMediaCount: 0,
      actualBindingCount: 0,
    },
    {
      postId: 'DdAhgHcnQMN',
      channel: 'instagram',
      caption: '지리산에서 직접 공수한 신선한 생무화과를 듬뿍 올린 타르트를 소개합니다. 바삭한 타르트지와 달콤한 무화과의 조화로움은 한 입 베어 물 때마다 행복을 선사합니다.',
      payloadImageUrl: 'https://example.com/sohee_insta_post.jpg',
      workspaceId: TARGET_WORKSPACE_ID,
      actualMediaCount: 0,
      actualBindingCount: 0,
    },
  ]

  it('defines 10th creative invariant codes in ALL_P0_INVARIANT_CODES', () => {
    // 10차에서 필수적인 creative invariants가 포함되어야 함
    expect(ALL_P0_INVARIANT_CODES).toContain('STATIC_OR_STOCK_MEDIA_IN_PRODUCTION')
    expect(ALL_P0_INVARIANT_CODES).toContain('MEDIA_ASSET_LINEAGE_MISSING')
    expect(ALL_P0_INVARIANT_CODES).toContain('CREATIVE_BUNDLE_NOT_APPROVED')
    expect(ALL_P0_INVARIANT_CODES).toContain('PROVIDER_VISUAL_MISMATCH')
    expect(ALL_P0_INVARIANT_CODES).toContain('SUPABASE_SECURITY_ADVISOR_ERROR')
    expect(ALL_P0_INVARIANT_CODES).toContain('META_PUBLIC_NOT_READY_MISREPRESENTED')
  })

  it('REJECTS 9th false-green state: media_assets = 0 but successful publish exists (ANI-1060, ANI-1068)', () => {
    const falseGreenSnapshot: SystemTelemetrySnapshot = {
      edgeAgentInterceptActive: false,
      conversationThreadsCount: 2,
      durableMessagesCount: 10,
      workspaceContextMatch: true,
      exposedToolNames: ['business_brand_read', 'marketing_work_create'],
      contentItemsCount: 2,
      contentVersionsCount: 2,
      unpersistedApprovalCount: 0,
      unledgeredActionCount: 0,
      agedUnknownResultCount: 0,
      webhookProviderEventsCount: 5,
      webhookStatus: 'HEALTHY',
      anonSecurityDefinerExecutables: [],
      releaseIdentityMatches: true,

      // 10차 Creative Invariant fields
      publishedWithCanonicalMediaOnly: false, // 9차는 sohee_insta_post.jpg 정적 URL을 사용했음
      mediaAssetsCount: 0, // 당시 target workspace는 0건
      contentVersionMediaCount: 0, // 바인딩도 0건
      staticOrStockPublishAttempts: 2, // 2건의 잘못된 static publish
      unapprovedCreativeBundlePublishes: 2,
      providerVisualMismatches: 2, // 타르트 캡션 vs salon 이미지 불일치
      securityAdvisorErrorsCount: 2, // public.agent_runs 등 2건 ERROR
      metaPublicReadinessAccurate: true,
    }

    const result = evaluateP0Invariants(falseGreenSnapshot)
    expect(result.allClear).toBe(false)
    expect(result.hasP0Violation).toBe(true)

    const codes = result.violations.map((v) => v.code)
    expect(codes).toContain('STATIC_OR_STOCK_MEDIA_IN_PRODUCTION')
    expect(codes).toContain('MEDIA_ASSET_LINEAGE_MISSING')
    expect(codes).toContain('PROVIDER_VISUAL_MISMATCH')
    expect(codes).toContain('SUPABASE_SECURITY_ADVISOR_ERROR')
  })

  it('REJECTS any Unsplash or static image URL in production payload', () => {
    const unsplashSnapshot: SystemTelemetrySnapshot = {
      edgeAgentInterceptActive: false,
      conversationThreadsCount: 1,
      durableMessagesCount: 5,
      workspaceContextMatch: true,
      exposedToolNames: ['business_brand_read'],
      contentItemsCount: 1,
      contentVersionsCount: 1,
      unpersistedApprovalCount: 0,
      unledgeredActionCount: 0,
      agedUnknownResultCount: 0,
      webhookProviderEventsCount: 1,
      webhookStatus: 'HEALTHY',
      anonSecurityDefinerExecutables: [],
      releaseIdentityMatches: true,

      publishedWithCanonicalMediaOnly: false,
      mediaAssetsCount: 1,
      contentVersionMediaCount: 1,
      staticOrStockPublishAttempts: 1, // Unsplash image detected
      unapprovedCreativeBundlePublishes: 0,
      providerVisualMismatches: 0,
      securityAdvisorErrorsCount: 0,
      metaPublicReadinessAccurate: true,
    }

    const result = evaluateP0Invariants(unsplashSnapshot)
    expect(result.allClear).toBe(false)
    const codes = result.violations.map((v) => v.code)
    expect(codes).toContain('STATIC_OR_STOCK_MEDIA_IN_PRODUCTION')
  })

  it('REJECTS when Meta app review is incomplete but claimed as public ready', () => {
    const metaMisrepSnapshot: SystemTelemetrySnapshot = {
      edgeAgentInterceptActive: false,
      conversationThreadsCount: 1,
      durableMessagesCount: 5,
      workspaceContextMatch: true,
      exposedToolNames: ['business_brand_read'],
      contentItemsCount: 1,
      contentVersionsCount: 1,
      unpersistedApprovalCount: 0,
      unledgeredActionCount: 0,
      agedUnknownResultCount: 0,
      webhookProviderEventsCount: 1,
      webhookStatus: 'HEALTHY',
      anonSecurityDefinerExecutables: [],
      releaseIdentityMatches: true,

      publishedWithCanonicalMediaOnly: true,
      mediaAssetsCount: 2,
      contentVersionMediaCount: 2,
      staticOrStockPublishAttempts: 0,
      unapprovedCreativeBundlePublishes: 0,
      providerVisualMismatches: 0,
      securityAdvisorErrorsCount: 0,
      metaPublicReadinessAccurate: false, // Meta 미승인 상태인데 PUBLIC_READY로 거짓 표기!
    }

    const result = evaluateP0Invariants(metaMisrepSnapshot)
    expect(result.allClear).toBe(false)
    const codes = result.violations.map((v) => v.code)
    expect(codes).toContain('META_PUBLIC_NOT_READY_MISREPRESENTED')
  })
})
