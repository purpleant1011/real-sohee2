/**
 * Sohee V0.9 5th Update · Wave 3 Content Studio
 * Production Studio Figma Parity Model & Lineage
 * 
 * Pipeline: Queue → Brief → Asset → Channel Preview → QC → Approval → Schedule/Publish → Readback
 * Traceability: ANI-927
 */

export type ChannelType = 'INSTAGRAM' | 'NAVER_BLOG' | 'DAANGN';

export type ContentStudioStage = 
  | 'QUEUE'
  | 'BRIEF'
  | 'ASSET'
  | 'CHANNEL_PREVIEW'
  | 'QC'
  | 'APPROVAL'
  | 'SCHEDULE_OR_PUBLISH'
  | 'READBACK_VERIFIED';

export type PublishingJobStatus = 
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'RECONCILE_REQUIRED';

export interface ContentBrief {
  briefId: string;
  workspaceId: string;
  topic: string;
  targetChannels: ChannelType[];
  targetAudience: string;
  creativeAngle: string;
  harnessId?: string;
  harnessName?: string;
  createdAt: string;
  status: 'DRAFT' | 'READY_FOR_GENERATION' | 'GENERATED';
}

export interface ContentAsset {
  assetId: string;
  briefId: string;
  assetType: 'IMAGE' | 'COPY' | 'CAROUSEL_CARD';
  mediaUrl: string;
  sha256: string;
  isApprovedByOwner: boolean;
  createdAt: string;
}

export interface ChannelQcCheck {
  qcId: string;
  channel: ChannelType;
  passed: boolean;
  score: number; // 0 ~ 100
  forbiddenWordsFound: string[];
  channelRulesComplied: boolean;
  recommendations: string[];
}

export interface ChannelVariant {
  variantId: string;
  briefId: string;
  channel: ChannelType;
  title?: string;
  caption: string;
  hashtags: string[];
  assets: ContentAsset[];
  qc: ChannelQcCheck;
  isApproved: boolean;
}

export interface PublishingJob {
  jobId: string;
  workspaceId: string;
  briefId: string;
  variantId: string;
  channel: ChannelType;
  scheduledAt: string | null;
  publishedAt: string | null;
  status: PublishingJobStatus;
  providerPostId?: string;
  providerPostUrl?: string;
  evidenceId?: string;
  failureReason?: string;
  reconcileAttemptCount: number;
}

export interface ContentStudioItem {
  id: string;
  brief: ContentBrief;
  variants: ChannelVariant[];
  currentStage: ContentStudioStage;
  publishingJob?: PublishingJob;
  updatedAt: string;
}
