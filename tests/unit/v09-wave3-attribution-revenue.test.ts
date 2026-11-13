/**
 * Tests for Sohee V0.9 Wave 3 Results Attribution & Revenue Lineage
 * Traceability: ANI-929
 */

import { describe, it, expect } from 'vitest';
import { AttributionRevenueService } from '@/lib/attribution/attribution-revenue-service';
import { VerifiedRevenueEvent } from '@/types/attribution-revenue';

describe('V0.9 Wave 3 · Results Verified Attribution & Zero Semantics (ANI-929)', () => {
  it('1. Zero Semantics: 미연동/미수집 상태를 0 대신 명확한 상태로 판별해야 한다', () => {
    // 1-1. 미연동 상태
    const missing = AttributionRevenueService.resolveZeroSemanticState({
      isConnected: false,
      hasDataIngested: false,
    });
    expect(missing).toBe('MISSING_SOURCE');

    // 1-2. 연결되었으나 데이터 미수집
    const awaiting = AttributionRevenueService.resolveZeroSemanticState({
      isConnected: true,
      hasDataIngested: false,
    });
    expect(awaiting).toBe('AWAITING_INITIAL_INGESTION');

    // 1-3. 24시간 이상 경과된 지연 상태
    const staleTime = new Date(Date.now() - 90000000).toISOString(); // 25 hours ago
    const stale = AttributionRevenueService.resolveZeroSemanticState({
      isConnected: true,
      hasDataIngested: true,
      lastSyncedAt: staleTime,
    });
    expect(stale).toBe('STALE');

    // 1-4. 정상 가동 상태
    const activeTime = new Date().toISOString();
    const active = AttributionRevenueService.resolveZeroSemanticState({
      isConnected: true,
      hasDataIngested: true,
      lastSyncedAt: activeTime,
    });
    expect(active).toBe('VERIFIED_ACTIVE');
  });

  it('2. verified revenue event만 실제 매출(Actual Revenue)로 합산해야 한다', () => {
    const events: VerifiedRevenueEvent[] = [
      {
        revenueEventId: 'rev-001',
        workspaceId: 'ws-gangnam',
        bookingId: 'bk-001',
        customerId: 'cust-001',
        amountKrw: 100000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
        confidenceScore: 0.95,
        verificationState: 'VERIFIED',
        evidenceId: 'ev-001',
      },
      {
        revenueEventId: 'rev-002',
        workspaceId: 'ws-gangnam',
        bookingId: 'bk-002',
        customerId: 'cust-002',
        amountKrw: 80000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
        confidenceScore: 0.50,
        verificationState: 'RESULT_UNKNOWN', // 검증 대기 중인 이벤트
        evidenceId: 'ev-002',
      },
      {
        revenueEventId: 'rev-003',
        workspaceId: 'ws-gangnam',
        bookingId: 'bk-003',
        customerId: 'cust-003',
        amountKrw: 50000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CASH',
        confidenceScore: 0.10,
        verificationState: 'DISPUTED', // 분쟁 건
        evidenceId: 'ev-003',
      },
    ];

    const report = AttributionRevenueService.generateComparisonReport({
      workspaceId: 'ws-gangnam',
      period: '7d',
      verifiedEvents: events,
      totalAdSpendKrw: 20000,
      connectionStates: {
        organicConnected: true,
        adsConnected: true,
        crmConnected: true,
        organicLastSync: new Date().toISOString(),
        adsLastSync: new Date().toISOString(),
        crmLastSync: new Date().toISOString(),
      },
    });

    // 오직 VERIFIED 상태인 rev-001의 100,000원만 반영되어야 함
    expect(report.totalActualRevenueKrw).toBe(100000);
    expect(report.totalAdSpendKrw).toBe(20000);
    expect(report.overallRoas).toBe(5.0); // 100000 / 20000
  });

  it('3. 기여 모델 결과(First/Last/Linear)는 통계적 추정치이며 실제 매출과 명확히 구분되어야 한다', () => {
    const events: VerifiedRevenueEvent[] = [
      {
        revenueEventId: 'rev-001',
        workspaceId: 'ws-gangnam',
        bookingId: 'bk-001',
        customerId: 'cust-001',
        amountKrw: 200000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
        confidenceScore: 0.98,
        verificationState: 'VERIFIED',
        evidenceId: 'ev-001',
      },
    ];

    const report = AttributionRevenueService.generateComparisonReport({
      workspaceId: 'ws-gangnam',
      period: '7d',
      verifiedEvents: events,
      totalAdSpendKrw: 40000,
      connectionStates: {
        organicConnected: true,
        adsConnected: true,
        crmConnected: true,
      },
    });

    expect(report.totalActualRevenueKrw).toBe(200000);
    expect(report.modelSimulations.FIRST_TOUCH.modelName).toContain('First-Touch');
    expect(report.modelSimulations.LAST_TOUCH.modelName).toContain('Last-Touch');
    expect(report.modelSimulations.LINEAR.modelName).toContain('Linear');
  });

  it('4. 단일 매출 이벤트로부터 Campaign ➔ Content ➔ Conversation ➔ Booking ➔ Revenue Lineage Evidence를 추출해야 한다', () => {
    const event: VerifiedRevenueEvent = {
      revenueEventId: 'rev-100',
      workspaceId: 'ws-gangnam',
      bookingId: 'bk-100',
      customerId: 'cust-100',
      amountKrw: 150000,
      paidAt: '2026-09-06T15:00:00.000Z',
      paymentMethod: 'CARD',
      attributedCampaignId: 'cmp-spring',
      attributedContentId: 'cnt-reels',
      attributedConversationId: 'conv-dm',
      confidenceScore: 0.95,
      verificationState: 'VERIFIED',
      evidenceId: 'ev-lineage-100',
    };

    const lineage = AttributionRevenueService.extractLineageEvidence(event, 30000);

    expect(lineage.evidenceId).toBe('ev-lineage-100');
    expect(lineage.campaignId).toBe('cmp-spring');
    expect(lineage.contentId).toBe('cnt-reels');
    expect(lineage.conversationId).toBe('conv-dm');
    expect(lineage.bookingId).toBe('bk-100');
    expect(lineage.roasRatio).toBe(5.0); // 150000 / 30000
    expect(lineage.readbackProofDigest).toContain('sha256_');
  });

  it('5. Dock 지시: 지난달 실제 돈 된 마케팅만 질의 시 검증 완료된 매출 Lineage만 반환해야 한다', () => {
    const events: VerifiedRevenueEvent[] = [
      {
        revenueEventId: 'rev-201',
        workspaceId: 'ws-gangnam',
        bookingId: 'bk-201',
        customerId: 'cust-201',
        amountKrw: 120000,
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
        confidenceScore: 0.95,
        verificationState: 'VERIFIED',
        evidenceId: 'ev-201',
      },
      {
        revenueEventId: 'rev-202',
        workspaceId: 'ws-gangnam',
        bookingId: 'bk-202',
        customerId: 'cust-202',
        amountKrw: 0, // 0원 이벤트
        paidAt: new Date().toISOString(),
        paymentMethod: 'CARD',
        confidenceScore: 0.90,
        verificationState: 'VERIFIED',
        evidenceId: 'ev-202',
      },
    ];

    const moneyMakingOnly = AttributionRevenueService.queryMoneyMakingMarketingOnly(events);
    expect(moneyMakingOnly).toHaveLength(1);
    expect(moneyMakingOnly[0].revenueEventId).toBe('rev-201');
    expect(moneyMakingOnly[0].amountKrw).toBe(120000);
  });
});
