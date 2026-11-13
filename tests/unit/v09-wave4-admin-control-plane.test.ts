/**
 * Sohee V0.9 5th Update · Wave 4 Admin Unit Tests
 * Customer360 · Incident Center · Outcome SLOs · Privileged Support Verification
 * 
 * Traceability: ANI-933
 */

import { describe, it, expect } from 'vitest';
import { AdminControlPlaneService } from '@/lib/admin/admin-control-plane-service';

describe('V0.9 Wave 4 · AdminControlPlaneService (ANI-933)', () => {
  it('enforces strict dataset separation between ACTUAL and SHOWCASE_DEMO', () => {
    const service = new AdminControlPlaneService();

    const actualRecords = service.listCustomer360('ACTUAL');
    const demoRecords = service.listCustomer360('SHOWCASE_DEMO');

    expect(actualRecords.length).toBeGreaterThan(0);
    expect(demoRecords.length).toBeGreaterThan(0);

    for (const r of actualRecords) {
      expect(r.datasetMode).toBe('ACTUAL');
      expect(r.idChain.firstVerifiedActionId).toBeDefined();
    }

    for (const r of demoRecords) {
      expect(r.datasetMode).toBe('SHOWCASE_DEMO');
    }
  });

  it('validates canonical ID chain and 8-step activation timeline in Customer360', () => {
    const service = new AdminControlPlaneService();
    const actual = service.getCustomer360('ws_actual_gangnam_derm');

    expect(actual).not.toBeNull();
    expect(actual?.idChain.identityId).toBe('usr_owner_gangnam_01');
    expect(actual?.idChain.businessId).toBe('biz_120_88_99881');
    expect(actual?.idChain.workspaceId).toBe('ws_actual_gangnam_derm');
    expect(actual?.idChain.planId).toBe('plan_scale_monthly');
    expect(actual?.idChain.firstVerifiedActionId).toBe('act_run_vwrite_001');
    expect(actual?.idChain.firstBookingId).toBe('bk_rev_canary_001');
    expect(actual?.idChain.firstRevenueEventId).toBe('rev_ev_actual_001');

    expect(actual?.activationTimeline.length).toBe(8);
    expect(actual?.activationTimeline[0].step).toBe('IDENTITY_CREATED');
    expect(actual?.activationTimeline[7].step).toBe('FIRST_REVENUE_VERIFIED');
    expect(actual?.activationTimeline[7].verified).toBe(true);
  });

  it('manages P0/P1 incidents with affected workspaces, providers, impact, and mitigation', () => {
    const service = new AdminControlPlaneService();
    const incidents = service.listActiveIncidents();

    expect(incidents.length).toBeGreaterThan(0);
    const p1 = incidents[0];

    expect(p1.severity).toBe('P1');
    expect(p1.affectedWorkspaceIds).toContain('ws_actual_gangnam_derm');
    expect(p1.affectedProviders).toContain('meta_ads');
    expect(p1.customerImpactDescription).toBeTruthy();
    expect(p1.mitigationPlan).toBeTruthy();
    expect(p1.incidentOwner).toBeTruthy();
    expect(p1.correlationId).toBeTruthy();
  });

  it('enforces Outcome SLO invariants: all 7 metrics must have sourceMetric and freshnessSeconds', () => {
    const service = new AdminControlPlaneService();
    const metrics = service.getOutcomeSloMetrics();

    expect(metrics.length).toBe(7);

    const keys = metrics.map(m => m.sloKey);
    expect(keys).toContain('VERIFIED_WRITE');
    expect(keys).toContain('READBACK_SUCCESS');
    expect(keys).toContain('SCHEDULE_ON_TIME');
    expect(keys).toContain('BOOKING_VERIFICATION');
    expect(keys).toContain('RECONCILE_LATENCY');
    expect(keys).toContain('CREDIT_SETTLEMENT');
    expect(keys).toContain('MEASUREMENT_FRESHNESS');

    for (const metric of metrics) {
      // Invariant: "source/freshness 없는 healthy/100% badge 0건"
      expect(metric.sourceMetric).toBeTruthy();
      expect(metric.sourceMetric.length).toBeGreaterThan(5);
      expect(metric.freshnessSeconds).toBeGreaterThan(0);
      expect(metric.measuredAt).toBeTruthy();
      expect(metric.isHealthy).toBe(true);
    }
  });

  it('fails closed when executing privileged support action without supportCaseId', () => {
    const service = new AdminControlPlaneService();

    expect(() => {
      service.executePrivilegedSupportAction({
        supportCaseId: '',
        operatorSessionId: 'op_session_001',
        workspaceId: 'ws_test',
        actionType: 'CREDIT_ADJUSTMENT',
        reason: '테스트 사유',
        correlationId: 'corr_test_001',
      });
    }).toThrowError('Privileged support action requires an authoritative supportCaseId.');
  });

  it('successfully records audit log with evidence digest upon privileged support action', () => {
    const service = new AdminControlPlaneService();

    const audit = service.executePrivilegedSupportAction({
      supportCaseId: 'CASE-2026-9999',
      operatorSessionId: 'op_session_super_01',
      workspaceId: 'ws_actual_gangnam_derm',
      actionType: 'CREDIT_ADJUSTMENT',
      reason: '고객 센터 결제 증빙 확인 후 10,000 크레딧 수동 복구',
      correlationId: 'corr_support_case_9999',
      actionRunId: 'act_run_credit_fix_001',
      ledgerEntryId: 'ldg_credit_adj_9999',
    });

    expect(audit.auditId).toBeTruthy();
    expect(audit.supportCaseId).toBe('CASE-2026-9999');
    expect(audit.evidenceDigest).toContain('sha256_CASE-2026-9999');
    expect(service.listAuditLogs().length).toBe(1);
  });

  it('performs global search across workspace, action run, payment, and incident correlations', () => {
    const service = new AdminControlPlaneService();

    // 1. Search by Workspace name
    const wsResults = service.searchGlobal('강남 프라임');
    expect(wsResults.length).toBeGreaterThan(0);
    expect(wsResults[0].matchedEntity).toBe('WORKSPACE');

    // 2. Search by Payment ID
    const payResults = service.searchGlobal('pay_tosspay');
    expect(payResults.length).toBeGreaterThan(0);
    expect(payResults[0].matchedEntity).toBe('PAYMENT');

    // 3. Search by Correlation ID
    const corrResults = service.searchGlobal('corr_inc_meta');
    expect(corrResults.length).toBeGreaterThan(0);
    expect(corrResults[0].matchedEntity).toBe('CORRELATION');
  });
});
