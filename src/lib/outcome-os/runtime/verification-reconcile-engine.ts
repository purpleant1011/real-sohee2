import type { CanonicalActionVerificationState } from '@/types/autonomous-outcome-os';

export interface CanonicalExecutionReceiptV2 {
  receiptId: string;
  workspaceId: string;
  runId: string;
  attemptId: string;
  actionId: string;
  provider: string;
  providerAccountId: string;
  providerObjectId: string;
  externalUrl: string;
  expectedFingerprint: string;
  observedFingerprint: string;
  providerObservedAt: string;
  verifiedAt: string;
  verificationMethod: 'GRAPH_API_GET' | 'NAVER_SEARCH_READBACK' | 'ASIDE_BROWSER_READBACK' | 'CANONICAL_CONNECTOR' | 'MCP_TOOL_READBACK';
  adapterVersion: string;
  rawEvidenceHash: string;
  status: 'VERIFIED_CANONICAL' | 'VERIFY_FAILED';
}

export interface ReconcileCandidate {
  actionId: string;
  workspaceId: string;
  runId: string;
  attemptId: string;
  provider: string;
  providerAccountId: string;
  state: CanonicalActionVerificationState;
  submittedAt: string;
  expectedFingerprint: string;
  timeoutOccurred: boolean;
}

export interface ProviderRecentObject {
  objectId: string;
  permalink: string;
  contentSnippet: string;
  publishedAt: string;
}

export class VerificationReconcileEngine {
  /**
   * Transition action state across canonical verification lifecycle (ANI-758)
   */
  transitionVerificationState(
    currentState: CanonicalActionVerificationState,
    event: 'SUBMIT' | 'ACCEPT' | 'TIMEOUT' | 'START_VERIFY' | 'CONFIRM_LIVE' | 'READBACK_MISMATCH' | 'REJECT'
  ): CanonicalActionVerificationState {
    switch (currentState) {
      case 'PLANNED':
        if (event === 'SUBMIT') return 'SUBMITTED';
        break;
      case 'SUBMITTED':
        if (event === 'ACCEPT') return 'ACCEPTED';
        if (event === 'TIMEOUT') return 'RESULT_UNKNOWN';
        if (event === 'REJECT') return 'FAILED';
        break;
      case 'ACCEPTED':
        if (event === 'START_VERIFY') return 'VERIFYING';
        if (event === 'TIMEOUT') return 'RESULT_UNKNOWN';
        break;
      case 'VERIFYING':
        if (event === 'CONFIRM_LIVE') return 'VERIFIED';
        if (event === 'READBACK_MISMATCH') return 'VERIFY_FAILED';
        if (event === 'TIMEOUT') return 'RESULT_UNKNOWN';
        break;
      case 'RESULT_UNKNOWN':
        if (event === 'CONFIRM_LIVE') return 'VERIFIED';
        if (event === 'READBACK_MISMATCH') return 'VERIFY_FAILED';
        break;
      default:
        break;
    }
    throw new Error(`Invalid canonical verification transition from [${currentState}] with event [${event}]`);
  }

  /**
   * Reconciles RESULT_UNKNOWN action by matching expected fingerprint against provider recent objects.
   * Prevents blind retries and ensures idempotent outcome recovery.
   */
  async reconcileUnknownAction(params: {
    candidate: ReconcileCandidate;
    providerRecentObjects: ProviderRecentObject[];
    computeFingerprint: (text: string) => Promise<string>;
    persistReceipt: (receipt: CanonicalExecutionReceiptV2) => Promise<boolean>;
  }): Promise<{
    resolvedState: 'VERIFIED' | 'VERIFY_FAILED' | 'RESULT_UNKNOWN';
    receipt?: CanonicalExecutionReceiptV2;
    reason?: string;
  }> {
    const { candidate, providerRecentObjects, computeFingerprint, persistReceipt } = params;

    // Search provider recent objects for matching fingerprint
    for (const obj of providerRecentObjects) {
      const objFingerprint = await computeFingerprint(obj.contentSnippet);
      if (objFingerprint === candidate.expectedFingerprint) {
        // Match found! Generate durable receipt
        const receiptId = `rcpt_rec_${candidate.actionId}_${Date.now()}`;
        const receipt: CanonicalExecutionReceiptV2 = {
          receiptId,
          workspaceId: candidate.workspaceId,
          runId: candidate.runId,
          attemptId: candidate.attemptId,
          actionId: candidate.actionId,
          provider: candidate.provider,
          providerAccountId: candidate.providerAccountId,
          providerObjectId: obj.objectId,
          externalUrl: obj.permalink,
          expectedFingerprint: candidate.expectedFingerprint,
          observedFingerprint: objFingerprint,
          providerObservedAt: obj.publishedAt,
          verifiedAt: new Date().toISOString(),
          verificationMethod: 'CANONICAL_CONNECTOR',
          adapterVersion: 'v0.9.3-reconciler',
          rawEvidenceHash: `hash_${candidate.actionId}_${obj.objectId}`,
          status: 'VERIFIED_CANONICAL',
        };

        // Fail-Closed: Receipt persist must succeed
        const persisted = await persistReceipt(receipt);
        if (!persisted) {
          return {
            resolvedState: 'RESULT_UNKNOWN',
            reason: 'Matched provider object found but durable receipt persistence failed. State remains RESULT_UNKNOWN.',
          };
        }

        return {
          resolvedState: 'VERIFIED',
          receipt,
        };
      }
    }

    // If candidate has been in RESULT_UNKNOWN for over 2 hours without appearing, declare VERIFY_FAILED
    const elapsedMs = Date.now() - new Date(candidate.submittedAt).getTime();
    if (elapsedMs > 7200000) {
      return {
        resolvedState: 'VERIFY_FAILED',
        reason: 'Action unconfirmed after 2-hour reconciliation window. Flagged for review.',
      };
    }

    return {
      resolvedState: 'RESULT_UNKNOWN',
      reason: 'No matching provider object observed yet; waiting for next reconciliation cycle.',
    };
  }
}
