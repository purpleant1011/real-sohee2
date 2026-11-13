import { describe, it, expect } from 'vitest';
import { validateProofCardData, type ProofCardData } from '../proof-card';

describe('ANI-814: Canonical Proof Card Standard', () => {
  const validProofCard: ProofCardData = {
    actionRunId: 'act_run_20260906_99812',
    evidenceId: 'ev_cert_771829',
    workspaceId: 'ws_gangnam_beauty',
    purpose: '네이버 플레이스 가을 프로모션 소식 실게시',
    pluginId: 'naver-place-sync',
    pluginVersion: '1.2.0',
    capabilityId: 'naver.place.post.publish',
    provider: 'naver',
    targetAccount: 'beauty_gangnam_01',
    actionRiskTier: 'R1_MODERATE',
    verificationState: 'EXTERNAL_VERIFIED',
    approval: {
      required: true,
      charterId: 'charter_v09_gangnam',
      charterVersion: '2.0.0',
      isA3InheritedApproval: true,
    },
    credits: {
      estimated: 200,
      settled: 200,
      currency: 'SOHEE_CREDIT',
      planTier: 'TIER_300K_GROWTH',
    },
    providerObject: {
      id: 'naver_post_88992',
      url: 'https://smartplace.naver.com/manage/posts/88992',
      acceptedAt: '2026-09-06T09:00:00Z',
    },
    readback: {
      verifiedAt: '2026-09-06T09:00:02Z',
      hash: 'a1b2c3d4e5f67890123456789012345678901234567890123456789012345678',
      verificationMethod: 'NAVER_SEARCH_READBACK',
      status: 'VERIFIED',
    },
    outcomeLineage: {
      goalId: 'goal_autumn_promotion',
      missionId: 'msn_weekly_naver_booking',
      kpiImpactSummary: '신규 예약 전환 기대 +15%',
    },
  };

  it('validates authentic production ProofCard with full provenance chain', () => {
    const res = validateProofCardData(validProofCard);
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects fixture/dummy IDs', () => {
    const res = validateProofCardData({
      ...validProofCard,
      actionRunId: 'dummy_action_run',
      evidenceId: 'mock_evidence_id',
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Invalid or mock actionRunId');
    expect(res.errors).toContain('Invalid or mock evidenceId');
  });

  it('rejects EXTERNAL_VERIFIED status when readback status is not VERIFIED', () => {
    const res = validateProofCardData({
      ...validProofCard,
      verificationState: 'EXTERNAL_VERIFIED',
      readback: {
        ...validProofCard.readback,
        status: 'MISMATCH',
      },
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('EXTERNAL_VERIFIED state requires readback.status to be VERIFIED');
  });
});
