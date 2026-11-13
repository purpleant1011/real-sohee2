import { describe, it, expect, beforeEach } from "vitest";
import { 
  ActionExecutionStateMachine, 
  executeActionWithSafety 
} from "@/features/marketing-agent/engine/action-state-machine";
import { 
  enforceActionPolicy, 
  setWorkspaceKillSwitch, 
  resetDailyCounters,
  getGuardrailPolicyState 
} from "@/features/marketing-agent/engine/guardrails";

describe("Phase 2: Safe Action & Server Policy Layer (ANI-158, ANI-161)", () => {
  const testWorkspaceId = "ws-safety-test";

  beforeEach(() => {
    resetDailyCounters(testWorkspaceId);
    setWorkspaceKillSwitch({ workspaceId: testWorkspaceId, active: false });
  });

  describe("Action Execution State Machine", () => {
    it("should follow strict multi-step transition instead of fake alert success", async () => {
      const stateMachine = new ActionExecutionStateMachine({
        actionId: "act-101",
        workspaceId: testWorkspaceId,
        channel: "kakaotalk",
        payload: { text: "안녕하세요" },
      });

      expect(stateMachine.getStatus()).toBe("draft");

      stateMachine.requestApproval();
      expect(stateMachine.getStatus()).toBe("approval_pending");

      stateMachine.approve("user-purpleant");
      expect(stateMachine.getStatus()).toBe("approved");

      stateMachine.queue();
      expect(stateMachine.getStatus()).toBe("queued");

      stateMachine.startExecution();
      expect(stateMachine.getStatus()).toBe("executing");

      stateMachine.awaitVerification("prov-tx-999");
      expect(stateMachine.getStatus()).toBe("verification_pending");

      stateMachine.markVerifiedSuccess({ externalMessageId: "kakao-msg-777" });
      expect(stateMachine.getStatus()).toBe("succeeded");
      expect(stateMachine.getExecutionResult()?.externalMessageId).toBe("kakao-msg-777");
    });

    it("should guarantee idempotency with same idempotency key", async () => {
      const idempotencyKey = "idem-key-abc-123";

      const firstCall = await executeActionWithSafety({
        actionId: "act-first",
        workspaceId: testWorkspaceId,
        channel: "kakaotalk",
        idempotencyKey,
        payload: { text: "첫번째 실행" },
      });

      expect(firstCall.status).toBe("succeeded");
      expect(firstCall.executionCount).toBe(1);

      // Duplicate double-click attempt with same key
      const secondCall = await executeActionWithSafety({
        actionId: "act-second",
        workspaceId: testWorkspaceId,
        channel: "kakaotalk",
        idempotencyKey,
        payload: { text: "중복 클릭 시도" },
      });

      expect(secondCall.status).toBe("succeeded");
      expect(secondCall.isDuplicateReplay).toBe(true);
      expect(secondCall.executionCount).toBe(1); // Provider executed only once
    });
  });

  describe("Server Policy & Kill Switch Enforcement", () => {
    it("should block all external executions immediately when workspace kill switch is active", async () => {
      setWorkspaceKillSwitch({
        workspaceId: testWorkspaceId,
        active: true,
        reason: "원장님 긴급 중단 요청",
      });

      const policyCheck = enforceActionPolicy({
        workspaceId: testWorkspaceId,
        channel: "kakaotalk",
        cost: 15,
        targetTime: "2026-08-30T14:00:00Z",
      });

      expect(policyCheck.allowed).toBe(false);
      expect(policyCheck.status).toBe("blocked_by_policy");
      expect(policyCheck.blockReason).toContain("킬스위치");
    });

    it("should block execution when daily spend cap is exceeded", () => {
      const policyState = getGuardrailPolicyState(testWorkspaceId);
      const exceedCost = policyState.dailySpendCap + 1000;

      const policyCheck = enforceActionPolicy({
        workspaceId: testWorkspaceId,
        channel: "kakaotalk",
        cost: exceedCost,
        targetTime: "2026-08-30T14:00:00Z",
      });

      expect(policyCheck.allowed).toBe(false);
      expect(policyCheck.status).toBe("blocked_by_policy");
      expect(policyCheck.blockReason).toContain("일일 지출 한도");
    });

    it("should block execution during quiet hours (e.g. night time)", () => {
      const nightTime = "2026-08-30T23:30:00+09:00"; // 23:30 (Quiet Hours)

      const policyCheck = enforceActionPolicy({
        workspaceId: testWorkspaceId,
        channel: "kakaotalk",
        cost: 15,
        targetTime: nightTime,
      });

      expect(policyCheck.allowed).toBe(false);
      expect(policyCheck.status).toBe("blocked_by_policy");
      expect(policyCheck.blockReason).toContain("방해금지 시간");
    });
  });
});
