import { describe, it, expect } from 'vitest'
import {
  evaluateP0Invariants,
  type SystemTelemetrySnapshot,
} from '@/lib/admin-ops/p0-invariant-monitor'

/**
 * Wave 0 — Integration Regression Fixtures
 * ANI-1060: Caption↔Media Lineage Forensic Evidence Integration
 * ANI-1068: Creative Asset Release Gate Invariant
 */
describe('Wave 0 Integration: Creative Asset Lineage & Release Gate Regression (ANI-1060, ANI-1068)', () => {
  const TARGET_WORKSPACE_ID = '00000000-0000-4000-8000-0000000000a2'

  describe('Forensic Lineage Replay: Tart Caption + Salon/Static Image', () => {
    it('enforces fail-closed gate when publish attempt lacks canonical MediaAsset row', () => {
      // 9차에서 성공 처리되었던 비정상 상태를 시뮬레이션
      const simulatedPipelineRun = {
        workspaceId: TARGET_WORKSPACE_ID,
        contentVersion: {
          id: 'v-001',
          caption: '달빛제과 단호박 타르트 신메뉴',
          hashtags: ['#단호박타르트', '#달빛제과'],
        },
        // MediaAsset 엔티티가 전혀 없음 (9차 실측: media_assets = 0)
        mediaAssetId: null,
        // ContentVersionMedia 바인딩도 없음 (9차 실측: content_version_media = 0)
        hasMediaBinding: false,
        // 그러나 외부 페이로드에는 정적 이미지가 할당됨
        externalPayload: {
          caption: '달빛제과 단호박 타르트 신메뉴',
          imageUrl: 'https://example.com/sohee_insta_post.jpg',
        },
        // Provider는 200 OK를 반환하고 permalink도 생성됨
        providerResponse: {
          status: 200,
          externalPostId: 'DdAcEv8mT2N',
          permalink: 'https://instagram.com/p/DdAcEv8mT2N/',
        },
      }

      // 시스템 텔레메트리 스냅샷 생성
      const telemetry: SystemTelemetrySnapshot = {
        edgeAgentInterceptActive: false,
        conversationThreadsCount: 1,
        durableMessagesCount: 10,
        workspaceContextMatch: true,
        exposedToolNames: ['business_brand_read'],
        contentItemsCount: 1,
        contentVersionsCount: 1,
        unpersistedApprovalCount: 0,
        unledgeredActionCount: 0,
        agedUnknownResultCount: 0,
        webhookProviderEventsCount: 5,
        webhookStatus: 'HEALTHY',
        anonSecurityDefinerExecutables: [],
        releaseIdentityMatches: true,

        // Invariants 평가
        publishedWithCanonicalMediaOnly: simulatedPipelineRun.mediaAssetId !== null,
        mediaAssetsCount: simulatedPipelineRun.mediaAssetId ? 1 : 0,
        contentVersionMediaCount: simulatedPipelineRun.hasMediaBinding ? 1 : 0,
        staticOrStockPublishAttempts: simulatedPipelineRun.externalPayload.imageUrl.includes('sohee_insta_post') ? 1 : 0,
        unapprovedCreativeBundlePublishes: 1,
        providerVisualMismatches: 1,
        securityAdvisorErrorsCount: 0,
        metaPublicReadinessAccurate: true,
      }

      const verdict = evaluateP0Invariants(telemetry)

      // 이 게시물이 성공으로 처리되더라도, 릴리스 게이트는 반드시 실패해야 함!
      expect(verdict.allClear).toBe(false)
      expect(verdict.hasP0Violation).toBe(true)
      
      const violatedCodes = verdict.violations.map((v) => v.code)
      expect(violatedCodes).toContain('MEDIA_ASSET_LINEAGE_MISSING')
      expect(violatedCodes).toContain('STATIC_OR_STOCK_MEDIA_IN_PRODUCTION')
      expect(violatedCodes).toContain('PROVIDER_VISUAL_MISMATCH')
    })
  })
})
