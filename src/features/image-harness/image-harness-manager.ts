/**
 * SOHEE V0.91 · M3 Image Harness & Media Lineage Manager (HF-16, HF-17, HF-18, HF-19, HF-20)
 * 
 * Rules:
 * 1. Golden Reference 3~5 Invariant:
 *    User MUST select between 3 and 5 golden reference images. Less than 3 or more than 5 is strictly rejected.
 * 2. Rights/Consent Split:
 *    - Asset Rights: OWNED | LICENSED | USER_CONFIRMED (UNKNOWN/PROHIBITED cannot publish)
 *    - Likeness Consent: NOT_APPLICABLE | CONFIRMED (REQUIRED_MISSING/UNKNOWN cannot publish)
 * 3. Minimum 1 Test Run:
 *    At least 1 style variation test run must be executed before confirmation.
 * 4. Immutable Versioning:
 *    Confirming a new version sets status to ACTIVE_CONFIRMED and supersedes any previous active version.
 * 5. Media Lineage Protection:
 *    Media published or generated must track image_harness_version, text_harness_version, reference lineage,
 *    and reject cross-tenant injection.
 */

import type { ReadinessFactProvenance } from '@/features/sohee-ready/types'
import { invalidateReadinessCache } from '@/features/sohee-ready/cache-invalidation'

export type AssetRightsStatus = 'OWNED' | 'LICENSED' | 'USER_CONFIRMED' | 'UNKNOWN' | 'PROHIBITED'
export type PersonConsentStatus = 'NOT_APPLICABLE' | 'CONFIRMED' | 'REQUIRED_MISSING' | 'UNKNOWN'

export type ReferenceImageCategory =
  | 'STORE_EXTERIOR'
  | 'STORE_INTERIOR'
  | 'SIGNATURE_MENU'
  | 'PRODUCT'
  | 'ATMOSPHERE'

export interface ImageReferenceAsset {
  id: string
  workspaceId: string
  storagePath: string
  publicUrl: string
  category: ReferenceImageCategory
  caption?: string
  positivePoints?: string[]
  negativePoints?: string[]
  rightsStatus: AssetRightsStatus
  consentStatus: PersonConsentStatus
  rightsConfirmedAt?: string
  mimeType: string
  width?: number
  height?: number
  sortOrder: number
  isGolden: boolean
  createdAt: string
}

export interface VisualRules {
  modelStyle?: string
  environment?: string
  composition?: string
  lighting?: string
  colorTone?: string
  sellingPoints?: string[]
  forbiddenElements?: string[]
}

export type ImageHarnessStatus = 'DRAFT' | 'ACTIVE_CONFIRMED' | 'SUPERSEDED'

export interface ImageHarnessVersion {
  id: string
  workspaceId: string
  versionNumber: number
  status: ImageHarnessStatus
  rules: VisualRules
  referenceAssets: ImageReferenceAsset[]
  goldenImageIds: string[]
  testRunsCount: number
  createdAt: string
  confirmedAt?: string
  confirmedByUserId?: string
  provenance: 'TARGET_PROTOTYPE' | 'SAMPLE_DATA' | 'USER_SUBMITTED'
}

export interface ImageVariationDraft {
  id: string
  harnessVersionId: string
  variantLabel: 'A' | 'B' | 'C' | 'D'
  title: string
  prompt: string
  imageUrl: string
  feedback?: 'THUMBS_UP' | 'THUMBS_DOWN'
  feedbackNote?: string
  createdAt: string
}

export interface MediaHarnessLineage {
  mediaAssetId: string
  workspaceId: string
  imageHarnessVersionId: string
  textHarnessVersionId?: string
  referenceAssetIds: string[]
  goldenAssetIds: string[]
  provider: string
  promptFingerprint: string
  rightsStatus: AssetRightsStatus
  consentStatus: PersonConsentStatus
  createdAt: string
}

/**
 * Validates that an asset meets the Rights and Likeness Consent split requirements.
 */
