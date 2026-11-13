/**
 * Business Knowledge Source Ingestion Types (HF-55 / ANI-1405)
 */

export type KnowledgeSourceType = 'MANUAL' | 'URL' | 'FILE_DOCUMENT' | 'SNS'

export type KnowledgeCandidateDomain =
  | 'Business Identity'
  | 'Location & Hours'
  | 'Offerings'
  | 'Pricing'
  | 'Target Audience'
  | 'Differentiation'
  | 'Reservation / Booking Rules'
  | 'FAQ'
  | 'Promotions'
  | 'Safety / Forbidden Claims'
  | 'Links & Documents'

export interface IngestionSource {
  workspaceId: string
  sourceType: KnowledgeSourceType
  locator: string
  content: string
  fileSize?: number
  mimeType?: string
  sourceCreatedAt?: string
  actorId: string
}

export interface SourceRecord {
  id: string
  workspaceId: string
  sourceType: KnowledgeSourceType
  locator: string
  contentHash: string
  ingestedAt: string
  actorId: string
}

export interface CandidateProvenance {
  sourceRecordId: string
  sourceType: KnowledgeSourceType
  locator: string
  contentHash: string
  extractedAt: string
}

export interface KnowledgeCandidate {
  id: string
  workspaceId: string
  domain: KnowledgeCandidateDomain
  value: string
  status: 'CANDIDATE' | 'CONFIRMED' | 'REJECTED'
  confidence: number
  freshness: 'FRESH' | 'STALE'
  freshnessWarning?: string
  conflictState?: 'NONE' | 'CONFLICT'
  conflictMessage?: string
  provenance: CandidateProvenance
}

export interface ConfirmedKnowledgeVersion {
  versionNumber: number
  workspaceId: string
  facts: Record<string, string>
  candidateId: string
  confirmedBy: string
  confirmedAt: string
}

export interface VersionLineage {
  versionNumber: number
  sourceRecordId: string
  sourceType: KnowledgeSourceType
  sourceLocator: string
  confirmedBy: string
  confirmedAt: string
}
