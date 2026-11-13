/**
 * Production Verification Done Gatekeeper & Evidence Pack (ANI-776)
 * 
 * Enforces E0 / E1 / E2 Evidence Tier Verification and Service/Admin Same-Truth.
 * 
 * Invariants:
 * 1. CODE_COMPLETE ≠ VERIFIED ≠ RELEASE_READY ≠ DONE
 * 2. Service-Admin Same Truth: IDs must be 1:1 identical, synthetic fallbacks forbidden.
 * 3. Fail-Closed: Missing any evidence tier blocks transition to DONE.
 */

export interface E0StaticAndUnitEvidence {
  typescriptTypecheckPassed: boolean;
  unitTestsPassedCount: number;
  unitTestsFailedCount: number;
  testSuitesCount: number;
  verifiedAt: string;
}

export interface E1IntegrationReceiptEvidence {
  channelExecutionReceiptsVerified: boolean;
  circuitBreakerVerified: boolean;
  providerReadbackVerifiedCount: number;
  failedReadbackCount: number;
  verifiedAt: string;
}

export interface E2EndToEndCanaryEvidence {
  fullLineageTraceId: string;
  campaignId: string;
  actionId: string;
  authoritativeReceiptId: string;
  verifiedOutcomeRevenueKRW: number;
  attributedShareVerified: boolean;
  creditSettlementReceiptId: string;
  serviceAdminIdMatch: boolean;
  verifiedAt: string;
}

export interface ProductionEvidencePack {
  packId: string;
  releaseVersion: string;
  gitCommitSha: string;
  linearProjectKey: string;
  e0: E0StaticAndUnitEvidence;
  e1: E1IntegrationReceiptEvidence;
  e2: E2EndToEndCanaryEvidence;
  generatedAt: string;
}

export interface GateEvaluationResult {
  allowed: boolean;
  targetState: 'DONE' | 'RELEASE_READY' | 'REJECTED';
  reasons: string[];
  evidencePackId: string;
}

export class ProductionVerificationGatekeeper {
  public evaluateEvidencePack(pack: ProductionEvidencePack): GateEvaluationResult {
    const reasons: string[] = [];

    // E0 Validation
    if (!pack.e0.typescriptTypecheckPassed) {
      reasons.push('E0 Failure: TypeScript typecheck has not passed or was skipped');
    }
    if (pack.e0.unitTestsFailedCount > 0 || pack.e0.unitTestsPassedCount === 0) {
      reasons.push(`E0 Failure: Unit tests failing (${pack.e0.unitTestsFailedCount}) or 0 passed`);
    }

    // E1 Validation
    if (!pack.e1.channelExecutionReceiptsVerified) {
      reasons.push('E1 Failure: Channel execution receipts are unverified or missing authoritative readback');
    }
    if (!pack.e1.circuitBreakerVerified) {
      reasons.push('E1 Failure: Provider Circuit Breaker test suite did not verify fail-closed invariants');
    }
    if (pack.e1.failedReadbackCount > 0) {
      reasons.push(`E1 Failure: Detected ${pack.e1.failedReadbackCount} failed external readbacks`);
    }

    // E2 Validation
    if (!pack.e2.serviceAdminIdMatch) {
      reasons.push('E2 Failure: Service-Admin Same Truth check failed! Mismatched lineage IDs detected');
    }
    if (!pack.e2.attributedShareVerified) {
      reasons.push('E2 Failure: End-to-end attribution lineage share was not verified');
    }
    if (!pack.e2.authoritativeReceiptId || !pack.e2.creditSettlementReceiptId) {
      reasons.push('E2 Failure: Missing end-to-end authoritative execution or settlement receipt IDs');
    }

    if (reasons.length > 0) {
      return {
        allowed: false,
        targetState: 'REJECTED',
        reasons,
        evidencePackId: pack.packId,
      };
    }

    return {
      allowed: true,
      targetState: 'DONE',
      reasons: ['All E0, E1, E2 evidence tiers validated successfully under Service-Admin Same Truth'],
      evidencePackId: pack.packId,
    };
  }
}
