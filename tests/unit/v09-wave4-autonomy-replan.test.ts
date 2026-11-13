/**
 * Sohee V0.9 5th Update · Wave 4 Autonomy Unit Tests
 * Goal-Gap Replan Engine & Opportunity Detector Verification
 * 
 * Traceability: ANI-932
 */

import { describe, it, expect } from 'vitest';
import { GoalGapReplanEngine } from '@/features/autonomy/goal-gap-replan-engine';
import { AutonomyEnvelopePolicy } from '@/types/my-sohee-control';

describe('V0.9 Wave 4 · GoalGapReplanEngine (ANI-932)', () => {
  const defaultEnvelope: AutonomyEnvelopePolicy = {
    policyId: 'pol_default',
    workspaceId: 'ws_test',
    version: 1,
    maxDailyAdSpendKrw: 50000,
    maxDiscountPercent: 20,
    allowedChannels: ['meta_ads', 'instagram', 'naver_blog'],
    forbiddenWords: ['100% 보장', '완치'],
    approvalConditions: {
      minSpendRequiringApproval: 100000,
      requireApprovalForNewCampaign: true,
      requireApprovalForRefundProposal: true,
    },
    updatedAt: new Date().toISOString(),
  };

  it('detects AD_STOP_LOSS as CRITICAL priority when daily spend exceeds envelope limit', () => {
    const engine = new GoalGapReplanEngine();
    const opps = engine.detectOpportunities({
      workspaceId: 'ws_test',
      signals: {
        hasOpenBookingSlotsNext48h: false,
        openSlotCount: 0,
        scheduledPostDue: false,
        weeklyGoalCompletionRate: 0.8,
        unansweredInquiriesCount: 0,
        adSpendDailyTotalKrw: 75000, // 50,000 초과
        adRoasRatio: 1.2,
      },
      runtimeState: 'RUNNING',
      envelope: defaultEnvelope,
    });

    expect(opps.length).toBeGreaterThan(0);
    const stopLoss = opps.find(o => o.type === 'AD_STOP_LOSS');
    expect(stopLoss).toBeDefined();
    expect(stopLoss?.priorityTier).toBe('CRITICAL');
    expect(stopLoss?.urgencyScore).toBe(100);
    expect(stopLoss?.status).toBe('DETECTED');
  });

  it('suppresses execution status to SUPPRESSED_PAUSED when runtime is PAUSED or BLOCKED', () => {
    const engine = new GoalGapReplanEngine();
    const opps = engine.detectOpportunities({
      workspaceId: 'ws_test',
      signals: {
        hasOpenBookingSlotsNext48h: true,
        openSlotCount: 4,
        scheduledPostDue: true,
        weeklyGoalCompletionRate: 0.3,
        unansweredInquiriesCount: 2,
        adSpendDailyTotalKrw: 10000,
        adRoasRatio: 3.0,
      },
      runtimeState: 'PAUSED',
      envelope: defaultEnvelope,
    });

    expect(opps.length).toBeGreaterThan(0);
    for (const opp of opps) {
      expect(opp.status).toBe('SUPPRESSED_PAUSED');
    }
  });

  it('correctly ranks multiple opportunities by urgencyScore descending', () => {
    const engine = new GoalGapReplanEngine();
    const opps = engine.detectOpportunities({
      workspaceId: 'ws_test',
      signals: {
        hasOpenBookingSlotsNext48h: true,
        openSlotCount: 2,
        scheduledPostDue: false,
        weeklyGoalCompletionRate: 0.4, // GOAL_SHORTFALL: 70
        unansweredInquiriesCount: 1, // UNANSWERED_INQUIRY: 85
        adSpendDailyTotalKrw: 60000, // AD_STOP_LOSS: 100
        adRoasRatio: 2.0,
        tokenExpiresInHours: 12, // TOKEN_EXPIRING: 80
      },
      runtimeState: 'RUNNING',
      envelope: defaultEnvelope,
    });

    expect(opps.length).toBe(5);
    expect(opps[0].type).toBe('AD_STOP_LOSS'); // 100
    expect(opps[1].type).toBe('BOOKING_GAP'); // 90
    expect(opps[2].type).toBe('UNANSWERED_INQUIRY'); // 85
    expect(opps[3].type).toBe('TOKEN_EXPIRING'); // 80
    expect(opps[4].type).toBe('GOAL_SHORTFALL'); // 70
  });

  it('successfully increments ActionGraph version upon verified outcome replan', () => {
    const engine = new GoalGapReplanEngine();
    const initialGraph = {
      graphId: 'graph_ws_test',
      workspaceId: 'ws_test',
      version: 2,
      goalTitle: '매출 1000만원 달성',
      gapMetric: '부족분 200만원',
      nodes: [],
      updatedAt: new Date().toISOString(),
    };

    const opp = {
      id: 'opp_123',
      workspaceId: 'ws_test',
      type: 'BOOKING_GAP' as const,
      dedupeKey: 'key_123',
      detectedAt: new Date().toISOString(),
      urgencyScore: 90,
      priorityTier: 'HIGH' as const,
      title: '공실 긴급 마감',
      rationale: '스토리 발행',
      recommendedAction: 'POST_FLASH_STORY',
      targetChannel: 'instagram',
      requiresOwnerEscalation: false,
      status: 'DETECTED' as const,
    };

    const { updatedGraph, trace } = engine.replanAfterOutcome({
      currentGraph: initialGraph,
      opportunity: opp,
      actionOutcome: {
        actionRunId: 'act_run_888',
        evidenceId: 'ev_proof_888',
        outcomeDetail: '스토리 발행 확인 및 슬롯 예약 성공',
        success: true,
      },
    });

    expect(updatedGraph.version).toBe(3);
    expect(updatedGraph.nodes.length).toBe(1);
    expect(updatedGraph.nodes[0].evidenceId).toBe('ev_proof_888');
    expect(updatedGraph.nodes[0].status).toBe('COMPLETED');
    expect(trace.previousGraphVersion).toBe(2);
    expect(trace.newGraphVersion).toBe(3);
    expect(trace.replanSuccess).toBe(true);
  });

  it('generates a full canary closed loop trace satisfying Production Evidence requirement', () => {
    const engine = new GoalGapReplanEngine();
    const canary = engine.generateCanaryClosedLoopTrace('ws_canary_hospital');

    expect(canary.opportunity).toBeDefined();
    expect(canary.initialGraph.version).toBe(1);
    expect(canary.updatedGraph.version).toBe(2);
    expect(canary.trace.replanSuccess).toBe(true);
    expect(canary.trace.evidenceId).toContain('ev_proof_canary');
    expect(canary.updatedGraph.nodes[0].status).toBe('COMPLETED');
  });
});
