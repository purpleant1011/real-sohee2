/**
 * Sohee V0.9 5th Update · Wave 4 Autonomy
 * Opportunity Detector & Goal-Gap Replan Closed Loop Model
 * 
 * Traceability: ANI-932
 */

export type ExtendedOpportunityType =
  | 'SCHEDULE_DUE'
  | 'BOOKING_GAP'
  | 'GOAL_SHORTFALL'
  | 'CHANNEL_RECONNECTED'
  | 'UNANSWERED_INQUIRY'
  | 'AD_STOP_LOSS'
  | 'TOKEN_EXPIRING';

export type OpportunityPriorityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface CanonicalOpportunity {
  id: string;
  workspaceId: string;
  type: ExtendedOpportunityType;
  dedupeKey: string;
  detectedAt: string;
  urgencyScore: number; // 0 - 100
  priorityTier: OpportunityPriorityTier;
  title: string;
  rationale: string;
  recommendedAction: string;
  targetChannel: string;
  expectedImpactKrw?: number;
  estimatedCostKrw?: number;
  requiresOwnerEscalation: boolean;
  escalationReason?: string;
  status: 'DETECTED' | 'DISPATCHED' | 'VERIFIED_OUTCOME' | 'SUPPRESSED_PAUSED';
}

export interface ActionGraphNode {
  nodeId: string;
  actionName: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
  evidenceId?: string;
  retryCount: number;
}

export interface VersionedActionGraph {
  graphId: string;
  workspaceId: string;
  version: number;
  goalTitle: string;
  gapMetric: string;
  nodes: ActionGraphNode[];
  replanTriggerReason?: string;
  replanOutcomeDigest?: string;
  updatedAt: string;
}

export interface AutonomousClosedLoopTrace {
  traceId: string;
  workspaceId: string;
  opportunityId: string;
  actionRunId: string;
  evidenceId: string;
  previousGraphVersion: number;
  newGraphVersion: number;
  replanSuccess: boolean;
  timestamp: string;
}
