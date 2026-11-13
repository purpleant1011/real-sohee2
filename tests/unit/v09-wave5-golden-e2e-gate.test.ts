/**
 * Sohee V0.9 5th Update · Wave 5 QA Unit Tests
 * 10 Golden Paths & Release Gate Verification
 * 
 * Traceability: ANI-926
 */

import { describe, it, expect } from 'vitest';
import { GoldenE2EReleaseGate } from '@/features/qa/golden-e2e-release-gate';

describe('V0.9 Wave 5 · GoldenE2EReleaseGate (ANI-926)', () => {
  const gate = new GoldenE2EReleaseGate();

  it('executes and validates all 10 Golden Paths with tenant separation', () => {
    const results = gate.execute10GoldenPaths();
    expect(results.length).toBe(10);

    const pathIds = results.map(r => r.pathId);
    expect(pathIds).toContain('EMPTY_TRUTH');
    expect(pathIds).toContain('PLUGIN_READY');
    expect(pathIds).toContain('CHAT_CONTENT_PUBLISH');
    expect(pathIds).toContain('CHAT_ADS');
    expect(pathIds).toContain('CUSTOMER_BOOKING');
    expect(pathIds).toContain('RUNTIME_PAUSE');
    expect(pathIds).toContain('RESULT_UNKNOWN');
    expect(pathIds).toContain('ZERO_CREDIT');
    expect(pathIds).toContain('AUTH_EXPIRY');
    expect(pathIds).toContain('GOAL_CLOSED_LOOP');

    for (const r of results) {
      expect(r.passed).toBe(true);
      expect(r.evidenceId).toBeTruthy();
      expect(['P-ACTUAL-CANARY', 'P-EMPTY', 'P-DEMO']).toContain(r.tenant);
    }
  });

  it('fails safe (SAFE_FAIL_CLOSED) across all 6 critical failure injection vectors', () => {
    const cases = gate.executeFailureInjections();
    expect(cases.length).toBe(6);

    for (const c of cases) {
      expect(c.passed).toBe(true);
      expect(c.actualStatus).toBe('SAFE_FAIL_CLOSED');
    }
  });

  it('enforces fail-closed 8-step release gate lifecycle: blocks Done until all steps are verified', () => {
    // 1. Blocked at TESTED if tests not passed
    const testedRes = gate.evaluateReleaseGate({
      isCodeComplete: true,
      isTested: false,
      isIntegrationVerified: false,
      isDeployed: false,
      isProductionSmokePassed: false,
      isExternalVerified: false,
      isSameTruthVerified: false,
    });
    expect(testedRes.currentStage).toBe('TESTED');
    expect(testedRes.canReleaseToDone).toBe(false);

    // 2. Blocked at EXTERNAL_VERIFIED if external verify incomplete
    const extRes = gate.evaluateReleaseGate({
      isCodeComplete: true,
      isTested: true,
      isIntegrationVerified: true,
      isDeployed: true,
      isProductionSmokePassed: true,
      isExternalVerified: false,
      isSameTruthVerified: false,
    });
    expect(extRes.currentStage).toBe('EXTERNAL_VERIFIED');
    expect(extRes.canReleaseToDone).toBe(false);
    expect(extRes.blockerReason).toContain('외부 프로바이더 독립 재조회 검증 미완료');

    // 3. Fully passes to DONE only when all gates are green
    const doneRes = gate.evaluateReleaseGate({
      isCodeComplete: true,
      isTested: true,
      isIntegrationVerified: true,
      isDeployed: true,
      isProductionSmokePassed: true,
      isExternalVerified: true,
      isSameTruthVerified: true,
    });
    expect(doneRes.currentStage).toBe('DONE');
    expect(doneRes.canReleaseToDone).toBe(true);
  });

  it('generates a real SHA-256 payload digest evidence bundle linking commit, workspace, session, action, and ledger IDs', () => {
    const bundle = gate.createEvidenceBundle({
      commitHash: '41a82f8',
      workspaceId: 'ws_actual_gangnam_derm',
      sessionId: 'sess_master_001',
      actionRunId: 'act_run_golden_001',
      providerPostId: 'meta_post_1002931',
      ledgerId: 'ldg_credit_settle_001',
    });

    expect(bundle.bundleId).toBeTruthy();
    expect(bundle.commitHash).toBe('41a82f8');
    expect(bundle.evidenceId).toBe('ev_golden_act_run_golden_001');
    expect(bundle.cryptographicSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.payloadDigest).toBe(bundle.cryptographicSignature);
  });

  it('fails closed when evaluateReleaseGate receives malformed or missing parameters', () => {
    // @ts-expect-error test null params
    const nullRes = gate.evaluateReleaseGate(null);
    expect(nullRes.canReleaseToDone).toBe(false);
    expect(nullRes.currentStage).toBe('CODE_COMPLETE');

    // Partial params with missing booleans
    // @ts-expect-error test partial params
    const partialRes = gate.evaluateReleaseGate({ isCodeComplete: true });
    expect(partialRes.canReleaseToDone).toBe(false);
    expect(partialRes.currentStage).toBe('TESTED');
  });
});
