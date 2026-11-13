/**
 * Sohee V0.9 5th Update · Wave 5 Chat Contract
 * Marketing Employee Scenario → Tool → Evidence Capability Matrix Model
 * 
 * Traceability: ANI-937
 */

export type MarketingScenarioType =
  | 'CONTENT_PUBLISH'
  | 'AD_BUDGET_OPTIMIZE'
  | 'CUSTOMER_BOOKING'
  | 'ATTRIBUTION_REVENUE'
  | 'KNOWLEDGE_GOAL_MUTATION'
  | 'CONNECTION_TRUST_AUDIT'
  | 'AUTONOMY_REPLAN';

export type ApprovalPolicyType = 'AUTOMATIC' | 'OWNER_APPROVAL_REQUIRED' | 'STRICT_ESCALATION';
export type MutationType = 'READ_ONLY' | 'DURABLE_WRITE' | 'FINANCIAL_WRITE';
export type ReadbackMethod = 'INDEPENDENT_GET' | 'WEBHOOK_RECEIPT' | 'EVENT_POLL' | 'NONE';

export type ContractFailureReason =
  | 'ZERO_CREDIT'
  | 'PROVIDER_DISCONNECTED'
  | 'EXPIRED_AUTH_TOKEN'
  | 'TIMEOUT_RESULT_UNKNOWN'
  | 'UNSUPPORTED_CAPABILITY'
  | 'APPROVAL_REJECTED';

export interface ScenarioContractDefinition {
  scenarioType: MarketingScenarioType;
  title: string;
  description: string;
  naturalLanguageExamples: string[];
  requiredContext: string[]; // e.g. ['workspaceId', 'brandVoice', 'channelToken']
  supportedTools: string[]; // e.g. ['meta_post_creator', 'qc_gatekeeper']
  mutationType: MutationType;
  approvalPolicy: ApprovalPolicyType;
  readbackMethod: ReadbackMethod;
  evidenceType: 'CRYPTOGRAPHIC_SHA256' | 'EMR_RECEIPT' | 'PG_LEDGER_PROOF' | 'READ_LOG';
  failureContract: {
    [key in ContractFailureReason]?: {
      resultingStatus: 'BLOCKED' | 'RESULT_UNKNOWN' | 'REJECTED' | 'UNSUPPORTED';
      clientMessage: string;
      recoveryAction: string;
    };
  };
}

export interface ScenarioExecutionTrace {
  traceId: string;
  conversationId: string;
  actionRunId: string;
  scenarioType: MarketingScenarioType;
  status: 'PENDING' | 'APPROVAL_REQUIRED' | 'EXECUTING' | 'VERIFYING' | 'VERIFIED' | 'BLOCKED' | 'RESULT_UNKNOWN' | 'UNSUPPORTED';
  evidenceId?: string;
  evidenceDigest?: string;
  failureReason?: ContractFailureReason;
  errorMessage?: string;
  timestamp: string;
}
