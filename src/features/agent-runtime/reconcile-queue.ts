/**
 * RESULT_UNKNOWN Reconcile Queue (ANI-816)
 * 
 * Core Invariants:
 * 1. Zero Duplicate External Execution: Under network partition/timeout, blind retries are prohibited.
 * 2. Recovery via Idempotency Key: Provider search/readback determines whether the mutation succeeded.
 * 3. Settlement Coupling:
 *    - If found in provider: promote to EXTERNAL_VERIFIED and finalize credit settlement.
 *    - If not found after retention window: confirm FAILED and refund/release reserved credits.
 */

import type { ReadbackVerificationCertificate } from './readback-verifier';

export type ReconcileItemStatus = 'QUEUED' | 'RECONCILING' | 'RESOLVED_VERIFIED' | 'RESOLVED_FAILED' | 'EXPIRED';

export interface ReconcileQueueItem {
  id: string;
  actionRunId: string;
  workspaceId: string;
  idempotencyKey: string;
  channel: string;
  expectedPayload: Record<string, unknown>;
  reservedCredits: number;
  status: ReconcileItemStatus;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: string;
  lastAttemptAt?: string;
  resolvedAt?: string;
  resolutionCertificate?: ReadbackVerificationCertificate;
  errorReason?: string;
}

export interface ReconcileProviderLookupResult {
  isObjectFound: boolean;
  authoritativeId?: string;
  liveUrl?: string;
  actualPayload?: Record<string, unknown>;
}

export class ResultUnknownReconcileQueue {
  private queue: Map<string, ReconcileQueueItem> = new Map();
  private idempotencyRegistry: Set<string> = new Set();

  /**
   * Enqueues an action that finished with RESULT_UNKNOWN.
   */
  enqueue(item: {
    actionRunId: string;
    workspaceId: string;
    idempotencyKey: string;
    channel: string;
    expectedPayload: Record<string, unknown>;
    reservedCredits: number;
    maxAttempts?: number;
  }): ReconcileQueueItem {
    // Invariant: Idempotency check prevents duplicate enrollment
    const existing = Array.from(this.queue.values()).find(
      (q) => q.idempotencyKey === item.idempotencyKey && q.status !== 'RESOLVED_FAILED' && q.status !== 'EXPIRED'
    );
    if (existing) {
      return existing;
    }

    const queueId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record: ReconcileQueueItem = {
      id: queueId,
      actionRunId: item.actionRunId,
      workspaceId: item.workspaceId,
      idempotencyKey: item.idempotencyKey,
      channel: item.channel,
      expectedPayload: item.expectedPayload,
      reservedCredits: item.reservedCredits,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: item.maxAttempts || 3,
      enqueuedAt: new Date().toISOString(),
    };

    this.queue.set(queueId, record);
    this.idempotencyRegistry.add(item.idempotencyKey);
    return record;
  }

  getQueueItem(id: string): ReconcileQueueItem | undefined {
    return this.queue.get(id);
  }

  listPendingItems(workspaceId?: string): ReconcileQueueItem[] {
    return Array.from(this.queue.values()).filter(
      (item) =>
        (item.status === 'QUEUED' || item.status === 'RECONCILING') &&
        (!workspaceId || item.workspaceId === workspaceId)
    );
  }

  /**
   * Reconciles a single item using provider lookup.
   * DOES NOT RE-POST. Only queries provider state.
   */
  async reconcileItem(
    itemId: string,
    providerLookup: (idempotencyKey: string, payload: Record<string, unknown>) => Promise<ReconcileProviderLookupResult>
  ): Promise<{
    item: ReconcileQueueItem;
    outcome: 'PROMOTED_TO_VERIFIED' | 'REFUNDED_CREDITS' | 'STILL_PENDING';
    settledCredits: number;
    refundedCredits: number;
  }> {
    const item = this.queue.get(itemId);
    if (!item) {
      throw new Error(`Reconcile item not found: ${itemId}`);
    }

    item.status = 'RECONCILING';
    item.attempts += 1;
    item.lastAttemptAt = new Date().toISOString();

    const lookup = await providerLookup(item.idempotencyKey, item.expectedPayload);

    if (lookup.isObjectFound && lookup.authoritativeId && lookup.liveUrl) {
      // 1. Found in external provider -> Safe to promote!
      item.status = 'RESOLVED_VERIFIED';
      item.resolvedAt = new Date().toISOString();
      item.resolutionCertificate = {
        actionRunId: item.actionRunId,
        workspaceId: item.workspaceId,
        verificationState: 'EXTERNAL_VERIFIED',
        isVerified: true,
        allowRetry: false,
        authoritativeId: lookup.authoritativeId,
        liveUrl: lookup.liveUrl,
        verifiedAt: item.resolvedAt,
      };

      return {
        item,
        outcome: 'PROMOTED_TO_VERIFIED',
        settledCredits: item.reservedCredits,
        refundedCredits: 0,
      };
    }

    // 2. Not found yet
    if (item.attempts >= item.maxAttempts) {
      // Exceeded max attempts: declare failed and refund reserved credits safely
      item.status = 'RESOLVED_FAILED';
      item.resolvedAt = new Date().toISOString();
      item.errorReason = `Reconcile exhausted ${item.maxAttempts} attempts without locating external object. Safely refunded.`;

      return {
        item,
        outcome: 'REFUNDED_CREDITS',
        settledCredits: 0,
        refundedCredits: item.reservedCredits,
      };
    }

    // Still pending next reconcile tick
    item.status = 'QUEUED';
    return {
      item,
      outcome: 'STILL_PENDING',
      settledCredits: 0,
      refundedCredits: 0,
    };
  }
}
