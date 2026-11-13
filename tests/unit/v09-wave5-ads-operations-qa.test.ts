import { describe, it, expect, beforeEach } from 'vitest';
import { SoheeAdAgencyService } from '@/features/ads/sohee-ad-agency-service';
import { IncidentCenterService } from '@/lib/admin-ops/incident-center-service';
import { OutcomeSloDashboardService } from '@/lib/admin-ops/outcome-slo-dashboard';
import { ControlTowerRiskRailService } from '@/lib/admin-ops/control-tower-risk-rail';
import { ProductionReverificationHarness } from '@/features/qa-verification/production-reverification-harness';

describe('V0.9 Wave 5 · Ad Agency, Operations & QA Verification Harness', () => {
  describe('ANI-895: Sohee Ad Agency Service (Organic -> Paid & Delegation)', () => {
    let adService: SoheeAdAgencyService;

    beforeEach(() => {
      adService = new SoheeAdAgencyService();
    });

    it('성공적으로 오가닉 콘텐츠를 유료 광고 캠페인으로 승격하고 기본 위임 모드로 설정한다', () => {
      const campaign = adService.promoteContentToAd({
        workspaceId: 'ws_gangnam_01',
        sourceContentAssetId: 'asset_lookbook_top_01',
        channel: 'META_ADS',
        headline: '강남역 1분 역대급 펌 30% 첫방문 혜택',
        dailyBudgetKrw: 30000,
        totalBudgetCapKrw: 300000,
        radiusKm: 2.5,
      });

      expect(campaign.campaignId).toBeDefined();
      expect(campaign.status).toBe('ACTIVE_RUNNING');
      expect(campaign.operationMode).toBe('SOHEE_AUTONOMOUS_DELEGATED');
      expect(campaign.targetAudience.radiusKm).toBe(2.5);
      expect(campaign.metrics.roasPercent).toBe(0);
    });

    it('광고 성과 데이터를 누적하고 ROAS를 정확하게 계산한다', () => {
      const campaign = adService.promoteContentToAd({
        workspaceId: 'ws_gangnam_01',
        sourceContentAssetId: 'asset_post_02',
        channel: 'NAVER_SEARCH_ADS',
        headline: '신논현 헤어살롱 봄맞이 프로모션',
        dailyBudgetKrw: 20000,
        totalBudgetCapKrw: 200000,
      });

      // 지출 100,000원, 귀속 매출 500,000원 기록 -> ROAS 500%
      const updated = adService.recordPerformance(campaign.campaignId, {
        spentKrwDelta: 100000,
        impressionsDelta: 12000,
        clicksDelta: 450,
        leadsDelta: 30,
        bookingsDelta: 12,
        revenueKrwDelta: 500000,
      });

      expect(updated.spentKrw).toBe(100000);
      expect(updated.metrics.impressions).toBe(12000);
      expect(updated.metrics.clicks).toBe(450);
      expect(updated.metrics.leadsAcquired).toBe(30);
      expect(updated.metrics.bookingsGenerated).toBe(12);
      expect(updated.metrics.attributedRevenueKrw).toBe(500000);
      expect(updated.metrics.roasPercent).toBe(500); // 500,000 / 100,000 * 100
    });

    it('사장님이 직접 제어 모드로 변경하거나 일 예산을 변경할 수 있다', () => {
      const campaign = adService.promoteContentToAd({
        workspaceId: 'ws_gangnam_01',
        sourceContentAssetId: 'asset_post_03',
        channel: 'DAANGN_LOCAL_ADS',
        headline: '동네 주민 한정 두피스케일링 서비스',
        dailyBudgetKrw: 15000,
        totalBudgetCapKrw: 150000,
      });

      const manualControlled = adService.switchOperationMode(campaign.campaignId, 'OWNER_DIRECT_CONTROL');
      expect(manualControlled.operationMode).toBe('OWNER_DIRECT_CONTROL');

      const budgetUpdated = adService.updateDailyBudget(campaign.campaignId, 25000);
      expect(budgetUpdated.dailyBudgetKrw).toBe(25000);
    });
  });

  describe('ANI-878: Incident Center Service (P0/P1 Impact Quarantine)', () => {
    let incidentService: IncidentCenterService;

    beforeEach(() => {
      incidentService = new IncidentCenterService();
    });

    it('P0 장애를 선언하고 영향을 받는 프로바이더 및 워크스페이스를 추적한다', () => {
      const incident = incidentService.declareIncident({
        title: 'Meta Graph API Instagram 게시 API 500 Internal Error 급증',
        severity: 'P0_CRITICAL',
        affectedProvider: 'META',
        affectedWorkspaceIds: ['ws_01', 'ws_02', 'ws_03'],
        customerImpactDescription: '인스타그램 예약 포스팅 지연 발생 중',
      });

      expect(incident.incidentId).toBeDefined();
      expect(incident.status).toBe('INVESTIGATING');
      expect(incident.affectedProvider).toBe('META');

      const activeIncidents = incidentService.listActiveIncidents();
      expect(activeIncidents.length).toBe(1);
      expect(activeIncidents[0].title).toContain('Meta Graph API');
    });

    it('조치 후 장애를 정상 해결(RESOLVED) 처리한다', () => {
      const incident = incidentService.declareIncident({
        title: '토스페이먼츠 웹훅 지연',
        severity: 'P1_HIGH',
        affectedProvider: 'TOSS_PAYMENTS',
        affectedWorkspaceIds: ['ws_01'],
        customerImpactDescription: '충전 크레딧 반영 2분 지연',
      });

      const resolved = incidentService.resolveIncident(
        incident.incidentId,
        '토스 웹훅 게이트웨이 백오프 큐 재시도 처리 완료',
      );

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.mitigationActionTaken).toContain('게이트웨이');
      expect(resolved.resolvedAt).toBeDefined();

      const active = incidentService.listActiveIncidents();
      expect(active.length).toBe(0);
    });
  });

  describe('ANI-879: Outcome-based SLO Dashboard Service', () => {
    let sloDashboard: OutcomeSloDashboardService;

    beforeEach(() => {
      sloDashboard = new OutcomeSloDashboardService();
    });

    it('4대 SLO(실행 성공률, 리드백 정확도, 예약 정시율, 크레딧 대사율)가 목표를 충족하면 HEALTHY를 반환한다', () => {
      const report = sloDashboard.evaluateSlo({
        totalExecutions: 1000,
        failedExecutions: 2, // 99.8% (> 99.0%)
        totalReadbacks: 500,
        mismatchedReadbacks: 1, // 99.8% (> 99.5%)
        totalScheduledPublications: 200,
        delayedPublications: 1, // 99.5% (> 99.0%)
        totalCreditTransactions: 3000,
        unreconciledCreditsCount: 0, // 100.0% (= 100.0%)
      });

      expect(report.overallHealth).toBe('HEALTHY');
      expect(report.metrics).toHaveLength(4);
      expect(report.metrics.every((m) => !m.isBreached)).toBe(true);
    });

    it('크레딧 대사 불일치 또는 지표 미달 발생 시 BREACHED를 감지한다', () => {
      const report = sloDashboard.evaluateSlo({
        totalExecutions: 1000,
        failedExecutions: 50, // 95% (< 99.0%)
        totalReadbacks: 500,
        mismatchedReadbacks: 20,
        totalScheduledPublications: 200,
        delayedPublications: 30,
        totalCreditTransactions: 3000,
        unreconciledCreditsCount: 5, // 불일치 발생
      });

      expect(report.overallHealth).toBe('BREACHED');
      const creditSlo = report.metrics.find((m) => m.name === 'CREDIT_RECONCILE_ACCURACY');
      expect(creditSlo?.isBreached).toBe(true);
    });
  });

  describe('ANI-881, ANI-882: Control Tower Risk Rail & Actionable Alerts', () => {
    let riskRail: ControlTowerRiskRailService;

    beforeEach(() => {
      riskRail = new ControlTowerRiskRailService();
    });

    it('5대 필수 요소를 포함한 실천적 알림을 생성하고 4단계 Risk Rail로 분류한다', () => {
      const alert = riskRail.createActionableAlert({
        source: 'Instagram Graph API Worker',
        impact: '강남점 계정의 당일 게시 대기열 3건 중단',
        freshnessMinutes: 5,
        rootCause: 'OAuth Access Token 만료 및 리프레시 실패',
        remediationAction: '사장님 알림톡으로 1-클릭 재인증 URL 발송',
        riskLevel: 'LEVEL_3_OPERATOR_ACTION_NEEDED',
        workspaceId: 'ws_gangnam_01',
      });

      expect(alert.alertId).toBeDefined();
      expect(alert.riskLevel).toBe('LEVEL_3_OPERATOR_ACTION_NEEDED');
      expect(alert.isResolved).toBe(false);

      const level3Alerts = riskRail.listUnresolvedByRiskLevel('LEVEL_3_OPERATOR_ACTION_NEEDED');
      expect(level3Alerts).toHaveLength(1);
      expect(level3Alerts[0].rootCause).toContain('OAuth Access Token');
    });

    it('알림 조치 완료 후 상태를 변경하고 미해결 목록에서 제거한다', () => {
      const alert = riskRail.createActionableAlert({
        source: 'Naver Place Bot',
        impact: '예약 동기화 30초 지연',
        freshnessMinutes: 1,
        rootCause: '네이버 플레이스 일시적 레이트 리밋',
        remediationAction: '지수 백오프 60초 후 재시도',
        riskLevel: 'LEVEL_2_ATTENTION_REQUIRED',
      });

      riskRail.resolveAlert(alert.alertId);
      const unresolved = riskRail.listUnresolvedByRiskLevel();
      expect(unresolved).toHaveLength(0);
    });
  });

  describe('ANI-884, ANI-886, ANI-893, ANI-638: Production Reverification Harness', () => {
    let harness: ProductionReverificationHarness;

    beforeEach(() => {
      harness = new ProductionReverificationHarness();
    });

    it('QA-01부터 QA-30까지 30개 전수 검증 항목을 모두 실행하여 100% 통과한다', () => {
      const result = harness.runFullReverification();

      expect(result.totalChecks).toBe(30);
      expect(result.passedCount).toBe(30);
      expect(result.failedCount).toBe(0);
      expect(result.isAllPassed).toBe(true);
      expect(result.oauthEvidenceGateVerified).toBe(true);
      expect(result.responsiveParityVerified).toBe(true);
    });

    it('모바일/데스크톱 크로스 서피스 반응형 및 WCAG 접근성 검증을 통과한다', () => {
      const a11yResult = harness.verifyAccessibilityCompliance({
        contrastRatioPassed: true,
        touchTargetMin48pxPassed: true,
        focusVisibleRingPassed: true,
        ariaLabelsComplete: true,
      });

      expect(a11yResult.passed).toBe(true);
      expect(a11yResult.standard).toBe('WCAG_2_1_AA');
    });
  });
});
