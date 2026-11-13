import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegratedFinOpsEngine } from '@/lib/finops/integrated-finops-engine';

// ANI-1753: IntegratedFinOpsEngine 이 원장 동기화를 fire-and-forget 으로 DB 에 쓴다.
// 대역이 없으면 그 백그라운드 요청이 실패해 unhandled rejection 이 되고,
// 모든 테스트가 통과해도 vitest 프로세스가 exit 1 로 끝난다.
vi.mock('@/lib/supabase/server', async () =>
  (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule(),
);
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule());

describe('ANI-924: FinOps Credit Reserve/Settle & External Ad Spend Ledger Integration', () => {
  const workspaceId = 'ws_finops_demo';

  beforeEach(() => {
    IntegratedFinOpsEngine._reset();
  });

  describe('1. Insufficient Balance Protection (Zero Provider Calls)', () => {
    it('should strictly block execution when workspace has insufficient credits', () => {
      // Current balance is 0
      const quote = IntegratedFinOpsEngine.issueQuote({
        workspaceId,
        actionType: 'CONTENT_PUBLISH',
        baseCredits: 10,
      });

      const reserveResult = IntegratedFinOpsEngine.reserveCredits({
        quote,
        actionRunId: 'act_blocked_run',
        idempotencyKey: 'idemp_insufficient_001',
      });

      expect(reserveResult.allowed).toBe(false);
      expect(reserveResult.reservation).toBeUndefined();
      expect(reserveResult.reason).toContain('크레딧이 부족합니다');
      expect(reserveResult.currentAvailableCredits).toBe(0);

      // Verify no reservation created
      expect(IntegratedFinOpsEngine.getWorkspaceBalance(workspaceId)).toBe(0);
    });
  });

  describe('2. Normal Lifecycle: Quote -> Reserve -> Settle (Full Chain)', () => {
    it('should link quote_id, action_run_id, reservation_id, settlement_id with balance invariant', () => {
      // Step 0: Grant initial credits (100 SC)
      IntegratedFinOpsEngine.grantCredits({
        workspaceId,
        amount: 100,
        reason: '주간 기본 크레딧 지급',
        idempotencyKey: 'idemp_grant_100',
      });
      expect(IntegratedFinOpsEngine.getWorkspaceBalance(workspaceId)).toBe(100);

      // Step 1: Issue Quote
      const quote = IntegratedFinOpsEngine.issueQuote({
        workspaceId,
        actionType: 'CONTENT_PUBLISH',
        baseCredits: 10,
      });
      expect(quote.quoteId.startsWith('quote_')).toBe(true);
      expect(quote.requiredCredits).toBe(10);

      // Step 2: Reserve Credits (100 -> 90)
      const reserveResult = IntegratedFinOpsEngine.reserveCredits({
        quote,
        actionRunId: 'act_run_normal_001',
        idempotencyKey: 'idemp_normal_resv_001',
      });

      expect(reserveResult.allowed).toBe(true);
      const resv = reserveResult.reservation!;
      expect(resv.reservationId.startsWith('resv_')).toBe(true);
      expect(resv.quoteId).toBe(quote.quoteId);
      expect(resv.actionRunId).toBe('act_run_normal_001');
      expect(resv.balanceBefore).toBe(100);
      expect(resv.balanceAfter).toBe(90);
      expect(IntegratedFinOpsEngine.getWorkspaceBalance(workspaceId)).toBe(90);

      // Step 3: Action Succeeded -> Final Settle
      const settlement = IntegratedFinOpsEngine.settleAction({
        reservationId: resv.reservationId,
        actionStatus: 'EXTERNAL_VERIFIED',
      });

      expect(settlement.settlementId.startsWith('stl_')).toBe(true);
      expect(settlement.reservationId).toBe(resv.reservationId);
      expect(settlement.actionRunId).toBe('act_run_normal_001');
      expect(settlement.status).toBe('SETTLED');
      expect(settlement.finalSettledCredits).toBe(10);
      expect(settlement.releasedCredits).toBe(0);
      expect(settlement.balanceAfter).toBe(90);

      // Same Truth Verification
      const fetchedResv = IntegratedFinOpsEngine.getReservation(resv.reservationId);
      expect(fetchedResv?.state).toBe('SETTLED');
      const fetchedStl = IntegratedFinOpsEngine.getSettlement(settlement.settlementId);
      expect(fetchedStl?.settlementId).toBe(settlement.settlementId);
    });
  });

  describe('3. Failure & Refund Policy: Provider Failure -> Full Release', () => {
    it('should refund 100% of reserved credits when provider rejects the action', () => {
      IntegratedFinOpsEngine.grantCredits({
        workspaceId,
        amount: 50,
        reason: '테스트 충전',
        idempotencyKey: 'idemp_grant_50',
      });

      const quote = IntegratedFinOpsEngine.issueQuote({
        workspaceId,
        actionType: 'AD_BID_ADJUST',
        baseCredits: 20,
      });

      // Reserve: 50 -> 30
      const reserveResult = IntegratedFinOpsEngine.reserveCredits({
        quote,
        actionRunId: 'act_run_fail_002',
        idempotencyKey: 'idemp_fail_resv_002',
      });
      expect(reserveResult.currentAvailableCredits).toBe(30);

      // Provider Failure -> Settle with PROVIDER_REJECTED
      const settlement = IntegratedFinOpsEngine.settleAction({
        reservationId: reserveResult.reservation!.reservationId,
        actionStatus: 'PROVIDER_REJECTED',
        reason: 'Provider 403 Forbidden: Token Expired',
      });

      expect(settlement.status).toBe('RELEASED_FULL');
      expect(settlement.releasedCredits).toBe(20);
      expect(settlement.finalSettledCredits).toBe(0);

      // Arithmetic invariant: balance restored back to 50
      expect(settlement.balanceAfter).toBe(50);
      expect(IntegratedFinOpsEngine.getWorkspaceBalance(workspaceId)).toBe(50);
    });
  });

  describe('4. RESULT_UNKNOWN Policy: Hold For Reconcile', () => {
    it('should hold reservation in HELD_FOR_RECONCILE on RESULT_UNKNOWN without blind refund or charge', () => {
      IntegratedFinOpsEngine.grantCredits({
        workspaceId,
        amount: 80,
        reason: '테스트 충전',
        idempotencyKey: 'idemp_grant_80',
      });

      const quote = IntegratedFinOpsEngine.issueQuote({
        workspaceId,
        actionType: 'CONTENT_PUBLISH',
        baseCredits: 15,
      });

      const reserveResult = IntegratedFinOpsEngine.reserveCredits({
        quote,
        actionRunId: 'act_run_timeout_003',
        idempotencyKey: 'idemp_timeout_resv_003',
      });

      // Settle with RESULT_UNKNOWN
      const settlement = IntegratedFinOpsEngine.settleAction({
        reservationId: reserveResult.reservation!.reservationId,
        actionStatus: 'RESULT_UNKNOWN',
      });

      expect(settlement.status).toBe('HELD_FOR_RECONCILE');
      expect(settlement.finalSettledCredits).toBe(0);
      expect(settlement.releasedCredits).toBe(0);
      // Balance remains at 65 (reserved amount held)
      expect(IntegratedFinOpsEngine.getWorkspaceBalance(workspaceId)).toBe(65);
    });
  });

  describe('5. External Ad Spend Ledger (KRW Segregation & Readback Reconciliation)', () => {
    it('should maintain external ad spend in KRW and reconcile authorized vs observed spend', () => {
      // Authorize 50,000 KRW for Meta Ads
      const spendEntry = IntegratedFinOpsEngine.authorizeExternalAdSpend({
        workspaceId,
        actionRunId: 'act_run_ad_004',
        campaignId: 'cmp_meta_spring_sale',
        platform: 'META_ADS',
        authorizedAmountKrw: 50000,
        notes: '봄맞이 프로모션 캠페인',
      });

      expect(spendEntry.spendId.startsWith('adspd_')).toBe(true);
      expect(spendEntry.platform).toBe('META_ADS');
      expect(spendEntry.authorizedAmountKrw).toBe(50000);
      expect(spendEntry.reconcileStatus).toBe('PENDING_READBACK');

      // Provider Readback: Actual spend was 48,500 KRW
      const reconciled = IntegratedFinOpsEngine.reconcileExternalAdSpend({
        spendId: spendEntry.spendId,
        observedSpendKrw: 48500,
      });

      expect(reconciled.reconcileStatus).toBe('MATCHED');
      expect(reconciled.observedSpendKrw).toBe(48500);
      expect(reconciled.varianceKrw).toBe(1500); // 1,500 KRW under budget
    });

    it('should trigger DISCREPANCY_ALERT if provider observed spend exceeds authorized budget', () => {
      const spendEntry = IntegratedFinOpsEngine.authorizeExternalAdSpend({
        workspaceId,
        actionRunId: 'act_run_ad_overspend',
        campaignId: 'cmp_google_search',
        platform: 'GOOGLE_ADS',
        authorizedAmountKrw: 30000,
      });

      // Observed 35,000 KRW (over budget)
      const reconciled = IntegratedFinOpsEngine.reconcileExternalAdSpend({
        spendId: spendEntry.spendId,
        observedSpendKrw: 35000,
      });

      expect(reconciled.reconcileStatus).toBe('DISCREPANCY_ALERT');
      expect(reconciled.notes).toContain('초과 집행 경고');
      expect(reconciled.varianceKrw).toBe(-5000);
    });
  });

  describe('6. Full FinOps Chain Cryptographic & Arithmetic Integrity', () => {
    it('should verify single-directional audit hash chain and balance arithmetic for entire workspace', () => {
      IntegratedFinOpsEngine.grantCredits({
        workspaceId: 'ws_audit_test',
        amount: 200,
        reason: '초기 충전',
        idempotencyKey: 'idemp_audit_grant',
      });

      const quote1 = IntegratedFinOpsEngine.issueQuote({ workspaceId: 'ws_audit_test', actionType: 'CONTENT_PUBLISH', baseCredits: 10 });
      const resv1 = IntegratedFinOpsEngine.reserveCredits({ quote: quote1, actionRunId: 'run_1', idempotencyKey: 'resv_key_1' });
      IntegratedFinOpsEngine.settleAction({ reservationId: resv1.reservation!.reservationId, actionStatus: 'EXTERNAL_VERIFIED' });

      const quote2 = IntegratedFinOpsEngine.issueQuote({ workspaceId: 'ws_audit_test', actionType: 'POST_REPLY', baseCredits: 5 });
      const resv2 = IntegratedFinOpsEngine.reserveCredits({ quote: quote2, actionRunId: 'run_2', idempotencyKey: 'resv_key_2' });
      IntegratedFinOpsEngine.settleAction({ reservationId: resv2.reservation!.reservationId, actionStatus: 'FAILED' });

      // Integrity Check: all entries must pass hash check and arithmetic check
      const integrity = IntegratedFinOpsEngine.verifyFinOpsIntegrity('ws_audit_test');
      expect(integrity.isValid).toBe(true);
      expect(integrity.chainIntegrity).toBe(true);
      expect(integrity.currentBalance).toBe(190); // 200 - 10 settled, 5 refunded back
    });
  });
});
