/**
 * Sohee V0.9 5th Update · Wave 3 My Sohee
 * Knowledge, Capabilities, Goals & Autonomy Control Center Model
 * 
 * Traceability: ANI-930
 */

export type RuleCategory = 
  | 'VOICE'
  | 'PRICING'
  | 'DISCOUNT'
  | 'FORBIDDEN_WORDS'
  | 'CHANNEL_POLICY';

export type MutationSource = 'OWNER_DIRECT_EDIT' | 'DOCK_CHAT_MUTATION' | 'EVIDENCE_LEARNED';

export interface VersionedRuleObject {
  ruleId: string;
  workspaceId: string;
  version: number;
  category: RuleCategory;
  title: string;
  content: string;
  source: MutationSource;
  confidence: number; // 0.0 ~ 1.0
  isApproved: boolean;
  updatedAt: string;
  author: string;
}

export interface AutonomyEnvelopePolicy {
  policyId: string;
  workspaceId: string;
  version: number;
  maxDailyAdSpendKrw: number;
  maxDiscountPercent: number;
  allowedChannels: string[];
  forbiddenWords: string[];
  approvalConditions: {
    minSpendRequiringApproval: number;
    requireApprovalForNewCampaign: boolean;
    requireApprovalForRefundProposal: boolean;
  };
  updatedAt: string;
}

export interface RecurringRoutine {
  routineId: string;
  workspaceId: string;
  title: string;
  cronExpression: string; // e.g. "0 9 * * *"
  targetAction: string;
  isActive: boolean;
  ownerAbsentSupported: boolean;
  lastRunAt: string | null;
  lastProofId: string | null;
}

export interface LearningMemoryItem {
  memoryId: string;
  workspaceId: string;
  sourceEvidenceId: string; // "verified evidence만 source로 사용"
  learnedInsight: string;
  confidenceScore: number;
  ttlTimestamp: string; // TTL 지원
  status: 'ACTIVE' | 'EXPIRED';
  createdAt: string;
}

export interface RuleAuditRecord {
  auditId: string;
  ruleId: string;
  workspaceId: string;
  previousVersion: number;
  newVersion: number;
  mutatedBy: MutationSource;
  changeSummary: string;
  timestamp: string;
}
