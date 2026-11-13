export type StudioStatus = 'proposed' | 'confirmed' | 'rejected' | 'conflict'
export type EvidenceKind =
  | 'owner_statement'
  | 'approved_document'
  | 'external_verified'
  | 'imported_source'
  | 'unknown'

export interface EvidenceRef {
  kind: EvidenceKind
  sourceId: string
  excerpt?: string
  observedAt?: string
  evidenceDocumentId?: string
}

export interface KnowledgeProposal {
  id: string
  workspaceId: string
  threadId: string
  sourceMessageId: string
  category: string
  proposedContent: string
  replacesFactId?: string
  expectedFactVersion?: number
  expectedFactCreatedAt?: string
  confirmedFactId?: string
  evidence: EvidenceRef[]
  status: StudioStatus
  createdAt: string
}

export interface KnowledgeView {
  id: string
  category: string
  content: string
  status: 'active' | 'superseded' | 'expired'
  source: EvidenceRef
  approvedAt: string
  validFrom: string
  validUntil?: string
  supersedesFactId?: string
  usedBy: Array<'content' | 'engagement' | 'campaign'>
  createdAt: string
  versionTimestamp: string
}

export interface StudioGoalContext {
  id: string
  title: string
  desiredOutcome: string
  priority?: string
}

export type CuriosityKind = 'missing' | 'conflict' | 'stale' | 'opportunity'
export type CuriosityStatus = 'open' | 'answering' | 'review' | 'resolved' | 'snoozed' | 'not_applicable'
export type CuriosityPriority = 'blocking' | 'important' | 'optional'

export interface CuriosityItem {
  id: string
  workspaceId: string
  kind: CuriosityKind
  question: string
  reason: string
  expectedOutcome: string
  relatedFactIds: string[]
  relatedGoalId?: string
  evidence: EvidenceRef[]
  status: CuriosityStatus
  priority: CuriosityPriority
  createdAt: string
}

export type GoalStatus = 'draft' | 'active' | 'paused' | 'achieved' | 'retired'
export type GoalPriority = 'high' | 'normal' | 'low'

export interface SoheeGoal {
  id: string
  workspaceId: string
  title: string
  desiredOutcome: string
  metric?: {
    name: string
    baseline?: number
    target?: number
    unit: string
  }
  dueAt?: string
  priority: GoalPriority
  status: GoalStatus
  sourceMessageId?: string
  proposalId?: string
  version: number
  createdAt: string
  updatedAt: string
  updatedBy?: string
}

export type StudioFocus = 'teach' | 'inspect' | 'curiosity' | 'goal'

export interface StudioTurnMessage {
  id: string
  sender: 'user' | 'sohee'
  content: string
  timestamp: string
  focus?: StudioFocus
  proposals?: KnowledgeProposal[]
  suggestedGoal?: SoheeGoal
  relatedCuriosityId?: string
  isStreaming?: boolean
  status?: 'queued' | 'streaming' | 'completed' | 'failed' | 'cancelled'
  clientMessageId?: string
}

export interface StudioOverviewData {
  workspaceId: string
  knowledgeStats: {
    activeCount: number
    pendingProposalCount: number
    staleCount: number
    byCategory: Record<string, number>
  }
  topQuestions: CuriosityItem[]
  activeGoals: SoheeGoal[]
  educationReadiness: number | null // 기존 성장 모델 조회 전에는 미확인
  recentActivity: Array<{
    id: string
    title: string
    timestamp: string
    type: 'knowledge' | 'correction' | 'goal' | 'question'
  }>
}
