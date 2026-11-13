/**
 * SOHEE Harness Knowledge OS — Domain Types (v1.1)
 * Governed by ONE SOURCE LINK = ONE ATOMIC HARNESS invariant
 */

export type HarnessAssetType = 'ATOMIC_SOURCE' | 'MANUAL_PRIVATE' | 'DERIVED_PRIVATE' | 'COMPOSITE_PRIVATE'
export type SourceType = 'PROFILE' | 'POST' | 'THREAD' | 'BLOG_ARTICLE' | 'FEED' | 'MANUAL'
export type PlatformType = 'instagram' | 'threads' | 'naver_blog' | 'generic'
export type HarnessStatus = 'DRAFT' | 'ANALYZING' | 'PARTIAL' | 'READY' | 'STALE' | 'ARCHIVED' | 'FAILED'
export type ModuleStatus = 'READY' | 'PARTIAL' | 'UNAVAILABLE' | 'STALE'
export type EvidenceState = 'OBSERVED' | 'INFERRED' | 'RECOMMENDED_DEFAULT' | 'USER_OVERRIDE' | 'PERFORMANCE_LEARNED'
export type AcquisitionMethod = 'OFFICIAL_API' | 'OFFICIAL_PUBLIC_DISCOVERY' | 'USER_CONNECTED_ACCOUNT' | 'USER_SUPPLIED_EXPORT' | 'USER_SUPPLIED_SCREENSHOT' | 'BROWSER_AUTOMATION' | 'SEARCH_INDEX_ONLY' | 'UNAVAILABLE'
export type AutonomyMode = 'FULL_AUTONOMOUS' | 'SEMI_AUTONOMOUS' | 'APPROVAL_REQUIRED' | 'MANUAL_ONLY'

/**
 * 1. HarnessAsset — 테넌트(Workspace) 소유의 버전형 실행 설계 자산
 */
