import { describe, it, expect } from "vitest";
import { createBusinessGoal, calculateGoalProgress } from "../engine/goal-engine";
import { detectOpportunities } from "../engine/opportunity-radar";
import { createMissionFromOpportunity, approveMissionStep } from "../engine/mission-engine";
import { checkActionGuardrails, DEFAULT_AUTONOMY_POLICY } from "../engine/guardrails";
import { calculateAttributionSummary } from "../engine/attribution-ledger";
import { getRelevantMemories } from "../engine/marketing-memory";
import { INITIAL_BYREUM_MEMORIES } from "../engine/fixtures/marketing-memories";
import { getChannelCapability } from "../engine/channel-capability";

describe("소희 V0.8.7 마케팅 자율 에이전트 도메인 엔진 테스트", () => {
  describe("[ANI-136] Goal Engine", () => {
    it("목표 진행률과 잔여 일수/시간을 정밀 계산한다", () => {
      const now = new Date("2026-08-30T12:00:00Z");
      const result = calculateGoalProgress(10, 8, "2026-08-25T00:00:00Z", "2026-09-01T20:00:00Z", now);

      expect(result.progressPercent).toBe(80);
      expect(result.gap).toBe(2);
      expect(result.remainingDays).toBe(2);
      expect(result.remainingHours).toBe(8);
      expect(result.isExpired).toBe(false);
    });

    it("새로운 BusinessGoal 생성 시 실측 데이터 Provenance를 부여한다", () => {
      const goal = createBusinessGoal({
        workspaceId: "fixture:TEST:marketing",
        title: "예약 10건 확보",
        type: "booking_count",
        period: "weekly",
        targetValue: 10,
        currentMeasuredValue: 8,
        unit: "건",
        startDate: "2026-08-25T00:00:00Z",
        endDate: "2026-09-01T20:00:00Z",
        rationale: "주간 예약 10건 달성을 통한 매출 목표 확보",
      });

      expect(goal.status).toBe("active");
      expect(goal.currentValue.provenance).toBe("measured");
      expect(goal.currentValue.value).toBe(8);
      expect(goal.progressPercent).toBe(80);
      expect(goal.gap).toBe(2);
    });
  });

  describe("[ANI-137] Opportunity Radar", () => {
    it("빈 슬롯과 미예약 문의 신호가 존재할 때 최우선 기회를 감지한다", () => {
      const opps = detectOpportunities({
        workspaceId: "fixture:TEST:marketing",
        emptySlotsCount: 2,
        emptySlotTargetDay: "목요일",
        unbookedInquiriesCount: 4,
        recontactEligibleCount: 3,
        pendingReviewsCount: 1,
        disconnectedChannelsCount: 0,
        expiringChannelsCount: 1,
      });

      expect(opps.length).toBeGreaterThanOrEqual(2);
      const emptySlotOpp = opps.find((o) => o.type === "empty_slot");
      expect(emptySlotOpp).toBeDefined();
      expect(emptySlotOpp?.title).toContain("목요일 빈 예약 2자리");
      expect(emptySlotOpp?.urgency).toBe("today");
      expect(emptySlotOpp?.confidence).toBe("high");
      expect(emptySlotOpp?.expectedCost.amount).toBe(0);
      expect(emptySlotOpp?.requiresApproval).toBe(true);
      expect(emptySlotOpp?.evidences).toHaveLength(4);
    });
  });

  describe("[ANI-138] Mission Engine", () => {
    it("Opportunity로부터 중단 조건과 승인 대기가 포함된 Mission을 생성한다", () => {
      const opps = detectOpportunities({
        workspaceId: "fixture:TEST:marketing",
        emptySlotsCount: 2,
        unbookedInquiriesCount: 4,
        recontactEligibleCount: 3,
        pendingReviewsCount: 0,
        disconnectedChannelsCount: 0,
        expiringChannelsCount: 0,
      });

      const mission = createMissionFromOpportunity(opps[0], "goal-123");
      expect(mission.steps.length).toBe(3);
      expect(mission.steps[0].status).toBe("completed");
      expect(mission.steps[1].status).toBe("awaiting_approval");
      expect(mission.steps[1].riskTier).toBe("approval_required");
      expect(mission.stopCondition).toBeDefined();

      // 사장님 승인 실행 테스트
      const approved = approveMissionStep(mission, mission.steps[1].id);
      expect(approved.steps[1].status).toBe("completed");
    });
  });

  describe("[ANI-142, ANI-143] Channel Capability Registry", () => {
    it("채널별 지원 모드와 상태를 올바르게 반환한다", () => {
      const ig = getChannelCapability("instagram");
      expect(ig.capabilities.publishPost).toBe("api_direct");
      expect(ig.capabilities.sendDirectMessage).toBe("assisted_export");

      const place = getChannelCapability("naver_place");
      expect(place.isTokenExpiringSoon).toBe(true);
      expect(place.healthStatus).toBe("warning");

      const kakao = getChannelCapability("kakaotalk_channel");
      expect(kakao.capabilities.sendDirectMessage).toBe("api_direct");
    });
  });

  describe("[ANI-145] Autonomy Guardrails & Kill Switch", () => {
    it("전역 킬 스위치 활성화 시 모든 행동을 차단한다", () => {
      const policy = { ...DEFAULT_AUTONOMY_POLICY, globalKillSwitchActive: true };
      const check = checkActionGuardrails(policy, "send_message", "kakaotalk_channel", "cust-1");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("킬 스위치");
    });

    it("외부 메시지 발송 시 승인 필요 상태를 반환한다", () => {
      const policy = { ...DEFAULT_AUTONOMY_POLICY, requireApprovalForExternalSend: true };
      const check = checkActionGuardrails(policy, "send_message", "kakaotalk_channel", "cust-1", new Date("2026-08-30T05:00:00Z")); // KST 14:00
      expect(check.allowed).toBe(true);
      expect(check.requiresApproval).toBe(true);
      expect(check.idempotencyKey).toContain("idemp:ws-default:kakaotalk_channel:send_message:cust-1");
    });
  });

  describe("[ANI-140] Attribution Ledger", () => {
    it("문의→답변→예약→방문예정 펀넬 및 직접/보조 기여도를 정밀 산출한다", () => {
      const records = [
        { attributionType: "direct" as const, revenueAmount: 85000 },
        { attributionType: "direct" as const, revenueAmount: 90000 },
        { attributionType: "assisted" as const, revenueAmount: 120000 },
      ];
      const summary = calculateAttributionSummary(records);
      expect(summary.totalDirectAttributedRevenue).toBe(175000);
      expect(summary.totalAssistedAttributedRevenue).toBe(120000);
      expect(summary.attributedBookingsDirect.value).toBe(2);
      expect(summary.attributedBookingsAssisted.value).toBe(1);
      expect(summary.totalAttributedRevenue.value).toBe(295000);
      expect(summary.funnelSteps).toHaveLength(3);
    });
  });


  describe("[ANI-141] Marketing Memory", () => {
    it("학습된 메모리를 신뢰도/카테고리별로 정렬하여 조회한다", () => {
      const memories = getRelevantMemories(INITIAL_BYREUM_MEMORIES, "winning_hook");
      expect(memories.length).toBeGreaterThan(0);
      expect(memories[0].category).toBe("winning_hook");
      expect(memories[0].confidence).toBe("verified_fact");
    });
  });
});
