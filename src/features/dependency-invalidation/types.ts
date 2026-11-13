/**
 * Knowledge & Harness Dependency Invalidation Types (HF-57 / ANI-1407)
 */

export type UpstreamType =
  | 'business_knowledge'
  | 'text_harness'
  | 'image_harness'
  | 'operating_policy'
  | 'reference_set'

export type DownstreamEntityType =
  | 'content_version'
  | 'creative_bundle'
  | 'mission_plan'
  | 'approval'
  | 'schedule'
  | 'external_action'

export type EntityStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'APPROVAL_INVALIDATED'
  | 'PUBLISHED'
  | 'SCHEDULED'
  | 'FAILED'

export interface UpstreamDependencies {
  businessKnowledgeVersionId?: string
  textHarnessVersionId?: string
  imageHarnessVersionId?: string
  operatingPolicyVersionId?: string
  referenceAssetIds?: string[]
  targetChannel?: string
}

export interface DownstreamEntity {
  id: string
  workspaceId: string
  type: DownstreamEntityType
  status: EntityStatus
  upstreamDependencies: UpstreamDependencies
  isStale?: boolean
  staleReason?: string
  approvalFingerprint?: string
  publishedAt?: string
  updatedAt?: string
}

export interface UpstreamVersionChange {
  workspaceId: string
  upstreamType: UpstreamType
  oldVersionId: string
  newVersionId: string
  isConfirmed: boolean
  targetEntityId?: string
}

export interface InvalidationResult {
  affectedEntities: string[]
  invalidatedApprovals: string[]
  timestamp: string
}
