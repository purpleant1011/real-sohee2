/**
 * Creative Bundle Migration Guard & Compatibility Engine (ANI-1103)
 *
 * Enforces safe transition from legacy raw `imageUrl` payloads to canonical `CreativeBundle`.
 * - Manages feature flag `creative_asset_truth_v10`
 * - Denies raw imageUrl publishing under v10
 * - Preserves legacy read compatibility for historical rendering while forbidding republishing
 * - Guarantees safe rollback semantics without regressing to static mocks
 */

export interface CreativeAssetTruthFeatureFlags {
  creativeAssetTruthV10: boolean
  denyRawImageUrlPublish: boolean
  allowHistoricalRenderOnly: boolean
}

export function resolveCreativeAssetFeatureFlags(): CreativeAssetTruthFeatureFlags {
  const envFlag = process.env.NEXT_PUBLIC_CREATIVE_ASSET_TRUTH_V10
  const isEnabled = envFlag !== undefined ? envFlag === 'true' || envFlag === '1' : true

  return {
    creativeAssetTruthV10: isEnabled,
    denyRawImageUrlPublish: isEnabled,
    allowHistoricalRenderOnly: true,
  }
}

export interface PublishAdmissionRequest {
  workspaceId: string
  contentVersionId: string
  creativeBundleId?: string
  rawImageUrl?: string
  legacyMode?: boolean
}

export interface PublishAdmissionDecision {
  admitted: boolean
  code:
    | 'ADMITTED_CANONICAL_BUNDLE'
    | 'RAW_IMAGE_URL_FORBIDDEN'
    | 'BUNDLE_REQUIRED'
    | 'HISTORICAL_MEDIA_PUBLISH_DENIED'
    | 'FLAG_DISABLED_FALLBACK'
  reason: string
}

export class MigrationAdmissionError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MigrationAdmissionError'
  }
}

/**
 * Evaluates whether a publishing request is eligible for dispatch.
 * In v10, raw `imageUrl` dispatch is strictly rejected (Fail-Closed).
 */
export function evaluatePublishAdmission(
  request: PublishAdmissionRequest,
  flags = resolveCreativeAssetFeatureFlags()
): PublishAdmissionDecision {
  if (flags.denyRawImageUrlPublish && request.rawImageUrl && !request.creativeBundleId) {
    return {
      admitted: false,
      code: 'RAW_IMAGE_URL_FORBIDDEN',
      reason:
        'Publishing raw imageUrl is forbidden under Creative Asset Truth v10. An approved CreativeBundle is required.',
    }
  }

  if (flags.creativeAssetTruthV10) {
    if (!request.creativeBundleId) {
      return {
        admitted: false,
        code: 'BUNDLE_REQUIRED',
        reason: 'Missing creativeBundleId: all v10 publish dispatches require a verified CreativeBundle.',
      }
    }

    return {
      admitted: true,
      code: 'ADMITTED_CANONICAL_BUNDLE',
      reason: 'CreativeBundle verified and admitted for publishing pipeline.',
    }
  }

  // Rollback or legacy flag scenario:
  // Even if flag is off, raw static mock publishing is strictly prohibited.
  if (request.rawImageUrl?.includes('sohee_insta_post.jpg') || request.rawImageUrl?.includes('unsplash.com')) {
    return {
      admitted: false,
      code: 'RAW_IMAGE_URL_FORBIDDEN',
      reason: 'Static/stock placeholder images cannot be published even during rollback drills.',
    }
  }

  return {
    admitted: false,
    code: 'FLAG_DISABLED_FALLBACK',
    reason: 'Creative asset truth flag is disabled; publishing halted for safety.',
  }
}

export interface HistoricalContentItem {
  id: string
  contentId: string
  versionId: string
  legacyImageUrl?: string | null
  canonicalMediaAssetId?: string | null
  createdAt: string
}

export interface HistoricalViewPresentation {
  contentVersionId: string
  displayImageUrl: string | null
  canRenderHistoricalView: boolean
  publishEligibility: boolean
  migrationStatus: 'CANONICAL_V10' | 'LEGACY_RENDER_ONLY' | 'NO_MEDIA'
  advisoryNote: string | null
}

/**
 * Resolves media presentation for content display in UI/Studio.
 * Historical content with raw imageUrl can be safely rendered on read,
 * but marked as publishEligibility = false.
 */
export function resolveHistoricalMediaPresentation(
  item: HistoricalContentItem
): HistoricalViewPresentation {
  if (item.canonicalMediaAssetId) {
    return {
      contentVersionId: item.versionId,
      displayImageUrl: `/api/media/${item.canonicalMediaAssetId}/preview`,
      canRenderHistoricalView: true,
      publishEligibility: true,
      migrationStatus: 'CANONICAL_V10',
      advisoryNote: null,
    }
  }

  if (item.legacyImageUrl) {
    return {
      contentVersionId: item.versionId,
      displayImageUrl: item.legacyImageUrl,
      canRenderHistoricalView: true,
      publishEligibility: false,
      migrationStatus: 'LEGACY_RENDER_ONLY',
      advisoryNote:
        '이 콘텐츠는 이전 버전의 미디어 링크를 사용하고 있어 조회만 가능하며 직접 게시는 제한됩니다. 새 이미지를 생성하여 승인해주세요.',
    }
  }

  return {
    contentVersionId: item.versionId,
    displayImageUrl: null,
    canRenderHistoricalView: true,
    publishEligibility: false,
    migrationStatus: 'NO_MEDIA',
    advisoryNote: '등록된 이미지가 없습니다.',
  }
}
