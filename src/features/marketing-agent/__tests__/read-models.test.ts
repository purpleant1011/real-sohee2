import { describe, it, expect } from "vitest";
import { getTodayReadModel } from "@/lib/read-models/today-read-model";
import { getOpportunitiesReadModel } from "@/lib/read-models/opportunity-read-model";
import { getMissionDetailReadModel } from "@/lib/read-models/mission-read-model";
import { getInboxReadModel } from "@/lib/read-models/inbox-read-model";
import { getAttributionReadModel } from "@/lib/read-models/attribution-read-model";
import { getChannelsReadModel } from "@/lib/read-models/channel-read-model";
import { getMarketingMemoryReadModel } from "@/lib/read-models/memory-read-model";
import { getAutomationPolicyReadModel } from "@/lib/read-models/policy-read-model";

describe("V0.8.7 Real Data Read Models Suite (ANI-155)", () => {
  const testWorkspaceId = "ws-test-byreum";

  describe("Today Read Model", () => {
    it("should return valid provenance and structure for today cockpit", () => {
      const result = getTodayReadModel({
        workspaceId: testWorkspaceId,
        workspaceName: "바이름 청라",
        isDemo: true,
      });

      expect(result.workspaceId).toBe(testWorkspaceId);
      expect(result.dataFreshness).toBeDefined();
      expect(result.goal).toBeDefined();
      expect(result.goal.provenance).toBe("demo");
      expect(result.topOpportunity).toBeDefined();
      expect(result.topOpportunity?.expectedImpact.provenance).toBe("estimated");
      expect(result.pendingApprovals).toBeInstanceOf(Array);
      expect(result.channelHealthSummary).toBeDefined();
      expect(result.warnings).toBeInstanceOf(Array);
    });

    it("should return data_insufficient when required data sources are not connected", () => {
      const result = getTodayReadModel({
        workspaceId: "ws-empty",
        workspaceName: "신규 매장",
        isDemo: false,
        hasBookingConnection: false,
        hasChannelConnection: false,
      });

      expect(result.hasBookingConnection).toBe(false);
      expect(result.status).toBe("data_insufficient");
      expect(result.insufficientReasons).toContain("booking_calendar_not_connected");
      expect(result.topOpportunity).toBeNull();
    });
  });

  describe("Opportunity Radar Read Model", () => {
    it("should provide filtering, sorting, why one-liner, and signal provenance", () => {
      const list = getOpportunitiesReadModel({
        workspaceId: testWorkspaceId,
        isDemo: true,
        filter: "all",
        sortBy: "impact",
      });

      expect(list.totalCount).toBeGreaterThan(0);
      const top = list.items[0];
      expect(top.id).toBeDefined();
      expect(top.title).toBeDefined();
      expect(top.whyNow).toBeDefined();
      expect(top.evidence).toBeInstanceOf(Array);
      expect(top.evidence[0].source).toBeDefined();
      expect(top.evidence[0].provenance).toBeDefined();
      expect(top.status).toBe("active");
    });
  });

  describe("Mission Detail Read Model", () => {
    it("should return full execution plan with objective, risk tier, channels and stop condition", () => {
      const mission = getMissionDetailReadModel({
        missionId: "ms-001",
        workspaceId: testWorkspaceId,
      });

      expect(mission).toBeDefined();
      expect(mission.objective).toBeDefined();
      expect(mission.steps).toBeInstanceOf(Array);
      expect(mission.steps.length).toBeGreaterThan(0);
      expect(mission.steps[0].channel).toBeDefined();
      expect(mission.steps[0].riskTier).toBeDefined();
      expect(mission.stopCondition).toBeDefined();
      expect(mission.rollbackPlan).toBeDefined();
    });
  });

  describe("Unified Inbox Read Model", () => {
    it("should return conversations with intent, urgency, AI draft source and consent state", () => {
      const inbox = getInboxReadModel({
        workspaceId: testWorkspaceId,
        isDemo: true,
      });

      expect(inbox.conversations).toBeInstanceOf(Array);
      const conv = inbox.conversations[0];
      expect(conv.customerName).toBeDefined();
      expect(conv.intent).toBeDefined();
      expect(conv.urgency).toBeDefined();
      expect(conv.aiDraft).toBeDefined();
      expect(conv.aiDraft?.memorySource).toBeDefined();
      expect(conv.consentStatus).toBeDefined();
    });
  });

  describe("Attribution Ledger Read Model", () => {
    it("should strictly distinguish confirmed vs estimated revenue and direct vs assisted bookings", () => {
      const attr = getAttributionReadModel({
        workspaceId: testWorkspaceId,
        isDemo: true,
      });

      expect(attr.confirmedRevenue.provenance).toBe("demo");
      expect(attr.estimatedRevenue.provenance).toBe("estimated");
      expect(attr.touchpoints).toBeInstanceOf(Array);
      expect(attr.channelContributions).toBeInstanceOf(Array);
    });

    it("should return empty insufficient state when payment/booking not connected in production", () => {
      const attr = getAttributionReadModel({
        workspaceId: "ws-no-ledger",
        isDemo: false,
        hasLedger: false,
      });

      expect(attr.status).toBe("data_insufficient");
      expect(attr.touchpoints.length).toBe(0);
      expect(attr.confirmedRevenue.value).toBe(0);
    });
  });

  describe("Channel Capability & Connection Read Model", () => {
    it("should strictly separate Capability from Connection status", () => {
      const channels = getChannelsReadModel({
        workspaceId: testWorkspaceId,
      });

      expect(channels.length).toBe(7);
      channels.forEach(ch => {
        expect(ch.channelKey).toBeDefined();
        expect(ch.displayName).toBeDefined();
        expect(ch.capabilities).toBeInstanceOf(Array);
        expect(ch.connectionStatus).toBeDefined();
        expect(ch.executionMode).toBeDefined();
      });
    });
  });

  describe("Marketing Memory Read Model", () => {
    it("should distinguish facts from inferences and provide source, confidence, and verification date", () => {
      const memory = getMarketingMemoryReadModel({
        workspaceId: testWorkspaceId,
      });

      expect(memory.items).toBeInstanceOf(Array);
      const fact = memory.items.find(i => i.type === "fact");
      const inference = memory.items.find(i => i.type === "inference");

      expect(fact).toBeDefined();
      expect(fact?.source).toBeDefined();
      expect(fact?.lastVerifiedAt).toBeDefined();

      expect(inference).toBeDefined();
      expect(inference?.confidence).toBeGreaterThan(0);
      expect(inference?.decayDays).toBeDefined();
    });
  });

  describe("Automation Policy & Guardrails Read Model", () => {
    it("should return server-owned policy, kill switch status, and daily caps", () => {
      const policy = getAutomationPolicyReadModel({
        workspaceId: testWorkspaceId,
      });

      expect(policy.workspaceKillSwitch).toBeDefined();
      expect(policy.globalKillSwitch).toBe(false);
      expect(policy.dailySpendCap).toBeGreaterThan(0);
      expect(policy.dailySendCap).toBeGreaterThan(0);
      expect(policy.quietHours).toBeDefined();
      expect(policy.auditLogs).toBeInstanceOf(Array);
    });
  });
});
