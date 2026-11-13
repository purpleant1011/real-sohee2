/**
 * Post-Publish Outcome Observation Types (HF-54 / ANI-1404)
 */

export type ChannelType = 'instagram' | 'threads'

export type ObservedStatus =
  | 'OBSERVED'
  | 'PARTIAL'
  | 'NOT_AVAILABLE'
  | 'RESULT_UNKNOWN'
  | 'DELETED'

export interface OutcomeMetrics {
  likes?: number | 'NOT_AVAILABLE'
  comments?: number | 'NOT_AVAILABLE'
  impressions?: number | 'NOT_AVAILABLE'
  reach?: number | 'NOT_AVAILABLE'
  shares?: number | 'NOT_AVAILABLE'
}

export interface PostLineageContext {
  missionId?: string
  contentItemId?: string
  contentVersionId?: string
  creativeBundleId?: string
  approvalId?: string
  actionRequestId?: string
  actionAttemptId?: string
  businessKnowledgeVersionId?: string
  textHarnessVersionId?: string
  imageHarnessVersionId?: string
}

export interface ObservationSnapshot {
  id: string
  workspaceId: string
  channel: ChannelType
  providerPostId: string
  observedStatus: ObservedStatus
  metrics: OutcomeMetrics
  permalink?: string
  errorMessage?: string
  observedAt: string
  lineage: PostLineageContext
}

export interface ProviderMetricsResult {
  status: 'AVAILABLE' | 'NOT_AVAILABLE' | 'DELETED'
  likes?: number | 'NOT_AVAILABLE'
  comments?: number | 'NOT_AVAILABLE'
  impressions?: number | 'NOT_AVAILABLE'
  permalink?: string
  message?: string
}

export interface ObservationProviderClient {
  fetchPostMetrics(params: {
    channel: ChannelType
    providerPostId: string
  }): Promise<ProviderMetricsResult>
}

export interface ObservePostParams {
  workspaceId: string
  channel: ChannelType
  providerPostId: string
  lineage: PostLineageContext
}

export interface HarnessImprovementCandidate {
  id: string
  workspaceId: string
  harnessType: 'text_harness' | 'image_harness'
  currentVersionId: string
  suggestedRule: string
  basedOnObservationId: string
  status: 'PROPOSED' | 'CONFIRMED' | 'REJECTED'
  createdAt: string
}
