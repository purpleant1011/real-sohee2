/**
 * Admin Evidence Center Operations Service (ANI-818)
 * 
 * Core Invariants:
 * 1. Deep Traceability: Every item exposes provider deep-link, readback payload hash, and structural diff.
 * 2. Operator Safety: Every reconcile/rollback action requires operator ID, reason, and generates an audit log entry.
 * 3. Linear Evidence Linkage: Operator interventions link back to Linear issue/bundle evidence.
 */

export type MismatchKind =
  | 'PENDING_READBACK'
  | 'READBACK_PAYLOAD_MISMATCH'
  | 'STALE_PROVIDER_OBJECT'
  | 'SETTLEMENT_CREDIT_MISMATCH'
  | 'DUPLICATE_EXECUTION_RISK';

export interface EvidenceCenterItem {
  id: string;
  workspaceId: string;
  actionRunId: string;
  channel: string;
  mismatchKind: MismatchKind;
  providerDeepLink: string;
  readbackPayloadHash?: string;
  expectedHash?: string;
  payloadDiffSummary: string;
  settlementDifferenceKRW?: number;
  detectedAt: string;
  status: 'OPEN' | 'RECONCILED' | 'ROLLED_BACK' | 'DISMISSED';
}

export interface OperatorInterventionLog {
  interventionId: string;
  itemId: string;
  actionRunId: string;
  operatorId: string;
  action: 'RECONCILE' | 'ROLLBACK' | 'DISMISS';
  reason: string;
  executedAt: string;
  linearEvidenceRef?: string;
}

export class AdminEvidenceCenterService {
  private items: Map<string, EvidenceCenterItem> = new Map();
  private auditLogs: OperatorInterventionLog[] = [];

  registerMismatch(item: Omit<EvidenceCenterItem, 'id' | 'detectedAt' | 'status'>): EvidenceCenterItem {
    const id = `ev_center_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fullItem: EvidenceCenterItem = {
      id,
      detectedAt: new Date().toISOString(),
      status: 'OPEN',
      ...item,
    };
    this.items.set(id, fullItem);
    return fullItem;
  }

  listItems(status?: 'OPEN' | 'RECONCILED' | 'ROLLED_BACK' | 'DISMISSED'): EvidenceCenterItem[] {
    const all = Array.from(this.items.values());
    if (!status) return all;
    return all.filter((i) => i.status === status);
  }

  executeReconcile(itemId: string, operatorId: string, reason: string, linearEvidenceRef?: string): OperatorInterventionLog {
    const item = this.items.get(itemId);
    if (!item) {
      throw new Error(`Evidence center item not found: ${itemId}`);
    }

    item.status = 'RECONCILED';

    const log: OperatorInterventionLog = {
      interventionId: `op_log_${Date.now()}`,
      itemId,
      actionRunId: item.actionRunId,
      operatorId,
      action: 'RECONCILE',
      reason,
      executedAt: new Date().toISOString(),
      linearEvidenceRef,
    };

    this.auditLogs.push(log);
    return log;
  }

  executeRollback(itemId: string, operatorId: string, reason: string, linearEvidenceRef?: string): OperatorInterventionLog {
    const item = this.items.get(itemId);
    if (!item) {
      throw new Error(`Evidence center item not found: ${itemId}`);
    }

    item.status = 'ROLLED_BACK';

    const log: OperatorInterventionLog = {
      interventionId: `op_log_${Date.now()}`,
      itemId,
      actionRunId: item.actionRunId,
      operatorId,
      action: 'ROLLBACK',
      reason,
      executedAt: new Date().toISOString(),
      linearEvidenceRef,
    };

    this.auditLogs.push(log);
    return log;
  }

  getAuditLogs(): OperatorInterventionLog[] {
    return [...this.auditLogs];
  }
}
