import { describe, expect, it } from 'vitest';
import { WingStackControlTower } from '../control-tower/wing-stack-control-tower';
import { ProviderCircuitBreakerRegistry } from '../../channel-execution/core/provider-circuit-breaker';
import { AdminCreditOperationsCenter } from '../credits/admin-credit-operations-center';
import { WeeklyCreditCycleEngine } from '../../outcome-os/commercial/weekly-credit-cycle-engine';
import { ProductionVerificationGatekeeper, ProductionEvidencePack } from '../verification/production-verification-gatekeeper';

describe('Wave 5 Admin Ops & Production Verification Gatekeeper', () => {
  describe('ANI-775: WingStackControlTower', () => {
    it('manages third-party component registry and enforces privileged audit trail', () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const tower = new WingStackControlTower(cb);

      const components = tower.getAllComponents();
      expect(components.length).toBeGreaterThanOrEqual(6);

      const postiz = tower.getComponent('postiz');
      expect(postiz?.license).toBe('AGPL-3.0');
      expect(postiz?.health).toBe('OK');

      // Update health on simulated outage
      tower.updateComponentHealth('postiz', 'DOWN', 'Cloudflare egress connection timeout');
      expect(tower.getComponent('postiz')?.isExecutable).toBe(false);
      expect(tower.getComponent('postiz')?.lastErrorMessage).toContain('Cloudflare egress');

      // Privileged Kill Switch
      tower.executePrivilegedKillSwitch('CHANNEL', 'instagram', 'Urgent spam incident reported', 'admin-hocheol');
      expect(cb.checkExecutionAllowed('instagram', 'postiz').allowed).toBe(false);

      const logs = tower.getAuditLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].adminActorId).toBe('admin-hocheol');
      expect(logs[0].reason).toBe('Urgent spam incident reported');

      // Release
      tower.executePrivilegedReleaseKillSwitch('CHANNEL', 'instagram', 'Incident resolved', 'admin-hocheol');
      expect(cb.checkExecutionAllowed('instagram', 'postiz').allowed).toBe(true);
      expect(tower.getAuditLogs()).toHaveLength(2);
    });

    it('rejects privileged operations without a valid reason', () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const tower = new WingStackControlTower(cb);

      expect(() => {
        tower.executePrivilegedKillSwitch('GLOBAL', 'all', '', 'admin-actor');
      }).toThrow('Reason is mandatory');
    });
  });

  describe('ANI-794: AdminCreditOperationsCenter', () => {
    it('records manual bonus adjustments immutably with audit details', () => {
      const engine = new WeeklyCreditCycleEngine();
      const adminCenter = new AdminCreditOperationsCenter(engine);

      adminCenter.initWorkspaceCycle('ws-store', 'ent-1', 'TIER_150K_STARTER');
      const record = adminCenter.grantBonusCredits('ws-store', 500, 30, 'Customer satisfaction compensation', 'admin-hocheol');

      expect(record.amountCredits).toBe(500);
      expect(record.appliedCycleSnapshot.bonusRemainingCredits).toBe(500);

      const logs = adminCenter.getAdjustments();
      expect(logs).toHaveLength(1);
      expect(logs[0].adminActorId).toBe('admin-hocheol');
    });

    it('enforces Overfill 0 invariant during RESET_PASS', () => {
      const engine = new WeeklyCreditCycleEngine();
      const adminCenter = new AdminCreditOperationsCenter(engine);

      // Starter tier allowance = 1500 credits
      const cycle = adminCenter.initWorkspaceCycle('ws-store-2', 'ent-2', 'TIER_150K_STARTER');
      expect(cycle.remainingBaseCredits).toBe(1500);

      // Consume 600 credits -> 900 remaining
      const deductRes = adminCenter.deductCredits('ws-store-2', 600);
      expect(deductRes.success).toBe(true);
      expect(adminCenter.getWorkspaceCycle('ws-store-2')?.remainingBaseCredits).toBe(900);

      // Apply RESET_PASS -> must refill exactly to 1500 (allowance), never overfill
      const afterPass = adminCenter.applyResetPass('ws-store-2', 'pass-100', 'admin-hocheol', 'Monthly promo refill pass');
      expect(afterPass.remainingBaseCredits).toBe(1500);
    });

    it('detects abnormal credit burn and triggers alert', () => {
      const engine = new WeeklyCreditCycleEngine();
      const adminCenter = new AdminCreditOperationsCenter(engine);

      const alert = adminCenter.checkAbnormalBurn('ws-store-3', 15_000, 5_000);
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe('CRITICAL');
      expect(adminCenter.getBurnAlerts()).toHaveLength(1);
    });
  });

  describe('ANI-776: ProductionVerificationGatekeeper', () => {
    const validEvidencePack: ProductionEvidencePack = {
      packId: 'pack-v09-3rd-rev',
      releaseVersion: 'v0.9.3-full-marketing-agent',
      gitCommitSha: 'sha-c09d7c0',
      linearProjectKey: 'ANI-755-ANI-795',
      e0: {
        typescriptTypecheckPassed: true,
        unitTestsPassedCount: 65,
        unitTestsFailedCount: 0,
        testSuitesCount: 6,
        verifiedAt: '2026-09-05T15:00:00Z',
      },
      e1: {
        channelExecutionReceiptsVerified: true,
        circuitBreakerVerified: true,
        providerReadbackVerifiedCount: 9,
        failedReadbackCount: 0,
        verifiedAt: '2026-09-05T15:00:00Z',
      },
      e2: {
        fullLineageTraceId: 'trace-full-e2e-001',
        campaignId: 'camp-real-sohee-launch',
        actionId: 'act-meta-post-01',
        authoritativeReceiptId: 'rcpt-postiz-meta-001',
        verifiedOutcomeRevenueKRW: 150_000,
        attributedShareVerified: true,
        creditSettlementReceiptId: 'settle-credits-001',
        serviceAdminIdMatch: true,
        verifiedAt: '2026-09-05T15:00:00Z',
      },
      generatedAt: '2026-09-05T15:00:00Z',
    };

    it('approves DONE when all E0, E1, E2 tiers and Same-Truth match', () => {
      const gatekeeper = new ProductionVerificationGatekeeper();
      const result = gatekeeper.evaluateEvidencePack(validEvidencePack);

      expect(result.allowed).toBe(true);
      expect(result.targetState).toBe('DONE');
      expect(result.reasons[0]).toContain('validated successfully');
    });

    it('fails closed when E0 static typecheck failed', () => {
      const gatekeeper = new ProductionVerificationGatekeeper();
      const defective = {
        ...validEvidencePack,
        e0: { ...validEvidencePack.e0, typescriptTypecheckPassed: false },
      };
      const result = gatekeeper.evaluateEvidencePack(defective);

      expect(result.allowed).toBe(false);
      expect(result.targetState).toBe('REJECTED');
      expect(result.reasons.some(r => r.includes('E0 Failure'))).toBe(true);
    });

    it('fails closed when Service-Admin Same Truth check fails', () => {
      const gatekeeper = new ProductionVerificationGatekeeper();
      const defective = {
        ...validEvidencePack,
        e2: { ...validEvidencePack.e2, serviceAdminIdMatch: false },
      };
      const result = gatekeeper.evaluateEvidencePack(defective);

      expect(result.allowed).toBe(false);
      expect(result.targetState).toBe('REJECTED');
      expect(result.reasons.some(r => r.includes('Same Truth check failed'))).toBe(true);
    });
  });
});
