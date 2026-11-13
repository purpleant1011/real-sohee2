export type FactState = 'AVAILABLE' | 'UNKNOWN' | 'NO_PROOF' | 'STALE' | 'NOT_VERIFIED'
export type DatasetMode = 'ACTUAL' | 'DEMO' | 'TEST'

export interface RenderFact<T> {
  value: T
  state: FactState
  sourceId?: string | null
  observedAt?: string | null
  freshness?: 'FRESH' | 'STALE' | null
  datasetMode: DatasetMode
}

export function createRenderFact<T>(
  value: T,
  state: FactState,
  options: {
    sourceId?: string | null
    observedAt?: string | null
    freshness?: 'FRESH' | 'STALE' | null
    datasetMode?: DatasetMode
  } = {},
): RenderFact<T> {
  return {
    value,
    state,
    sourceId: options.sourceId ?? null,
    observedAt: options.observedAt ?? null,
    freshness: options.freshness ?? null,
    datasetMode: options.datasetMode ?? 'ACTUAL',
  }
}

export interface CanonicalChannelSummary {
  channel: string
  connectionStatus: string
  externalAccountId: string | null
  accountLabel: string | null
  isAuthorized: boolean
  isListening: boolean
  lastVerifiedAt: string | null
}

export interface CanonicalCapabilitySummary {
  id: string
  channel: string
  name: string
  state: string
  proofStatus: string
  isExecutable: boolean
  isProven: boolean
  isAutonomous: boolean
  failureCode?: string | null
}

export interface CanonicalEmployeeWorkItem {
  id: string
  category: 'comment' | 'dm' | 'reply' | 'mention' | 'reconnect_needed' | 'action_failed'
  title: string
  summary: string
  status: 'needs_action' | 'approval_required' | 'completed' | 'failed'
  externalTargetId?: string | null
  externalPermalink?: string | null
  occurredAt: string
  completedAt?: string | null
}

export interface WorkspaceCanonicalReadModel {
  workspaceId: string
  datasetMode: DatasetMode
  businessName: RenderFact<string>
  industry: RenderFact<string>
  summary: RenderFact<string>
  creditsAvailable: RenderFact<number>
  channels: CanonicalChannelSummary[]
  capabilities: CanonicalCapabilitySummary[]
  metrics: {
    views: RenderFact<number | null>
    likes: RenderFact<number | null>
    comments: RenderFact<number | null>
  }
  recentActionsCount: number
  inbox: CanonicalEmployeeWorkItem[]
  generatedAt: string
}
