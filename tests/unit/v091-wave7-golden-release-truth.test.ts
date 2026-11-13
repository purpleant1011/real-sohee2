import { describe, it, expect } from 'vitest';
import {
  AgentEvalRubricRuntime,
  GOLDEN_CLOSED_LOOP_SEQUENCE,
} from '@/features/eval/agent-eval-rubric-runtime';
import {
  GoldenBusinessWeekRuntime,
} from '@/features/eval/golden-business-week-runtime';
import {
  ReleaseGateManifestEvaluator,
} from '@/features/eval/release-gate-manifest-evaluator';

describe('V0.91 Wave 7 · Golden Business Week Release Truth Tests', () => {
  // 1. Agent Golden Tasks & 100-Point Rubric (ANI-1269)
  describe('ANI-1269: Agent Golden Tasks, Failure Injection & 100-Point Rubric', () => {
    const rubricRuntime = new AgentEvalRubricRuntime();

    it('11단계 Closed Loop를 전원 완료하면 90점 이상으로 PASS 판정된다', () => {
      const result = rubricRuntime.evaluateGoldenTrajectory({
        evalId: 'eval_golden_1',
        workspaceId: 'ws_byreum',
        observedStages: [...GOLDEN_CLOSED_LOOP_SEQUENCE],
        hasValidReadbackEvidence: true,
        hasDeterministicBookingConstraint: true,
        hasBudgetProtection: true,
        injectedFailuresRecovered: [
          'AI_TIMEOUT_ERROR',
          'META_RATE_LIMIT_ERROR',
          'PROVIDER_ACCEPTED_READBACK_UNKNOWN',
          'BOOKING_CONCURRENCY_RACE',
          'APPROVAL_MUTATION_TOCTOU',
        ],
      });

      expect(result.allStagesCompleted).toBe(true);
      expect(result.completedStages).toHaveLength(11);
      expect(result.scorecard.totalScore).toBeGreaterThanOrEqual(90);
      expect(result.isPassed).toBe(true);
      expect(result.verdict).toBe('PASS');
      expect(result.criticalFails).toHaveLength(0);
    });

    it('Critical Fail 항목(예: DOUBLE_BOOKING)이 발생하면 점수와 무관하게 즉시 CRITICAL_FAIL 판정된다', () => {
      const result = rubricRuntime.evaluateGoldenTrajectory({
        evalId: 'eval_fail_1',
        workspaceId: 'ws_byreum',
        observedStages: [...GOLDEN_CLOSED_LOOP_SEQUENCE],
        criticalFailViolations: ['DOUBLE_BOOKING', 'CROSS_TENANT_LEAK'],
      });

      expect(result.isPassed).toBe(false);
      expect(result.verdict).toBe('CRITICAL_FAIL');
      expect(result.criticalFails).toContain('DOUBLE_BOOKING');
      expect(result.summary).toContain('Critical Fail');
    });

    it('Blind Retry가 발생한 실패 주입 시나리오는 불합격 처리된다', () => {
      const recovery = rubricRuntime.evaluateFailureRecovery('PROVIDER_ACCEPTED_READBACK_UNKNOWN', {
        isRecovered: false,
        reconcileState: 'RETRYING',
        hasBlindRetry: true, // Blind Retry 위반
      });

      expect(recovery.isSafe).toBe(false);
      expect(recovery.reason).toContain('Blind Retry 차단 위반');
    });

    it('안전하게 RESULT_UNKNOWN으로 전이된 실패 주입 시나리오는 안전성을 인정받는다', () => {
      const recovery = rubricRuntime.evaluateFailureRecovery('PROVIDER_ACCEPTED_READBACK_UNKNOWN', {
        isRecovered: false,
        reconcileState: 'RESULT_UNKNOWN',
        hasBlindRetry: false,
      });

      expect(recovery.isSafe).toBe(true);
    });
  });

  // 2. Byreum Golden Business Week 7-Day Operation (ANI-1270)
  describe('ANI-1270: Byreum Golden Business Week 7-Day Operation & Verification', () => {
    const weekRuntime = new GoldenBusinessWeekRuntime();

    it('7일간의 상용 운영 라이프사이클을 완벽히 검증하고 5대 불변식 위반 0건을 증명한다', () => {
      const summary = weekRuntime.executeSevenDayLifecycle({
        workspaceId: 'ws_byreum_prod',
        tenantName: '바이름 뷰티샵',
        allowSimulationFixture: true,
      });

      expect(summary.totalDaysVerified).toBe(7);
      expect(summary.isWeekFullyVerified).toBe(true);
      expect(summary.dailyLogs).toHaveLength(7);

      // 각 일자별 필수 검증 확인
      expect(summary.dailyLogs[0].dayTitle).toContain('피드 발행');
      expect(summary.dailyLogs[1].dayTitle).toContain('고객 문의');
      expect(summary.dailyLogs[2].dayTitle).toContain('예약 확정');
      expect(summary.dailyLogs[3].dayTitle).toContain('자율 루틴');
      expect(summary.dailyLogs[4].dayTitle).toContain('성과 집계');
      expect(summary.dailyLogs[5].dayTitle).toContain('Next Best Action');
      expect(summary.dailyLogs[6].dayTitle).toContain('Same-Truth');

      // 5대 불변식 검증
      expect(summary.invariantsAudit.crossTenantPollutionCount).toBe(0);
      expect(summary.invariantsAudit.duplicateExternalActionsCount).toBe(0);
      expect(summary.invariantsAudit.falseCompletionsCount).toBe(0);
      expect(summary.invariantsAudit.staleDataLeaksCount).toBe(0);
      expect(summary.invariantsAudit.ownerAdminParityMismatchesCount).toBe(0);

      // 주요 상용 메트릭 확인
      expect(summary.metrics.confirmedBookingsCount).toBe(1);
      expect(summary.metrics.attributedRevenueKrw).toBe(120000);
      expect(summary.metrics.autonomousRoutinesExecuted).toBe(1);
    });
  });

  // 3. Release Gate & Evidence Manifest (ANI-1271)
  describe('ANI-1271: Release Gate & Evidence Manifest Final Verdict', () => {
    const releaseEvaluator = new ReleaseGateManifestEvaluator();

    it('모든 하드 블로커가 해결되고 평가 점수가 90점 이상이면 최종 RELEASE_READY를 판정한다', () => {
      const manifest = releaseEvaluator.evaluateReleaseReadiness({
        workspaceId: 'ws_byreum_prod',
        tenantName: '바이름 뷰티샵',
        commitSha: '89e6f57f',
        goldenEvalScore: 95,
        audit: {
          secretRemediationCompleted: true,
          mandatoryStagesObserved: true,
          supabaseSecurityClean: true,
          ownerAdminSnapshotParity: true,
          duplicateOrDoubleBookingZero: true,
          figmaCanonCompliant: true,
        },
      });

      expect(manifest.allHardBlockersPassed).toBe(true);
      expect(manifest.isReleaseReady).toBe(true);
      expect(manifest.finalVerdict).toBe('RELEASE_READY');
      expect(manifest.evidenceReferences.wave0TruthReconciliationDoc).toBeDefined();
      expect(manifest.evidenceReferences.wave6CommercialUxDoc).toBeDefined();
    });

    it('하드 블로커(예: secret remediation 미완료)가 남아있으면 BLOCKED로 판정한다', () => {
      const manifest = releaseEvaluator.evaluateReleaseReadiness({
        workspaceId: 'ws_byreum_prod',
        commitSha: '89e6f57f',
        goldenEvalScore: 95,
        audit: {
          secretRemediationCompleted: false, // 블로커 미해결
        },
      });

      expect(manifest.allHardBlockersPassed).toBe(false);
      expect(manifest.isReleaseReady).toBe(false);
      expect(manifest.finalVerdict).toBe('BLOCKED');
    });
  });
});
