import { describe, it, expect } from 'vitest';
import { CampaignOrchestrator, type CampaignGoalSpec } from '../campaign/campaign-orchestrator';
import { MetaEngagementLoopEngine, type InstagramCommentEvent } from '../engagement/meta-engagement-loop-engine';
import { ChiefOfStaffWorkbenchEngine } from '../workbench/chief-of-staff-workbench-engine';

describe('Wave 2 · Campaign Brain & Engagement Loop (ANI-762, 764, 766, 792)', () => {
  describe('CampaignOrchestrator (ANI-766)', () => {
    const orchestrator = new CampaignOrchestrator();

    it('compiles goal into an end-to-end 4-step action graph with correct dependencies', () => {
      const goal: CampaignGoalSpec = {
        goalId: 'goal_01',
        workspaceId: 'ws_test',
        naturalPrompt: '이번 주 인스타그램으로 신규 예약 10건 유치해줘',
        primaryKpi: 'BOOKING_COUNT',
        targetValue: 10,
        timeframeDays: 7,
        budgetCeilingKrw: 0,
        allowedChannels: ['instagram'],
        autonomyLevel: 'L2_APPROVE_TO_RUN',
      };

      const plan = orchestrator.compileCampaignPlan(goal);

      expect(plan.actionGraph.length).toBe(4);
      expect(plan.actionGraph[0].capabilityId).toBe('research.analyze_market');
      expect(plan.actionGraph[1].capabilityId).toBe('creative.generate_variants');
      expect(plan.actionGraph[2].capabilityId).toBe('instagram.publish');
      expect(plan.actionGraph[3].capabilityId).toBe('attribution.measure_lineage');

      // Check dependency chain
      expect(plan.actionGraph[1].dependencies).toContain(plan.actionGraph[0].nodeId);
      expect(plan.actionGraph[2].dependencies).toContain(plan.actionGraph[1].nodeId);
      expect(plan.actionGraph[3].dependencies).toContain(plan.actionGraph[2].nodeId);

      expect(plan.totalEstimatedCredits).toBe(55);
      expect(plan.mandatoryApprovalCount).toBe(1); // L2 requires approval for publish
    });

    it('forces mandatory human approval for SPEND actions even under L3 Autopilot (Fail-Closed)', () => {
      const spendGoal: CampaignGoalSpec = {
        goalId: 'goal_spend',
        workspaceId: 'ws_test',
        naturalPrompt: '네이버 파워링크로 예약 20건 유치해줘',
        primaryKpi: 'BOOKING_COUNT',
        targetValue: 20,
        timeframeDays: 14,
        budgetCeilingKrw: 200_000,
        allowedChannels: ['naver_ads'],
        autonomyLevel: 'L3_GUARDRAILED_AUTOPILOT',
      };

      const plan = orchestrator.compileCampaignPlan(spendGoal);
      const spendNode = plan.actionGraph.find((n) => n.riskClass === 'SPEND');
      expect(spendNode?.requiresApproval).toBe(true); // SPEND must always require approval
    });
  });

  describe('MetaEngagementLoopEngine (ANI-762 & ANI-764)', () => {
    const loopEngine = new MetaEngagementLoopEngine();

    it('approves private reply within 7-day window for purchase intent keywords', () => {
      const comment: InstagramCommentEvent = {
        commentId: 'cmt_123',
        mediaId: 'med_456',
        fromUserId: 'usr_cust_1',
        fromUsername: 'customer_kim',
        commentText: '혹시 이번 주 토요일 예약 가능한가요? 가격 문의드립니다!',
        timestamp: new Date().toISOString(),
        hasPrivateReplySent: false,
      };

      const evalResult = loopEngine.evaluatePrivateReply(comment);
      expect(evalResult.canSendPrivateReply).toBe(true);
      expect(evalResult.proposedDmText).toContain('@customer_kim');
    });

    it('blocks private reply after 7 days from comment creation (Meta Policy compliance)', () => {
      const staleComment: InstagramCommentEvent = {
        commentId: 'cmt_old',
        mediaId: 'med_456',
        fromUserId: 'usr_cust_1',
        fromUsername: 'customer_lee',
        commentText: '예약 문의요',
        timestamp: new Date(Date.now() - 8 * 86400000).toISOString(), // 8 days old
        hasPrivateReplySent: false,
      };

      const evalResult = loopEngine.evaluatePrivateReply(staleComment);
      expect(evalResult.canSendPrivateReply).toBe(false);
      expect(evalResult.reason).toContain('7 days');
    });

    it('blocks duplicate private reply if already sent', () => {
      const duplicateComment: InstagramCommentEvent = {
        commentId: 'cmt_dup',
        mediaId: 'med_456',
        fromUserId: 'usr_cust_1',
        fromUsername: 'customer_park',
        commentText: '예약 되나요?',
        timestamp: new Date().toISOString(),
        hasPrivateReplySent: true,
      };

      const evalResult = loopEngine.evaluatePrivateReply(duplicateComment);
      expect(evalResult.canSendPrivateReply).toBe(false);
      expect(evalResult.reason).toContain('already been sent');
    });

    it('reserves booking slot and returns confirmed proposal', () => {
      const booking = loopEngine.reserveBookingSlot({
        workspaceId: 'ws_test',
        customerIdentifier: 'customer_kim',
        dateTime: '2026-09-10T14:00:00Z',
        serviceTitle: '원데이 프리미엄 코스',
      });

      expect(booking.isConfirmed).toBe(true);
      expect(booking.slotId).toBeDefined();
    });
  });

  describe('ChiefOfStaffWorkbenchEngine (ANI-792)', () => {
    const workbench = new ChiefOfStaffWorkbenchEngine();

    it('compiles coherent summary briefing', () => {
      const summary = workbench.compileWorkbenchBriefing({
        workspaceId: 'ws_briefing',
        weeklyAllowance: 1500,
        weeklyRemaining: 1120,
        todayStats: { inquiries: 5, bookings: 2, creditsBurned: 85 },
        pendingApprovalsCount: 1,
        opportunityCount: 3,
        proofTimelineCount: 4,
      });

      expect(summary.weeklyCreditsRemaining).toBe(1120);
      expect(summary.todayStats.bookings).toBe(2);
      expect(summary.pendingApprovalsCount).toBe(1);
    });
  });
});
