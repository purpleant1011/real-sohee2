import { describe, it, expect, beforeEach } from "vitest";
import { detectOpportunities } from "../engine/opportunity-radar";
import { createMissionFromOpportunity } from "../engine/mission-engine";
import { executeActionWithSafety } from "../engine/action-state-machine";
import { filterRecontactSegment, sendKakaoFollowupMessage } from "../connectors/kakaotalk";
import { recordAttributionTouchpoint, calculateAttributionSummary } from "../engine/attribution-ledger";
import { addMarketingMemory, getMarketingMemories } from "../engine/marketing-memory";
import { resetDailyCounters, setWorkspaceKillSwitch } from "../engine/guardrails";

describe("Phase 7: Golden Path A End-to-End Loop (ANI-162)", () => {
  const workspaceId = "fixture:TEST:marketing";

  beforeEach(() => {
    resetDailyCounters(workspaceId);
    setWorkspaceKillSwitch({ workspaceId, active: false });
  });

  it("should complete full closed-loop: Slot Signal -> Opportunity -> Mission -> Approval -> Execution -> Attribution -> Memory", async () => {
    // Step 1: Detect Opportunities from Booking Slot Signals
    const opportunities = detectOpportunities({
      workspaceId,
      emptySlotsCount: 2,
      emptySlotTargetDay: "목요일",
      unbookedInquiriesCount: 4,
      recontactEligibleCount: 3,
      pendingReviewsCount: 1,
      disconnectedChannelsCount: 0,
      expiringChannelsCount: 0,
    });

    expect(opportunities.length).toBeGreaterThan(0);
    const topOpportunity = opportunities[0];
    expect(topOpportunity.type).toBe("empty_slot");
    expect(topOpportunity.urgency).toBe("today");
    expect(topOpportunity.confidenceScore).toBeGreaterThanOrEqual(85);

    // Step 2: Customer Consent & Segment Filtering
    const candidateCustomers = [
      { customerIdentifier: "cust-01", customerName: "김*아", lastVisitDate: "2026-08-01", marketingConsent: true, serviceCategory: "lash", cooldownSatisfied: true },
      { customerIdentifier: "cust-02", customerName: "이*진", lastVisitDate: "2026-08-10", marketingConsent: true, serviceCategory: "skin", cooldownSatisfied: true },
      { customerIdentifier: "cust-03", customerName: "박*영", lastVisitDate: "2026-08-28", marketingConsent: true, serviceCategory: "lash", cooldownSatisfied: false },
      { customerIdentifier: "cust-04", customerName: "최*민", lastVisitDate: "2026-07-20", marketingConsent: false, serviceCategory: "skin", cooldownSatisfied: true },
    ];

    const eligibleLeads = filterRecontactSegment(candidateCustomers, 7, new Date("2026-08-30T14:00:00Z"));
    expect(eligibleLeads.length).toBe(2); // Only cust-01 and cust-02 satisfy consent & 7-day cooldown

    // Step 3: Create Marketing Mission Plan from Opportunity
    const mission = createMissionFromOpportunity(topOpportunity, "goal-001");

    expect(mission.id).toBeDefined();
    expect(mission.status).toBe("running");
    expect(mission.steps.length).toBeGreaterThan(0);

    const approvalStep = mission.steps.find((s) => s.status === "awaiting_approval");
    expect(approvalStep).toBeDefined();

    // Step 4: Approval & Safe Action Execution
    const actionExecution = await executeActionWithSafety({
      actionId: approvalStep!.id,
      workspaceId,
      channel: "kakaotalk",
      idempotencyKey: `idem-golden-${approvalStep!.id}`,
      payload: { approved: true },
    });

    expect(actionExecution.status).toBe("succeeded");
    expect(actionExecution.executionCount).toBe(1);

    // Step 5: Provider Actual Send Check
    const providerSend = await sendKakaoFollowupMessage({
      customer: eligibleLeads[0],
      message: "목요일 14시 잔여 슬롯 안내",
      idempotencyKey: `idem-prov-${eligibleLeads[0].customerIdentifier}`,
    });

    expect(providerSend.status).toBe("sent");
    expect(providerSend.externalMessageId).toBeDefined();

    // Step 6: Customer Reply & Booking Conversion -> Record in Attribution Ledger
    const attributionTouchpoint = recordAttributionTouchpoint({
      workspaceId,
      touchpointType: "customer_message",
      channelKey: "kakaotalk_channel",
      targetCustomerIdentifier: eligibleLeads[0].customerIdentifier,
      contentOrCampaignId: mission.id,
      associatedBookingId: "bk-confirmed-9901",
      revenueAmount: 85000,
      attributionType: "direct",
      confidenceScore: 0.95,
      notes: "카카오톡 슬롯 링크 클릭 후 예약 확정",
    });

    expect(attributionTouchpoint.id).toBeDefined();
    expect(attributionTouchpoint.revenueAmount).toBe(85000);

    const summary = calculateAttributionSummary([attributionTouchpoint]);
    expect(summary.totalDirectAttributedRevenue).toBe(85000);
    expect(summary.directBookingConversionsCount).toBe(1);

    // Step 7: Feedback into Marketing Memory
    const memory = addMarketingMemory({
      workspaceId,
      category: "proven_hook",
      knowledgeType: "inference",
      title: "목요일 슬롯 안내 성공 패턴",
      content: "김*아 고객 대상 14시 특정 슬롯 언급 시 15분 내 전환 완료",
      source: "Golden Path Execution Outcome",
      confidenceScore: 0.95,
    });

    expect(memory.id).toBeDefined();
    const allMemories = getMarketingMemories(workspaceId);
    expect(allMemories.some((m) => m.title.includes("목요일"))).toBe(true);
  });
});