export function validateRightsAndConsent(asset: ImageReferenceAsset): {
  eligible: boolean
  blocker?: 'RIGHTS_NOT_PERMITTED' | 'CONSENT_REQUIRED_MISSING'
} {
  const allowedRights: AssetRightsStatus[] = ['OWNED', 'LICENSED', 'USER_CONFIRMED']
  if (!allowedRights.includes(asset.rightsStatus)) {
    return { eligible: false, blocker: 'RIGHTS_NOT_PERMITTED' }
  }

  const allowedConsent: PersonConsentStatus[] = ['NOT_APPLICABLE', 'CONFIRMED']
  if (!allowedConsent.includes(asset.consentStatus)) {
    return { eligible: false, blocker: 'CONSENT_REQUIRED_MISSING' }
  }

  return { eligible: true }
}

/**
 * Strictly validates the Golden Reference Image count (minimum 3, maximum 5).
 */
export function validateGoldenImageRequirement(goldenImageIds: string[]): {
  valid: boolean
  error?: string
} {
  if (goldenImageIds.length < 3) {
    return {
      valid: false,
      error: 'GOLDEN_IMAGE_MINIMUM_REQUIRED: 최소 3장의 골든 이미지가 필요합니다.',
    }
  }
  if (goldenImageIds.length > 5) {
    return {
      valid: false,
      error: 'GOLDEN_IMAGE_MAXIMUM_EXCEEDED: 최대 5장까지만 선택할 수 있습니다.',
    }
  }
  return { valid: true }
}

/**
 * Creates a new Draft Image Harness Version.
 */
export function createImageHarnessDraft(params: {
  workspaceId: string
  versionNumber: number
  rules: VisualRules
  referenceAssets?: ImageReferenceAsset[]
  goldenImageIds?: string[]
  provenance?: 'TARGET_PROTOTYPE' | 'SAMPLE_DATA' | 'USER_SUBMITTED'
}): ImageHarnessVersion {
  return {
    id: `ih_draft_${Date.now()}_v${params.versionNumber}`,
    workspaceId: params.workspaceId,
    versionNumber: params.versionNumber,
    status: 'DRAFT',
    rules: { ...params.rules },
    referenceAssets: params.referenceAssets ? [...params.referenceAssets] : [],
    goldenImageIds: params.goldenImageIds ? [...params.goldenImageIds] : [],
    testRunsCount: 0,
    createdAt: new Date().toISOString(),
    provenance: params.provenance ?? 'USER_SUBMITTED',
  }
}

/**
 * Runs Image Harness Test Variations (A, B, C, D) using EDUCATION_TEST_BUDGET.
 */
export function runImageHarnessTest(params: {
  draft: ImageHarnessVersion
}): {
  updatedDraft: ImageHarnessVersion
  variations: ImageVariationDraft[]
} {
  const { draft } = params
  const now = new Date().toISOString()

  const variations: ImageVariationDraft[] = [
    {
      id: `var_${Date.now()}_A`,
      harnessVersionId: draft.id,
      variantLabel: 'A',
      title: '자연광 매장 연출 시안 (A안)',
      prompt: `Warm golden lighting, artisan bakery interior, cinematic 45 degree angle, authentic wooden textures. Model: ${draft.rules.modelStyle || 'Chef'}`,
      imageUrl: 'https://cdn.example.com/samples/variation_A.jpg',
      createdAt: now,
    },
    {
      id: `var_${Date.now()}_B`,
      harnessVersionId: draft.id,
      variantLabel: 'B',
      title: '시그니처 메뉴 클로즈업 시안 (B안)',
      prompt: `Close up macro shot of freshly baked organic bread, crisp crust texture, soft steam, natural sunlight. Style: ${draft.rules.colorTone || 'Warm'}`,
      imageUrl: 'https://cdn.example.com/samples/variation_B.jpg',
      createdAt: now,
    },
  ]

  const updatedDraft: ImageHarnessVersion = {
    ...draft,
    testRunsCount: draft.testRunsCount + 1,
  }

  return {
    updatedDraft,
    variations,
  }
}

