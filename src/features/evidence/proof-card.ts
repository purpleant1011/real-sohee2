/**
 * Canonical Proof Card Standard (ANI-814)
 * 
 * Invariants:
 * 1. Unified Proof Standard: Every WRITE/SPEND action must produce a deterministic ProofCard.
 * 2. Strict Provenance: Derived solely from canonical action_run and evidence records.
 * 3. Zero Mock/Fixture: Prohibits arbitrary UI placeholder values.
 */

export interface ProofCardApprovalInfo {
  required: boolean;
  approvedBy?: string;
  approvedAt?: string;
  charterId?: string;
  charterVersion?: string;
  isA3InheritedApproval?: boolean;
}

export interface ProofCardCreditInfo {
  estimated: number;
  settled: number;
  currency: 'SOHEE_CREDIT';
  planTier: string;
}

export interface ProofCardProviderObject {
  id: string;
  url: string;
  acceptedAt: string;
}

export interface ProofCardReadbackInfo {
  verifiedAt: string;
  hash: string;
  verificationMethod: string;
  status: 'VERIFIED' | 'MISMATCH' | 'NOT_FOUND';
}

export interface ProofCardOutcomeLineage {
  goalId?: string;
  missionId?: string;
  opportunityId?: string;
  kpiImpactSummary?: string;
}

export interface ProofCardData {
  actionRunId: string;
  evidenceId: string;
  workspaceId: string;
  purpose: string;
  pluginId: string;
  pluginVersion: string;
  capabilityId: string;
  provider: string;
  targetAccount: string;
  actionRiskTier: 'R0_LOW' | 'R1_MODERATE' | 'R2_CRITICAL';
  verificationState: 'EXTERNAL_VERIFIED' | 'RESULT_UNKNOWN' | 'VERIFY_FAILED';
  approval: ProofCardApprovalInfo;
  credits: ProofCardCreditInfo;
  providerObject: ProofCardProviderObject;
  readback: ProofCardReadbackInfo;
  outcomeLineage: ProofCardOutcomeLineage;
  reconciled?: boolean;
  reconciledAt?: string;
}

export interface ProofCardValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates that a ProofCard conforms to strict production provenance standards without fixture values.
 */
export function validateProofCardData(card: ProofCardData): ProofCardValidationResult {
  const errors: string[] = [];

  if (!card.actionRunId || card.actionRunId.startsWith('dummy') || card.actionRunId.startsWith('mock')) {
    errors.push('Invalid or mock actionRunId');
  }

  if (!card.evidenceId || card.evidenceId.startsWith('dummy') || card.evidenceId.startsWith('mock')) {
    errors.push('Invalid or mock evidenceId');
  }

  if (!card.workspaceId) {
    errors.push('workspaceId is missing');
  }

  if (!card.purpose || card.purpose.trim().length === 0) {
    errors.push('Action purpose description is required');
  }

  if (!card.providerObject?.id || !card.providerObject?.url) {
    errors.push('Authoritative provider object ID and URL are required');
  }

  if (card.verificationState === 'EXTERNAL_VERIFIED') {
    if (!card.readback?.hash || !card.readback?.verifiedAt) {
      errors.push('EXTERNAL_VERIFIED cards must include readback hash and verifiedAt timestamp');
    }
    if (card.readback.status !== 'VERIFIED') {
      errors.push('EXTERNAL_VERIFIED state requires readback.status to be VERIFIED');
    }
  }

  if (card.credits.settled < 0) {
    errors.push('Settled credits cannot be negative');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
