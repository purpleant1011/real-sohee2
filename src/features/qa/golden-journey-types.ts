/**
 * Sohee 11th Revision · Wave 7 Production Ground Truth
 * Golden Journey Domain Types & Evidence Specification
 */

import type { TargetChannel } from '@/features/creative/creative-bundle-types'
export type { TargetChannel }

export type GoldenJourneyExecutionMode = 'SIMULATION' | 'PRODUCTION_VERIFIED'

export type GoldenJourneyScenario = 
  | 'JOURNEY_A_SWEET_PUMPKIN_TART'
  | 'JOURNEY_B_FRESH_FIG_TART'
  | 'JOURNEY_BAIREUM_FALL_TART'

export type GoldenJourneyStepId =
  | 'STEP_01_USER_PROMPT_THREAD'
  | 'STEP_02_CANONICAL_CONTENT_VERSION'
  | 'STEP_03_VISUAL_BRIEF'
  | 'STEP_04_GPT_IMAGE_2_GENERATION'
  | 'STEP_05_MEDIA_ASSET_STORAGE'
  | 'STEP_06_CREATIVE_QC_AND_RIGHTS'
  | 'STEP_07_CREATIVE_BUNDLE_ASSEMBLY'
  | 'STEP_08_EXACT_USER_APPROVAL'
  | 'STEP_09_PUBLISH_RENDITION'
  | 'STEP_10_PROVIDER_DELIVERY_LEASE'
  | 'STEP_11_META_PUBLISH_EXECUTION'
  | 'STEP_12_OBSERVED_READBACK_VERIFIED'
  | 'STEP_13_POST_PUBLISH_F5_RESTORATION'

export interface GoldenJourneyStepResult {
  stepId: GoldenJourneyStepId
  stepIndex: number
  name: string
  status: 'PASSED' | 'FAILED'
  details: string
  evidenceDigest?: string
  timestamp: string
}

export interface GoldenJourneyProofChain {
  workspaceId: string
  threadId: string
  contentId: string
  versionId: string
  briefId: string
  mediaAssetId: string
  mediaSha256: string
  mediaStoragePath: string
  creativeBundleId: string
  bundleFingerprint: string
  approvalFingerprint: string
  approvedAt: string
  renditionId: string
  renditionSha256: string
  deliveryLeaseId: string
  deliveryLeaseUrl: string
  providerPostId: string
  permalink: string
  channel: TargetChannel
  captionDigest: string
  perceptualSimilarity: number
  receiptId: string
  receiptState: 'VERIFIED'
  restoredReceiptState: 'VERIFIED'
  restoredBundleFingerprint: string
}

export interface GoldenJourneyReport {
  scenario: GoldenJourneyScenario
  title: string
  executedAt: string
  passed: boolean
  steps: GoldenJourneyStepResult[]
  proofChain: GoldenJourneyProofChain
  antiFalseGreenAudit: {
    zeroMockFixtures: boolean
    zeroUnsplashOrExternalStaticUrls: boolean
    genuineSha256Calculated: boolean
    exactApprovalOptimisticLockEnforced: boolean
    readbackPerceptuallyVerified: boolean
    f5RestorationByteIdentical: boolean
  }
}
