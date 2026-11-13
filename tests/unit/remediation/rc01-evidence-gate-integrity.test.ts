import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ReleaseGateManifestEvaluator } from '@/features/eval/release-gate-manifest-evaluator';
import { GoldenBusinessWeekRuntime } from '@/features/eval/golden-business-week-runtime';

describe('[RC-01][Regression] Evidence & Release Gate Integrity (ANI-1326)', () => {
  const evaluator = new ReleaseGateManifestEvaluator();
  const weekRuntime = new GoldenBusinessWeekRuntime();

  describe('ReleaseGateManifestEvaluator Fail-Closed Rules', () => {
    it('MUST block release when audit payload is empty or has missing fields (No Fail-Open)', () => {
      // Omission Injection: Providing empty audit payload
      const manifest = evaluator.evaluateReleaseReadiness({
        workspaceId: '00000000-0000-4000-8000-0000000000a2',
        commitSha: '2e0cc2ad',
        goldenEvalScore: 99,
        audit: {}, // Everything omitted!
      });

      // Strict Fail-Closed asserts
      expect(manifest.hardBlockers.secretRemediationCompleted).toBe(false);
      expect(manifest.hardBlockers.mandatoryStagesObserved).toBe(false);
      expect(manifest.hardBlockers.supabaseSecurityClean).toBe(false);
      expect(manifest.hardBlockers.ownerAdminSnapshotParity).toBe(false);
      expect(manifest.hardBlockers.duplicateOrDoubleBookingZero).toBe(false);
      expect(manifest.hardBlockers.figmaCanonCompliant).toBe(false);

      expect(manifest.allHardBlockersPassed).toBe(false);
      expect(manifest.isReleaseReady).toBe(false);
      expect(manifest.finalVerdict).toBe('BLOCKED');
    });

    it('MUST block release if any single hard blocker is undefined or false', () => {
      const allTrue = {
        secretRemediationCompleted: true,
        mandatoryStagesObserved: true,
        supabaseSecurityClean: true,
        ownerAdminSnapshotParity: true,
        duplicateOrDoubleBookingZero: true,
        figmaCanonCompliant: true,
      };

      const blockerKeys = Object.keys(allTrue) as (keyof typeof allTrue)[];

      for (const key of blockerKeys) {
        const partialAudit = { ...allTrue };
        delete (partialAudit as any)[key]; // Make it undefined

        const result = evaluator.evaluateReleaseReadiness({
          workspaceId: '00000000-0000-4000-8000-0000000000a2',
          commitSha: '2e0cc2ad',
          goldenEvalScore: 95,
          audit: partialAudit,
        });

        expect(result.hardBlockers[key]).toBe(false);
        expect(result.allHardBlockersPassed).toBe(false);
        expect(result.isReleaseReady).toBe(false);
        expect(result.finalVerdict).toBe('BLOCKED');
      }
    });

    it('MUST reference actual existing documentation files in evidenceReferences', () => {
      const manifest = evaluator.evaluateReleaseReadiness({
        workspaceId: '00000000-0000-4000-8000-0000000000a2',
        commitSha: '2e0cc2ad',
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

      const wave0Path = path.join(process.cwd(), manifest.evidenceReferences.wave0TruthReconciliationDoc);
      expect(fs.existsSync(wave0Path), `Referenced wave0 doc must exist on disk: ${wave0Path}`).toBe(true);
    });
  });

  describe('GoldenBusinessWeekRuntime Real Verification Rules', () => {
    it('MUST NOT mark simulation as fully verified when running without real DB observations', () => {
      const summary = weekRuntime.executeSevenDayLifecycle({
        workspaceId: '00000000-0000-4000-8000-0000000000a2',
        tenantName: '바이름 뷰티샵',
      });

      // Simulation must NOT pretend to be verified production ground truth!
      expect(summary.isWeekFullyVerified).toBe(false);
      summary.dailyLogs.forEach((log) => {
        expect(log.isVerified).toBe(false);
      });
    });

    it('MUST verify week ONLY when verified daily records and real calendar-time data are provided', () => {
      const verifiedSummary = weekRuntime.executeSevenDayLifecycle({
        workspaceId: '00000000-0000-4000-8000-0000000000a2',
        tenantName: '바이름 뷰티샵',
        startDate: '2026-09-04',
        observedDailyRecords: [
          { dayNumber: 1, dateString: '2026-09-04', dayTitle: '주초 목표 수립 & 첫 안전 피드 발행', activities: ['미션 발행'], evidenceIds: ['real_proof_1'], isVerified: true, notes: '검증됨' },
          { dayNumber: 2, dateString: '2026-09-05', dayTitle: '실시간 고객 문의 수신', activities: ['웹훅 수신'], evidenceIds: ['real_proof_2'], isVerified: true, notes: '검증됨' },
          { dayNumber: 3, dateString: '2026-09-06', dayTitle: '고객 슬롯 수락 & 예약 확정', activities: ['예약 확정'], evidenceIds: ['real_proof_3'], isVerified: true, notes: '검증됨' },
          { dayNumber: 4, dateString: '2026-09-07', dayTitle: '사장님 부재 중 위임 자율 루틴', activities: ['자율 스케줄러'], evidenceIds: ['real_proof_4'], isVerified: true, notes: '검증됨' },
          { dayNumber: 5, dateString: '2026-09-08', dayTitle: '성과 집계 & 학습 후보 도출', activities: ['성과 집계'], evidenceIds: ['real_proof_5'], isVerified: true, notes: '검증됨' },
          { dayNumber: 6, dateString: '2026-09-09', dayTitle: 'NBA 도출 및 사장님 승인', activities: ['NBA 추천'], evidenceIds: ['real_proof_6'], isVerified: true, notes: '검증됨' },
          { dayNumber: 7, dateString: '2026-09-10', dayTitle: '주간 종합 브리핑 및 Same-Truth', activities: ['브리핑'], evidenceIds: ['real_proof_7'], isVerified: true, notes: '검증됨' },
        ],
      });

      expect(verifiedSummary.isWeekFullyVerified).toBe(true);
      expect(verifiedSummary.totalDaysVerified).toBe(7);
      verifiedSummary.dailyLogs.forEach((log) => {
        expect(log.isVerified).toBe(true);
      });
    });
  });
});
