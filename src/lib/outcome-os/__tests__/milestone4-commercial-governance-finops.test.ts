import { describe, it, expect, vi } from 'vitest';
import {
  CommercialEnergyEngine,
  COMMERCIAL_TIERS,
} from '../commercial/commercial-energy-engine';
import {
  TrialWowEngine,
} from '../commercial/trial-wow-engine';
import {
  TenantIsolationGuard,
  TenantIsolationViolationError,
} from '../governance/tenant-isolation-guard';
import {
  ProfitabilityMarginEngine,
} from '../finops/profitability-margin-engine';
import {
  OperatorAuditVault,
} from '../governance/operator-audit-vault';

describe('Milestone 4: Commercial, Trial WOW, Security Governance & FinOps (ANI-679, ANI-680, ANI-694, ANI-695, ANI-696)', () => {
  const mockWorkspaceId = 'ws_m4_test_01';

  describe('ANI-679: 4-Tier Commercial Model & Energy Top-up Engine', () => {
    it('initializes correct energy allocations across commercial tiers', () => {
      const growthPlan = CommercialEnergyEngine.createSubscription({
        workspaceId: mockWorkspaceId,
        tier: 'TIER_300K_GROWTH',
      });
      expect(growthPlan.monthlyTotalEnergy).toBe(3000);
      expect(growthPlan.priceKrw).toBe(300000);

      const starterPlan = CommercialEnergyEngine.createSubscription({
        workspaceId: 'ws_starter',
        tier: 'TIER_150K_STARTER',
      });
      expect(starterPlan.monthlyTotalEnergy).toBe(1500);
      expect(starterPlan.priceKrw).toBe(150000);

      const scalePlan = CommercialEnergyEngine.createSubscription({
        workspaceId: 'ws_scale',
        tier: 'TIER_500K_PRO_SCALE',
      });
      expect(scalePlan.monthlyTotalEnergy).toBe(5000);
      expect(scalePlan.priceKrw).toBe(500000);
    });

    it('processes idempotent energy top-up packs correctly', () => {
      const engine = new CommercialEnergyEngine();
      const initialLedger = engine.initLedger(mockWorkspaceId, 'TIER_300K_GROWTH');
      expect(initialLedger.monthlyTotalEnergy).toBe(3000);
      expect(initialLedger.remainingAvailableEnergy).toBe(3000);

      // Top up 1 pack (100,000 KRW = 1,000 Energy)
      const topUpResult = engine.processTopUp({
        workspaceId: mockWorkspaceId,
        transactionId: 'tx_topup_001',
        packCount: 1,
        paidAmountKrw: 100000,
      });

      expect(topUpResult.success).toBe(true);
      expect(topUpResult.addedEnergy).toBe(1000);
      expect(topUpResult.ledger.monthlyTotalEnergy).toBe(4000);
      expect(topUpResult.ledger.remainingAvailableEnergy).toBe(4000);

      // Duplicate top-up with same transactionId should be rejected idempotently
      const duplicateResult = engine.processTopUp({
        workspaceId: mockWorkspaceId,
        transactionId: 'tx_topup_001',
        packCount: 1,
        paidAmountKrw: 100000,
      });

      expect(duplicateResult.success).toBe(false);
      expect(duplicateResult.message).toContain('Duplicate transaction');
      expect(duplicateResult.ledger.monthlyTotalEnergy).toBe(4000); // Not added twice
    });
  });

  describe('ANI-680: 48-Hour Trial WOW Engine', () => {
    it('manages trial countdown and captures first verified external outcome within 48h', () => {
      const wowEngine = new TrialWowEngine();
      const trial = wowEngine.startTrial({
        workspaceId: mockWorkspaceId,
        trialDurationHours: 48,
      });

      expect(trial.wowStatus).toBe('IN_PROGRESS');
      expect(trial.hoursRemaining).toBe(48);
      expect(trial.hasDeliveredFirstOutcome).toBe(false);

      // Deliver first verified external outcome receipt
      const updatedTrial = wowEngine.recordVerifiedOutcome({
        workspaceId: mockWorkspaceId,
        receiptId: 'rcpt_meta_live_first_wow',
        metricType: 'INSTAGRAM_RESERVATION_LEAD',
        deliveredAtHour: 14, // delivered in 14 hours
      });

      expect(updatedTrial.wowStatus).toBe('DELIVERED');
      expect(updatedTrial.hasDeliveredFirstOutcome).toBe(true);
      expect(updatedTrial.firstOutcomeReceiptId).toBe('rcpt_meta_live_first_wow');
      expect(updatedTrial.deliveredInHours).toBe(14);
    });

    it('flags EXPIRED_WARNING if 48h elapses without verified external outcome', () => {
      const wowEngine = new TrialWowEngine();
      wowEngine.startTrial({
        workspaceId: 'ws_expired_trial',
        trialDurationHours: 48,
      });

      const evaluated = wowEngine.evaluateTrialStatus('ws_expired_trial', 50); // 50 hours elapsed
      expect(evaluated.wowStatus).toBe('EXPIRED_WARNING');
      expect(evaluated.hasDeliveredFirstOutcome).toBe(false);
    });
  });

  describe('ANI-694: Multi-Tenant Isolation & Least Privilege Guardrails', () => {
    it('allows access within the same tenant and strictly blocks cross-tenant access', () => {
      const guard = new TenantIsolationGuard();

      // Valid tenant access
      expect(() => {
        guard.enforceTenantBoundary({
          actorWorkspaceId: 'ws_tenant_A',
          resourceWorkspaceId: 'ws_tenant_A',
          action: 'READ_HARNESS',
        });
      }).not.toThrow();

      // Cross-tenant access attempt must throw TenantIsolationViolationError
      expect(() => {
        guard.enforceTenantBoundary({
          actorWorkspaceId: 'ws_tenant_A',
          resourceWorkspaceId: 'ws_tenant_B',
          action: 'WRITE_PROPOSAL',
        });
      }).toThrow(TenantIsolationViolationError);
    });

    it('masks PII and secrets before emitting audit/admin logs', () => {
      const guard = new TenantIsolationGuard();
      const sensitiveData = {
        token: 'EAABwzLixnjYBA1234567890abcdef',
        phone: '010-1234-5678',
        rrn: '900101-1234567',
        regularMessage: '정상적인 피드 게시글입니다.',
      };

      const masked = guard.maskSensitiveData(sensitiveData);
      expect(masked.token).toBe('EAABwz***cdef');
      expect(masked.phone).toBe('010-****-5678');
      expect(masked.rrn).toBe('900101-*******');
      expect(masked.regularMessage).toBe('정상적인 피드 게시글입니다.');
    });
  });

  describe('ANI-695: FinOps Profitability & Margin Guard Engine', () => {
    it('evaluates gross margin % and flags NEGATIVE_MARGIN_RISK when infra cost surges', () => {
      const finops = new ProfitabilityMarginEngine();

      // Healthy margin scenario: 300,000 KRW revenue, 30,000 KRW infra cost (90% margin)
      const healthyEval = finops.evaluateWorkspaceMargin({
        workspaceId: mockWorkspaceId,
        revenueKrw: 300000,
        costs: {
          llmTokensKrw: 20000,
          cloudflareWorkersKrw: 5000,
          mcpExecutionKrw: 5000,
        },
      });

      expect(healthyEval.grossMarginPercentage).toBe(90);
      expect(healthyEval.healthStatus).toBe('HEALTHY');
      expect(healthyEval.throttleRecommended).toBe(false);

      // Surge cost scenario: 300,000 KRW revenue, 270,000 KRW infra cost (10% margin < 30%)
      const surgeEval = finops.evaluateWorkspaceMargin({
        workspaceId: 'ws_runaway_costs',
        revenueKrw: 300000,
        costs: {
          llmTokensKrw: 240000,
          cloudflareWorkersKrw: 15000,
          mcpExecutionKrw: 15000,
        },
      });

      expect(surgeEval.grossMarginPercentage).toBe(10);
      expect(surgeEval.healthStatus).toBe('NEGATIVE_MARGIN_RISK');
      expect(surgeEval.throttleRecommended).toBe(true);
    });
  });

  describe('ANI-696: Remote Browser & Operator Access Audit Vault', () => {
    it('logs operator session, enforces session termination and token revocation', async () => {
      const vault = new OperatorAuditVault();

      const session = vault.startOperatorSession({
        operatorId: 'admin_security_lead',
        workspaceId: mockWorkspaceId,
        reason: '고객 채널 연동 장애 긴급 진단',
        activeBrowserSessionIds: ['sess_browser_99'],
        providerTokensToRevokeOnClose: [
          { provider: 'instagram', accessToken: 'mock_meta_token_123' },
        ],
      });

      expect(session.sessionId).toBeDefined();
      expect(session.isActive).toBe(true);

      // Close session and verify auto-termination
      const closure = await vault.terminateOperatorSession(session.sessionId);
      expect(closure.success).toBe(true);
      expect(closure.terminatedBrowserSessions[0].success).toBe(true);
      expect(closure.revokedProviderTokens[0].success).toBe(true);
      expect(closure.auditReceiptHash).toBeDefined();
    });
  });
});