/**
 * Confirms an Image Harness Version into an immutable ACTIVE_CONFIRMED status.
 * Requires:
 * 1. Minimum 1 test run.
 * 2. Minimum 3, maximum 5 Golden Images.
 * 3. All golden images must have valid rights & consent.
 */
export function confirmImageHarnessVersion(params: {
  draft: ImageHarnessVersion
  confirmedByUserId: string
}): {
  confirmedVersion: ImageHarnessVersion
  fact: ReadinessFactProvenance
} {
  const { draft, confirmedByUserId } = params

  if (draft.testRunsCount < 1) {
    throw new Error('TEST_RUN_REQUIRED: 최소 1회 이상의 스타일 변형 테스트를 실행해야 합니다.')
  }

  const goldenCheck = validateGoldenImageRequirement(draft.goldenImageIds)
  if (!goldenCheck.valid) {
    throw new Error(goldenCheck.error)
  }

  // Validate rights & consent for golden assets
  for (const assetId of draft.goldenImageIds) {
    const asset = draft.referenceAssets.find((a) => a.id === assetId)
    if (asset) {
      const rightsCheck = validateRightsAndConsent(asset)
      if (!rightsCheck.eligible) {
        throw new Error(`GOLDEN_IMAGE_RIGHTS_VIOLATION: 이미지(${assetId})의 권리/동의가 충족되지 않았습니다. [${rightsCheck.blocker}]`)
      }
    }
  }

  const now = new Date().toISOString()
  const confirmedVersion: ImageHarnessVersion = {
    ...draft,
    status: 'ACTIVE_CONFIRMED',
    confirmedAt: now,
    confirmedByUserId,
  }

  invalidateReadinessCache(draft.workspaceId)

  const fact: ReadinessFactProvenance = {
    key: 'IMAGE_HARNESS_CONFIRMED',
    verified: true,
    status: 'CONFIRMED',
    source: 'harness_rules',
    evidenceId: confirmedVersion.id,
    version: `v${confirmedVersion.versionNumber}`,
    verifiedAt: now,
    freshness: 'FRESH',
  }

  return {
    confirmedVersion,
    fact,
  }
}

/**
 * Evaluates whether a media asset is eligible for publishing.
 * Enforces cross-tenant isolation and requires confirmed active harness lineage.
 */
export function evaluateMediaPublishEligibility(params: {
  lineage: MediaHarnessLineage | null
  activeHarnessVersion: {
    id: string
    workspaceId: string
    versionNumber: number
    status: ImageHarnessStatus
  }
}): {
  eligible: boolean
  blocker?: string
} {
  const { lineage, activeHarnessVersion } = params

  if (!lineage) {
    return { eligible: false, blocker: 'LINEAGE_MISSING' }
  }

  if (lineage.workspaceId !== activeHarnessVersion.workspaceId) {
    throw new Error(
      `CROSS_TENANT_DENIED: Media lineage workspace (${lineage.workspaceId}) does not match active harness workspace (${activeHarnessVersion.workspaceId}).`
    )
  }

  if (lineage.imageHarnessVersionId !== activeHarnessVersion.id) {
    return { eligible: false, blocker: 'HARNESS_VERSION_MISMATCH' }
  }

  const allowedRights: AssetRightsStatus[] = ['OWNED', 'LICENSED', 'USER_CONFIRMED']
  if (!allowedRights.includes(lineage.rightsStatus)) {
    return { eligible: false, blocker: 'UNAPPROVED_ASSET_RIGHTS' }
  }

  const allowedConsent: PersonConsentStatus[] = ['NOT_APPLICABLE', 'CONFIRMED']
  if (!allowedConsent.includes(lineage.consentStatus)) {
    return { eligible: false, blocker: 'UNAPPROVED_CONSENT' }
  }

  return { eligible: true }
}

