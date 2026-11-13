/**
 * Core Channel Execution Types & Invariants
 * 
 * Invariants:
 * 1. MARKETPLACE_LISTED ≠ INSTALLED ≠ CONNECTED ≠ READY ≠ POLICY_ALLOWED
 * 2. External SUCCESS ≠ Sohee VERIFIED. All mutations require authoritative readback.
 * 3. Spend mutations require Human Approval + Daily Cap check.
 */

export type ExecutionChannel = 
  | 'instagram'
  | 'facebook'
  | 'threads'
  | 'x_twitter'
  | 'tiktok'
  | 'linkedin'
  | 'youtube_shorts'
  | 'wordpress'
  | 'pinterest'
  | 'naver_blog'
  | 'naver_search_ads'
  | 'google_ads'
  | 'meta_ads';

export type ActionSecurityLevel = 'READ' | 'DRAFT' | 'WRITE' | 'SPEND' | 'DELETE' | 'PRIVILEGED';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerMetrics {
  consecutiveFailures: number;
  lastFailureTimestamp?: string;
  lastStateChangeTimestamp: string;
  state: CircuitBreakerState;
  circuitOpenReason?: string;
}

export interface KillSwitchStatus {
  isGlobalKilled: boolean;
  killedChannels: ExecutionChannel[];
  killedProviders: string[];
  lastUpdated: string;
  reason?: string;
}

export interface AuthoritativeReceipt {
  receiptId: string;
  channel: ExecutionChannel;
  provider: string;
  externalObjectId: string;
  externalPermalink?: string;
  verifiedAt: string;
  readbackStatus: 'VERIFIED' | 'MISMATCH' | 'NOT_FOUND' | 'UNVERIFIED';
  rawPayloadHash: string;
}

export interface ChannelExecutionResult<T = unknown> {
  success: boolean;
  channel: ExecutionChannel;
  action: string;
  data?: T;
  receipt?: AuthoritativeReceipt;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    handoffRequired?: boolean;
  };
  circuitState: CircuitBreakerState;
  executedAt: string;
}

export interface SpendPolicyEnvelope {
  workspaceId: string;
  channel: ExecutionChannel;
  dailyBudgetCapKRW: number;
  requestedSpendKRW: number;
  currentDayAccumulatedSpendKRW: number;
  isHumanApproved: boolean;
  approvalToken?: string;
}
