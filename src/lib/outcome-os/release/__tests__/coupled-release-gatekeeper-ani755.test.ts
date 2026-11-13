import { describe, it, expect } from 'vitest';
import { CoupledReleaseGatekeeper } from '../coupled-release-gatekeeper';
import type { ProductionReleaseEvidenceBundle } from '@/types/autonomous-outcome-os';

describe('ANI-755 Production Done Gate & Release State Machine', () => {
  const gatekeeper = new CoupledReleaseGatekeeper();

  const validBundle: ProductionReleaseEvidenceBundle = {
    issueId: 'ANI-755',
    commitSha: '546c13d64d30ac95d190e13ac3e6cf4382142754',
    gitCleanTree: true,
    ciWorkflowRunId: 'ci-run-12345',
    ciWorkflowStatus: 'SUCCESS',
    deployedProductionSha: '546c13d64d30ac95d190e13ac3e6cf4382142754',
    deployedEnvironment: 'production',
    authenticatedWorkspaceActor: {
      userId: 'usr_real_001',
      workspaceId: 'ws_real_001',
      accountRole: 'OWNER',
      isDemoSandbox: false,
    },
    authoritativeReceipt: {
      receiptId: 'rcpt_755_001',
      providerObjectId: 'post_meta_98765',
      externalUrl: 'https://instagram.com/p/DBxyz123',
      verifiedAt: new Date().toISOString(),
      verificationMethod: 'GRAPH_API_GET',
    },
    creditReconciliation: {
      reservedCredits: 100,
      settledCredits: 85,
      reconciledAt: new Date().toISOString(),
    },
    gateAttestationTimestamp: new Date().toISOString(),
    verifiedByAuditor: 'sohee-evidence-auditor',
    status: 'VERIFIED_DONE',
  };

  it('approves DONE when all production evidence criteria are met', () => {
    const result = gatekeeper.validateProductionDoneGate(validBundle);
    expect(result.isDoneAllowed).toBe(true);
    expect(result.finalState).toBe('DONE');
  });

  it('rejects DONE when commit SHA is invalid or short', () => {
    const invalid = { ...validBundle, commitSha: 'short' };
    const result = gatekeeper.validateProductionDoneGate(invalid);
    expect(result.isDoneAllowed).toBe(false);
    expect(result.reason).toContain('commitSha');
  });

  it('rejects DONE when git working tree is dirty', () => {
    const invalid = { ...validBundle, gitCleanTree: false };
    const result = gatekeeper.validateProductionDoneGate(invalid);
    expect(result.isDoneAllowed).toBe(false);
    expect(result.reason).toContain('clean');
  });

  it('rejects DONE when CI workflow failed', () => {
    const invalid = { ...validBundle, ciWorkflowStatus: 'FAILED' as const };
    const result = gatekeeper.validateProductionDoneGate(invalid);
    expect(result.isDoneAllowed).toBe(false);
    expect(result.reason).toContain('CI/Deploy');
  });

  it('rejects DONE for SHOWCASE_DEMO activity (Fail-Closed)', () => {
    const invalid = {
      ...validBundle,
      authenticatedWorkspaceActor: {
        ...validBundle.authenticatedWorkspaceActor,
        isDemoSandbox: true,
      },
    };
    const result = gatekeeper.validateProductionDoneGate(invalid);
    expect(result.isDoneAllowed).toBe(false);
    expect(result.reason).toContain('SHOWCASE_DEMO');
  });

  it('rejects DONE when authoritative receipt contains placeholder/fake URL', () => {
    const invalid = {
      ...validBundle,
      authoritativeReceipt: {
        ...validBundle.authoritativeReceipt,
        externalUrl: 'https://example.com/fake-post/123',
      },
    };
    const result = gatekeeper.validateProductionDoneGate(invalid);
    expect(result.isDoneAllowed).toBe(false);
    expect(result.reason).toContain('Placeholder or synthetic URL');
  });

  it('rejects DONE when deployment environment is not production', () => {
    const invalid = { ...validBundle, deployedEnvironment: 'staging' as const };
    const result = gatekeeper.validateProductionDoneGate(invalid);
    expect(result.isDoneAllowed).toBe(false);
    expect(result.reason).toContain('production');
  });

  it('correctly transitions forward through release states with evidence', () => {
    expect(gatekeeper.transitionReleaseState('CODE_COMPLETE', 'TESTED', true)).toBe('TESTED');
    expect(gatekeeper.transitionReleaseState('TESTED', 'RELEASE_READY', true)).toBe('RELEASE_READY');
    expect(gatekeeper.transitionReleaseState('RELEASE_READY', 'DEPLOYED', true)).toBe('DEPLOYED');
    expect(gatekeeper.transitionReleaseState('DEPLOYED', 'PRODUCTION_VERIFIED', true)).toBe('PRODUCTION_VERIFIED');
    expect(gatekeeper.transitionReleaseState('PRODUCTION_VERIFIED', 'DONE', true)).toBe('DONE');
  });

  it('prohibits skipping release lifecycle states', () => {
    expect(() => gatekeeper.transitionReleaseState('CODE_COMPLETE', 'RELEASE_READY', true)).toThrow(
      'Cannot skip release state'
    );
    expect(() => gatekeeper.transitionReleaseState('TESTED', 'DONE', true)).toThrow(
      'Cannot skip release state'
    );
  });

  it('blocks state advancement when evidence is missing', () => {
    expect(() => gatekeeper.transitionReleaseState('CODE_COMPLETE', 'TESTED', false)).toThrow(
      'without required evidence'
    );
  });
});
