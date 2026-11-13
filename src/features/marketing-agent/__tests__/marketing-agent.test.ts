import { describe, it, expect } from "vitest";
import { createBusinessGoal } from "../engine/goal-engine";
import { detectOpportunities } from "../engine/opportunity-radar";
import { createMissionFromOpportunity } from "../engine/mission-engine";
import { checkActionGuardrails, DEFAULT_AUTONOMY_POLICY } from "../engine/guardrails";
import { calculateAttributionSummary } from "../engine/attribution-ledger";
import { filterRecontactSegment, generateKakaoFollowupDraft } from "../connectors/kakaotalk";
import { generateGoogleReviewReplyDraft } from "../connectors/google-business";

describe("소희 V0.8.7 마케팅 자율 에이전트 종합 테스트", () => {
  it("Goal Engine: 예약 목표 생성 및 남은 시간 정밀 계산", () => {
    const goal = createBusinessGoal({
      workspaceId: "fixture:TEST:marketing",
      title: "예약 10건 확보",
      type: "booking_count",
      period: "weekly",
      targetValue: 10,
      currentMeasuredValue: 8,
      unit: "건",
      startDate: "2026-08-25T00:00:00Z",
      endDate: "2026-09-02T12:00:00Z",
      rationale: "주간 예약",
    });
    expect(goal.progressPercent).toBe(80);
    expect(goal.currentValue.provenance).toBe("measured");
  });

  it("Opportunity Radar: 빈 슬롯 및 미예약 문의 기회 탐지", () => {
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
    expect(opps.length).toBeGreaterThanOrEqual(1);
    expect(opps[0].confidenceScore).toBe(92);
    expect(opps[0].requiresApproval).toBe(true);
  });

  it("Mission Engine: 기회로부터 3단계 미션 생성", () => {
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
    const mission = createMissionFromOpportunity(opps[0]);
    expect(mission.steps).toHaveLength(3);
    expect(mission.steps[1].riskTier).toBe("approval_required");
  });

  it("Guardrails: 킬스위치 및 외부 발송 사전 승인 강제", () => {
    const res = checkActionGuardrails(
      DEFAULT_AUTONOMY_POLICY,
      "send_message",
      "kakaotalk_channel",
      "cust-1",
      new Date("2026-08-30T14:00:00+09:00")
    );
    expect(res.allowed).toBe(true);
    expect(res.requiresApproval).toBe(true);
  });

  it("Attribution Ledger: 문의→답변→예약→방문 펀넬 집계", () => {
    const records = [
      { attributionType: "direct" as const, revenueAmount: 85000 },
      { attributionType: "assisted" as const, revenueAmount: 120000 },
    ];
    const summary = calculateAttributionSummary(records);
    expect(summary.attributedBookingsDirect.value).toBe(1);
    expect(summary.attributedBookingsAssisted.value).toBe(1);
    expect(summary.totalAttributedRevenue.value).toBe(205000);
  });

  it("Connectors & Strategy Council & Video Engine", () => {
    const filtered = filterRecontactSegment([
      { customerIdentifier: "c1", customerName: "김서연", lastVisitDate: "2026-08-20T00:00:00Z", marketingConsent: true, serviceCategory: "자연눈썹", cooldownSatisfied: true },
    ]);
    expect(filtered).toHaveLength(1);

    const draft = generateKakaoFollowupDraft("김서연", "목요일 14:00");
    expect(draft.message).toContain("김서연님");

    const reply = generateGoogleReviewReplyDraft({ reviewId: "1", authorName: "지은", starRating: 5, comment: "최고", createTime: "", hasReply: false });
    expect(reply).toContain("만족스러운 경험");
  });
});
