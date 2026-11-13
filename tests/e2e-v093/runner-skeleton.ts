/**
 * E2E Runner Skeleton (ANI-1635)
 *
 * Implements PLAN_ONLY dry-run mode and strict live approval gate enforcement.
 */

import {
  createObservationSlots,
  countVerifiedBusinessTasks,
  type StepId,
  type ViewportKey,
} from "./manifest";
import type { EgoAdapterSkeleton } from "./ego-adapter";

export interface GitProvenance {
  headCommitSha: string;
  isClean: boolean;
  workingTreeScope: string;
}

export interface PlanOnlyOptions {
  adapter?: EgoAdapterSkeleton;
  gitProvenance?: GitProvenance;
}

export interface StepExecutionReport {
  stepId: StepId;
  viewport: ViewportKey;
  status: "NOT_VERIFIED" | "PASS" | "FAIL";
  reason: string;
}

export interface PlanOnlyReport {
  mode: "PLAN_ONLY";
  testedSha: string;
  gitProvenance: GitProvenance | null;
  actionsAttempted: number;
  durationMs: null;
  screenshotPath: null;
  stepResults: StepExecutionReport[];
  verifiedTasksCount: number;
  summary: string;
}

export interface LiveApprovalRequest {
  userApproved: boolean;
  allowedGates: string[];
}

export interface LiveAttemptResult {
  allowed: boolean;
  status: "NOT_VERIFIED" | "REJECTED";
  reason: string;
  actionsAttempted: number;
}

/**
 * Executes the E2E suite in PLAN_ONLY dry-run mode.
 *
 * Invariants:
 * - 0 browser actions, 0 HTTP mutations, 0 DB writes.
 * - Adapter methods (e.g. isReady(), executeStep()) are NEVER called in PLAN_ONLY mode.
 * - testedSha is NOT hardcoded; populated only from observed git provenance, otherwise NOT_OBSERVED.
 * - All steps report NOT_VERIFIED with null durations and null screenshots.
 */
export async function runE2EPlanOnly(options?: PlanOnlyOptions): Promise<PlanOnlyReport> {
  // Invariant: Do NOT invoke options?.adapter methods or start any driver in PLAN_ONLY mode.
  // The adapter reference is kept strictly unused to avoid any injection side effects.

  const slots = createObservationSlots();
  const stepResults: StepExecutionReport[] = [];

  for (const slot of slots) {
    stepResults.push({
      stepId: slot.stepId,
      viewport: slot.viewport,
      status: "NOT_VERIFIED",
      reason: "PLAN_ONLY: Execution deferred until integration and fixture wiring",
    });
  }

  const provenance = options?.gitProvenance ?? null;
  const testedSha = provenance?.headCommitSha ?? "NOT_OBSERVED";

  return {
    mode: "PLAN_ONLY",
    testedSha,
    gitProvenance: provenance,
    actionsAttempted: 0,
    durationMs: null,
    screenshotPath: null,
    stepResults,
    verifiedTasksCount: countVerifiedBusinessTasks(slots),
    summary: "PLAN_ONLY dry-run complete. 24 observation slots recorded as NOT_VERIFIED. 0 business tasks verified.",
  };
}

/**
 * Strictly verifies required external live issue gates.
 * Simple boolean flags such as `userApproved: true` do NOT bypass this gate.
 * Mandatory gates required: ANI-1598 (publish), ANI-1604 (DM read/write), ANI-1613 (customer acceptance/booking).
 */
export async function attemptLiveRun(
  request: LiveApprovalRequest
): Promise<LiveAttemptResult> {
  const requiredGates = ["ANI-1598", "ANI-1604", "ANI-1613"];
  const hasAllGates = requiredGates.every((gate) => request.allowedGates.includes(gate));

  if (!hasAllGates) {
    return {
      allowed: false,
      status: "NOT_VERIFIED",
      reason: "LIVE_APPROVAL_GATES_MISSING",
      actionsAttempted: 0,
    };
  }

  // Even if gates are present, live execution in this worktree phase is disabled
  return {
    allowed: false,
    status: "NOT_VERIFIED",
    reason: "LIVE_EXECUTION_BLOCKED_IN_SKELETON_PHASE",
    actionsAttempted: 0,
  };
}