export interface HarnessAsset {
  id: string
  workspaceId: string
  assetType: HarnessAssetType
  sourceEntityId?: string
  title: string
  visibility: 'PRIVATE' | 'SYSTEM_SEED_REFERENCE'
  overallStatus: HarnessStatus
  activeVersionId: string
  activeVersionNo: number
  platform: PlatformType
  sourceUrl: string
  sourceHandle?: string
  coreDna: string[]
  moduleReadiness: {
    text: ModuleStatus
    visual: ModuleStatus
    operations: ModuleStatus
    community: ModuleStatus
    platform: ModuleStatus
  }
  dailyEstimatedSc: number
  totalSpentSc: number
  lastAnalyzedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * 2. Source Entity — 안정적 원천 식별자 (Handle 변경/Redirect 추적)
 */
export interface HarnessSourceEntity {
  id: string
  workspaceId: string
  platform: PlatformType
  sourceType: SourceType
  sourceEntityKey: string
  platformNativeEntityId?: string
  canonicalUrlCurrent: string
  sourceUrlAliases: string[]
  sourceHandleCurrent: string
  sourceHandleHistory: string[]
  resolvedAt: string
}

/**
 * 3. TextHarness — 문체, 훅, 전개, CTA 등 텍스트 운영 규칙
 */
export interface TextHarness {
  contentPillars: string[]
  hookPatterns: string[]
  captionArchetypes: string[]
  paragraphRhythm: string
  sentenceLengthProfile: string
  toneVector: {
    professional: number // 0 ~ 1
    empathy: number
    directness: number
    urgency: number
  }
  authorityPatterns: string[]
  proofPatterns: string[]
  problemSolutionGrammar: string
  ctaPatterns: string[]
  forbiddenCliches: string[]
}

/**
 * 4. VisualHarness — 피사체, 구도, 조명, 색감 등 시각 문법
 */
export interface VisualHarness {
  subjectTypes: string[]
  sceneTypes: string[]
  framing: string[]
  cameraAngles: string[]
  lightingProfile: string
  paletteProfile: string[]
  backgroundProfile: string
  textureRealism: string
  beforeAfterLayout: string
  feedRhythm: string
  imagePromptTemplate: string
  negativePromptRules: string[]
}

/**
 * 5. OperationsHarness — 콘텐츠 믹스 및 프로모션 운영 리듬
 */
export interface OperationsHarness {
  contentMixRatios: {
    expertDiagnosis: number // e.g. 30%
    beforeAfterProof: number // e.g. 25%
    customerReview: number // e.g. 15%
    promotionEvent: number // e.g. 15%
    behindDaily: number // e.g. 15%
  }
  funnelStageMix: {
    awareness: number
    consideration: number
    decision: number
    retention: number
  }
  trustBuildingSequence: string
  promoRhythm: string
  socialProofPattern: string
}

/**
 * 6. CommunityReplyHarness — 댓글/문의 응대 및 예약 전환 규칙
 */
export interface CommunityReplyHarness {
  questionTaxonomy: string[]
  replyTone: string
  publicVsDmRule: string
  bookingTransition: string
  priceQuestionRule: string
  availabilityRule: string
  riskyClaimGuardrails: string[]
}

/**
 * 7. PlatformHarness — 플랫폼별 제약 및 최적화 전략
 */
export interface PlatformHarness {
  sourcePlatform: PlatformType
  compatibleTargets: PlatformType[]
  formatConstraints: string
  hashtagStrategy: string
  linkStrategy: string
  carouselStrategy?: string
  blogHeadingStrategy?: string
}

/**
 * 8. HarnessVersion — Immutable 스냅샷 버전
 */
export interface HarnessVersion {
  id: string
  harnessAssetId: string
  versionNo: number
  schemaVersion: string
  compilerVersion: string
  analyzerVersion?: string
  textJson: TextHarness
  visualJson: VisualHarness
  operationsJson: OperationsHarness
  communityJson: CommunityReplyHarness
  platformJson: PlatformHarness
  evidenceScore: number // 0 ~ 100
  confidence: number // 0 ~ 100
  immutable: boolean
  createdAt: string
}

/**
 * 9. HarnessRule — 5대 Evidence State가 부여된 개별 실행 규칙
 */
export interface HarnessRule {
  id: string
  harnessVersionId: string
  module: 'text' | 'visual' | 'operations' | 'community' | 'platform'
  ruleKey: string
  ruleTitle: string
  ruleValue: string | string[] | Record<string, unknown>
  evidenceState: EvidenceState
  supportingSampleCount: number
  contradictorySampleCount: number
  confidence: number
  confidenceBasis: string
  evidenceRefs?: string[]
}

/**
 * 10. HarnessChannelAssignment — 채널별 하네스 적용
 */
export interface HarnessChannelAssignment {
  id: string
  workspaceId: string
  channelId?: string
  channelName?: string
  channelPlatform?: PlatformType
  channelConnectionId?: string
  harnessAssetId: string
  assignmentMode: 'FOLLOW_ACTIVE' | 'PINNED_VERSION'
  pinnedVersionId?: string
  desiredAutonomyMode: 'FULL_AUTONOMOUS' | 'SEMI_AUTONOMOUS' | 'REQUIRE_APPROVAL'
  actualAutonomyMode: 'FULL_AUTONOMOUS' | 'SEMI_AUTONOMOUS' | 'REQUIRE_APPROVAL'
  enabled: boolean
  assignedAt: string
}

export interface BrandKnowledgeSnapshot {
  id: string
  workspaceId: string
  businessName: string
  industry: string
  verifiedPriceList: Record<string, number>
  address: string
  bookingUrl: string
  operatingHours: string
  phone: string
  snapshotHash: string
  createdAt: string
}

export interface EvaluationScores {
  brandAccuracy: number // 0 ~ 100
  harnessFit: number // 0 ~ 100
  originalityScore: number // 0 ~ 100
  platformFit: number // 0 ~ 100
  safetyScore: number // 0 ~ 100
}

export interface CalibratedEvaluationResult {
  passed: boolean
  scores: EvaluationScores
  overallScore: number
  reasons: string[]
}

export interface GenerationProvenance {
  id: string
  harnessAssetId: string
  harnessVersionId: string
  brandKnowledgeSnapshotId: string
  userOverrideVersionId?: string
  promptHash: string
  compilerVersion: string
  evaluationScores: EvaluationScores
  evaluatorPassed: boolean
  createdAt: string
}

/**
 * 11. HarnessOverride — 사용자 커스텀 오버라이드
 */
export interface HarnessOverride {
  id: string
  harnessAssetId: string
  workspaceId: string
  module: 'text' | 'visual' | 'operations' | 'community' | 'platform'
  ruleKey: string
  overrideValue: string
  reason: string
  createdAt: string
}
