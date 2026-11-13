import type { ActionCostQuote } from '@/features/credit-economy/types';

export type FinOpsReservationState =
  | 'RESERVED'
  | 'EXECUTING'
  | 'SETTLED'
  | 'RELEASED'
  | 'HOLD_FOR_RECONCILE';

export interface FinOpsReservationReceipt {
  reservationId: string;
  quoteId: string;
  actionRunId: string;
  workspaceId: string;
  reservedCredits: number;
  balanceBefore: number;
  balanceAfter: number;
  state: FinOpsReservationState;
  reservedAt: string;
  settledAt?: string;
  releasedAt?: string;
  idempotencyKey: string;
}

export type AdSpendPlatform = 'META_ADS' | 'GOOGLE_ADS' | 'NAVER_SEARCH_ADS';

export type AdSpendReconcileStatus =
  | 'PENDING_READBACK'
  | 'MATCHED'
  | 'DISCREPANCY_ALERT'
  | 'SETTLED';

export interface ExternalAdSpendLedgerEntry {
  spendId: string;
  workspaceId: string;
  actionRunId: string;
  campaignId: string;
  platform: AdSpendPlatform;
  authorizedAmountKrw: number;
  observedSpendKrw: number;
  varianceKrw: number;
  reconcileStatus: AdSpendReconcileStatus;
  recordedAt: string;
  readbackAt?: string;
  notes?: string;
}

export interface FinOpsSettlementReceipt {
  settlementId: string;
  reservationId: string;
  actionRunId: string;
  workspaceId: string;
  finalSettledCredits: number;
  releasedCredits: number;
  balanceBefore: number;
  balanceAfter: number;
  externalSpendId?: string;
  settledAt: string;
  status: 'SETTLED' | 'RELEASED_FULL' | 'RELEASED_PARTIAL' | 'HELD_FOR_RECONCILE';
  reason: string;
}

export interface FinOpsReserveResult {
  allowed: boolean;
  reservation?: FinOpsReservationReceipt;
  reason?: string;
  currentAvailableCredits: number;
}

export interface AiCreditLedgerRecord {
  workspace_id: string;
  balance: number;
  reserved: number;
  total_granted: number;
  updated_at: string;
}

export interface FinOpsReservationRecord {
  reservation_id: string;
  workspace_id: string;
  action_run_id: string;
  amount: number;
  status: 'RESERVED' | 'SETTLED' | 'RELEASED';
  quote_id?: string;
  idempotency_key?: string;
  created_at: string;
  updated_at: string;
}

export interface FinOpsSettlementRecord {
  settlement_id: string;
  reservation_id: string;
  actual_cost: number;
  settled_at: string;
}

export interface ExternalAdSpendLedgerRecord {
  spend_ledger_id: string;
  workspace_id: string;
  ad_account_id: string;
  channel: string;
  spent_krw: number;
  budget_limit_krw: number;
  updated_at: string;
}

export interface ConservationInvariantResult {
  isValid: boolean;
  initialBalance: number;
  currentBalance: number;
  settledTotal: number;
  reservedTotal: number;
  discrepancy: number;
  reason?: string;
}

