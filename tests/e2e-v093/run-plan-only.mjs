/**
 * Standalone PLAN_ONLY Runner for V0.93 E2E Skeleton (ANI-1635)
 *
 * Runs without external npm dependencies or browser launching.
 * Dynamically measures local git provenance via read-only CLI calls anchored to the repo root.
 * Emits tests/e2e-v093/evidence/execution-summary.json.
 *
 * Invariant:
 * Emits exit code 2 (NOT_VERIFIED / Readiness unverified).
 * This plan runner does NOT claim exit 0 E2E gate clearance.
 *
 * Usage:
 *   node tests/e2e-v093/run-plan-only.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const STEP_IDS = [
  "E093-01", "E093-02", "E093-03", "E093-04",
  "E093-05", "E093-06", "E093-07", "E093-08",
  "E093-09", "E093-10", "E093-11", "E093-12",
];

const VIEWPORTS = ["MOBILE", "PC"];

function measureGitProvenance() {
  try {
    const headCommitSha = execSync("git rev-parse HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const statusOutput = execSync("git status --porcelain", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const isClean = statusOutput.length === 0;

    return {
      repoRoot: REPO_ROOT,
      observedHeadSha: headCommitSha,
      isWorkingTreeDirty: !isClean,
      sourceScope: isClean ? "COMMITTED_HEAD" : "UNATTESTED_WORKTREE",
      uncommittedEntriesCount: isClean ? 0 : statusOutput.split("\n").filter(Boolean).length,
    };
  } catch {
    return {
      repoRoot: REPO_ROOT,
      observedHeadSha: "NOT_OBSERVED",
      isWorkingTreeDirty: null,
      sourceScope: "NOT_OBSERVED",
      uncommittedEntriesCount: null,
    };
  }
}

async function main() {
  const provenance = measureGitProvenance();

  const stepResults = [];
  for (const stepId of STEP_IDS) {
    for (const vp of VIEWPORTS) {
      stepResults.push({
        stepId,
        viewport: vp,
        status: "NOT_VERIFIED",
        reason: "PLAN_ONLY: Execution deferred until integration and fixture wiring",
      });
    }
  }

  const payload = {
    executionMode: "PLAN_ONLY",
    testedSha: provenance.isWorkingTreeDirty ? "UNATTESTED_WORKTREE" : provenance.observedHeadSha,
    gitProvenance: provenance,
    actionsAttempted: 0,
    durationMs: null,
    screenshotPath: null,
    observationSlotsTotal: stepResults.length,
    notVerifiedSlotsCount: stepResults.length,
    contractCompletedSteps: 0,
    verifiedBusinessTasksCount: 0,
    stepObservations: stepResults,
    contractsDeclaredContractOnly: [
      "Exact loopback origins only (credentials and external domains rejected without leaking strings)",
      "Fail-closed on ACTUAL, SHOWCASE_DEMO, and UNKNOWN datasets",
      "Two matching errors or two matching NULLs forbidden from parity PASS",
      "Canonical epoch match required before step-specific field parity check",
      "Strict sequence comparison for imageReferences (sorting forbidden)",
      "Strict cross-tenant refusal required (403/404 only; same-tenant, 200, and data leaks rejected)",
      "Anti-optimism: 24 observation slots strictly separated from 0 verified business tasks",
      "Factory thunk driver prevents browser launching in PLAN_ONLY mode",
      "Live execution gates ANI-1598, ANI-1604, ANI-1613 required for LIVE_ALLOWLIST",
    ],
    executionExitCode: 2,
    exitReason: "READINESS_UNVERIFIED_PLAN_ONLY",
  };

  const outputPath = path.resolve(__dirname, "evidence/execution-summary.json");
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`[ANI-1635] PLAN_ONLY summary written to ${outputPath} (readiness unverified, exiting with code 2)`);

  // Explicit exit 2: Signals unverified readiness / plan only (not E2E gate success)
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
