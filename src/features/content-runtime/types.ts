/**
 * 콘텐츠 런타임 & 퍼블리싱 캘린더 SSOT 타입 정의
 * 
 * ANI-827: Calendar Date Integrity (32~34일 원천 차단, 윤년 무결성)
 * ANI-828: Publishing Queue ↔ Calendar 정본 스케줄 모델
 * ANI-830: Content CTA Preconditions (하네스 + 채널 + 크레딧 3대 게이트)
 * ANI-831: Harness Source Provenance & Rights (룩북 출처 증거화)
 * ANI-832: Content Generation ActionRun 계보
 * ANI-834: Channel-native Content Preview & 제약 검증
 * ANI-837: Calendar Unified Event Model (월/주/일 동일 event_id)
 * ANI-872: [Admin] Publishing Queue Same Truth
 * ANI-873: [Admin] Publishing Exception Queue
 * ANI-885: [Admin] Generated Asset Provenance Drill-down
 */

export type PublishingChannel =
  | 'INSTAGRAM_FEED'
  | 'INSTAGRAM_STORY'
  | 'NAVER_BLOG'
  | 'CARROT_FEED'
  | 'THREADS';

export type PublishingJobStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'QUEUED'
  | 'DISPATCHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * ANI-831: 룩북 및 외부 소스 출처 및 권리 증거
 */
export interface HarnessSourceProvenance {
  sourceId: string;
  sourceType: 'SCRAPED_LOOKBOOK' | 'BRAND_ASSET_VAULT' | 'USER_UPLOAD';
  sourceAccount?: string; // 예: @beauty_salon_kr
  sourceUrl?: string;
  fetchedAt: string;
  rightsScope: 'COMMERCIAL_USE_ALLOWED' | 'EDITORIAL_REFERENCE_ONLY' | 'OWNER_COPYRIGHT';
  licenseDigest: string; // SHA-256
  isRightsCleared: boolean;
}

/**
 * 생성 에셋 상세 메타데이터
 */
export interface GeneratedContentAsset {
  assetId: string;
  actionRunId: string;
  channel: PublishingChannel;
  title?: string;
  body: string;
  mediaUrls: string[];
  aspectRatio?: '1:1' | '4:5' | '9:16' | '16:9';
  hashtags: string[];
  provenance: HarnessSourceProvenance;
  qcScore: number; // 0 ~ 100
  qcChecklist: {
    bannedWordsPassed: boolean;
    channelConstraintsPassed: boolean;
    voiceConsistencyPassed: boolean;
  };
  createdAt: string;
}

/**
 * ANI-828, ANI-837, ANI-872: 정본 캘린더 이벤트 및 발행 큐 작업 모델
 */
export interface CanonicalPublicationSchedule {
  calendarEventId: string; // 월/주/일 뷰 공통 event_id (ANI-837)
  jobId: string; // Queue 및 Admin 동일 job_id (ANI-872)
  workspaceId: string;
  assetId: string;
  channel: PublishingChannel;
  title: string;
  scheduledAt: string; // ISO 8601
  status: PublishingJobStatus;
  statusDetail?: string;
  retryCount: number;
  maxRetries: number;
  publishedUrl?: string;
  externalPostId?: string;
  errorMessage?: string;
  updatedAt: string;
}

/**
 * ANI-834: 채널별 네이티브 제약조건
 */
export interface ChannelNativeConstraints {
  channel: PublishingChannel;
  maxBodyLength: number;
  minBodyLength: number;
  allowedAspectRatios: string[];
  maxMediaCount: number;
  minMediaCount: number;
  requiresTitle: boolean;
  maxHashtags: number;
}

/**
 * ANI-873: [Admin] 발행 예외 격리 큐 항목
 */
export interface PublishingExceptionItem {
  exceptionId: string;
  jobId: string;
  calendarEventId: string;
  workspaceId: string;
  channel: PublishingChannel;
  errorCategory: 'TOKEN_EXPIRED' | 'CHANNEL_REJECTED' | 'NETWORK_TIMEOUT' | 'RATE_LIMITED' | 'SCHEMA_INVALID';
  errorMessage: string;
  failedAt: string;
  quarantinedAt: string;
  resolutionStatus: 'UNRESOLVED' | 'RESOLVED_RETRY' | 'RESOLVED_CANCELLED' | 'REFUNDED';
  resolvedBy?: string;
  resolvedAt?: string;
}

/**
 * ANI-885: [Admin] 생성 자산 엔드투엔드 계보
 */
export interface AssetProvenanceDrilldown {
  assetId: string;
  actionRunId: string;
  prompt: string;
  modelIdentifier: string;
  harnessVersion: string;
  sourceProvenance: HarnessSourceProvenance;
  qcResult: {
    score: number;
    passed: boolean;
    evaluatorNotes: string;
  };
  approvalChain: {
    requiresUserApproval: boolean;
    approvedBy?: string;
    approvedAt?: string;
  };
  publication: {
    jobId?: string;
    calendarEventId?: string;
    status: PublishingJobStatus;
    publishedUrl?: string;
  };
}
