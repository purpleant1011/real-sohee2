/**
 * Real Domain Tool Runtime Contracts (ANI-920, ANI-919)
 * 
 * SSOT for domain tool execution, eliminating synthetic mock success and enforcing Fail-Closed gates.
 */

import type { ServerSupabaseClient } from '@/features/operations/types';
import type { InteractionDraftRequest } from '@/features/engagement/interaction-draft-contract';

export type ToolStatus =
  | 'COMPLETED'
  | 'AWAITING_APPROVAL'
  | 'FAILED'
  | 'NOT_IMPLEMENTED'
  | 'UNAVAILABLE'
  | 'BLOCKED'
  | 'RESULT_UNKNOWN'
  | 'DISCONNECTED'
  | 'DEGRADED';

export interface ToolExecutionContext {
  /** Server-injected after actor/worker validation; never accepted from model arguments. */
  readClient?: ServerSupabaseClient;
  /** Saves canonical internal reply drafts only; injected by the validated server owner. */
  prepareInteractionDraft?: (request: InteractionDraftRequest) => Promise<ToolExecutionResult>;
  /** Server-owned candidate save only; never knowledge confirmation. */
  proposeKnowledge?: (request: import('@/features/sohee-studio/conversation-knowledge-contract').ConversationKnowledgeRequest) => Promise<ToolExecutionResult>;
  workspaceId: string;
  sessionId?: string;
  actionRunId?: string;
  agentRunId?: string;
  correlationId: string;
  actorId?: string;
  intentMode?: 'DRAFT' | 'EXECUTE';
  isTestAccount?: boolean;
  creditBalance?: number;
  auditTrail?: string[];
  signal?: AbortSignal;
  deadlineAt?: number;
  canContinue?: () => Promise<boolean>;
  onExecutionStarting?: () => Promise<void>;
  allowedCapabilityIds?: readonly string[];
  authorizeCapability?: (capabilityId: string) => Promise<boolean>;
}

export interface ToolPreflightResult {
  allowed: boolean;
  requiresApproval?: boolean;
  rejectionReason?: string;
  status?: ToolStatus;
  errorCode?:
    | 'INSUFFICIENT_CREDITS'
    | 'KILLSWITCH_ACTIVE'
    | 'UNAUTHORIZED_SCOPE'
    | 'APPROVAL_REQUIRED'
    | 'POLICY_VIOLATION'
    | 'UNAVAILABLE'
    | 'NOT_IMPLEMENTED'
    | 'CAPABILITY_NOT_READY'
    | string;
}

export interface ToolEvidenceReceipt {
  channel?: string;
  url?: string;
  receiptId?: string;
  externalPostId?: string;
  providerReference?: string;
  httpStatus?: number;
  verifiedAt?: string;
  confidenceScore?: number;
  [key: string]: unknown;
}

export interface ToolExecutionResult {
  success: boolean;
  toolId: string;
  status: ToolStatus;
  data?: Record<string, unknown>;
  evidence?: ToolEvidenceReceipt;
  proposal?: {
    proposalId: string;
    proposalType: string;
    title: string;
    description: string;
    proposedValue: unknown;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  creditDeducted?: number;
  logs?: string[];
}

export interface DomainToolHandler {
  toolId: string;
  domain: string;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;
  readback?(externalId: string, context: ToolExecutionContext): Promise<{ verified: boolean; data?: unknown }>;
  cancel?(actionRunId: string, context: ToolExecutionContext): Promise<boolean>;
}
