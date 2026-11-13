import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MANIFEST_STEPS,
  createObservationSlots,
  countVerifiedBusinessTasks,
  countContractCompletedSteps,
  type StepId,
  type ObservationSlot,
} from "./manifest";
import {
  validateLoopbackOrigin,
  validateTestEnvironmentProof,
  type EnvironmentProof,
} from "./preflight";
import {
  compareObservedStates,
  evaluateCrossTenantIsolation,
  type ObservedState,
  type CrossTenantObservation,
} from "./state-contract";
import {
  runE2EPlanOnly,
  type GitProvenance,
} from "./runner-skeleton";

describe("E2E V0.93 Preflight & Loopback Security Guards", () => {
  it("allows only exact loopback origins without credentials and avoids leaking raw URL/error strings in reasons", () => {
    expect(validateLoopbackOrigin("http://localhost:3000").valid).toBe(true);
    expect(validateLoopbackOrigin("http://127.0.0.1:8787").valid).toBe(true);
    expect(validateLoopbackOrigin("http://[::1]:8080").valid).toBe(true);

    // Negative guards: reject credentials, similar hosts, external domains
    expect(validateLoopbackOrigin("http://user:pass@localhost:3000").valid).toBe(false);
    expect(validateLoopbackOrigin("http://localhost.attacker.com:3000").valid).toBe(false);
    expect(validateLoopbackOrigin("http://127.0.0.1.nip.io").valid).toBe(false);
    expect(validateLoopbackOrigin("https://example.com").valid).toBe(false);
    expect(validateLoopbackOrigin("https://example.com").valid).toBe(false);

    // Privacy guard: invalid URL containing secret must NOT reflect secret in reason
    const secretUrl = "http://bad-domain.com?secret_token=SECRET_KEY_12345";
    const secretRes = validateLoopbackOrigin(secretUrl);
    expect(secretRes.valid).toBe(false);
    expect(secretRes.reason).toBe("NON_LOOPBACK_HOSTNAME_FORBIDDEN");
    expect(secretRes.reason).not.toContain("SECRET_KEY_12345");

    const malformedSecretUrl = "ht!tp://%%%bad_url_with_secret_xyz";
    const malformedRes = validateLoopbackOrigin(malformedSecretUrl);
    expect(malformedRes.valid).toBe(false);
    expect(malformedRes.reason).toBe("INVALID_URL_SYNTAX");
    expect(malformedRes.reason).not.toContain("secret_xyz");
  });

  it("fail-closed on ACTUAL, SHOWCASE_DEMO, UNKNOWN, arbitrary strings, and unbound server attestor", () => {
    // ACTUAL dataset mode must fail-closed with fixed code
    const actualProof: EnvironmentProof = {
      datasetMode: "ACTUAL",
      serverIsolationProof: "hash-actual-secret-xyz",
      providerWritesBlocked: true,
      adapterBindingPresent: true,
    };
    const actualRes = validateTestEnvironmentProof(actualProof);
    expect(actualRes.allowed).toBe(false);
    expect(actualRes.reason).toBe("DATASET_MODE_NOT_TEST");
    expect(actualRes.reason).not.toContain("secret-xyz");

    // SHOWCASE_DEMO must fail-closed
    const showcaseProof: EnvironmentProof = {
      datasetMode: "SHOWCASE_DEMO",
      serverIsolationProof: "hash-showcase",
      providerWritesBlocked: true,
      adapterBindingPresent: true,
    };
    expect(validateTestEnvironmentProof(showcaseProof).allowed).toBe(false);
    expect(validateTestEnvironmentProof(showcaseProof).reason).toBe("DATASET_MODE_NOT_TEST");

    // UNKNOWN must fail-closed
    const unknownProof: EnvironmentProof = {
      datasetMode: "UNKNOWN",
      serverIsolationProof: "hash-unknown",
      providerWritesBlocked: true,
      adapterBindingPresent: true,
    };
    expect(validateTestEnvironmentProof(unknownProof).allowed).toBe(false);

    // Arbitrary client string or 64-hex string does NOT grant execution because attestor is unbound
    const wellFormedProof: EnvironmentProof = {
      datasetMode: "TEST",
      serverIsolationProof: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      providerWritesBlocked: true,
      adapterBindingPresent: true,
    };
    const res = validateTestEnvironmentProof(wellFormedProof);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("ENV_ATTESTATION_UNBOUND");
  });
});

describe("E2E V0.93 State Contract & Cross-Device Parity Rules", () => {
  const baseValidState: ObservedState = {
    workspaceAlias: "ws-test-a",
    canonicalWorkRef: "work-901",
    canonicalEpoch: "epoch-100",
    sourceSnapshotVersion: "snap-v1",
    draftRevision: "rev-2",
    imageReferences: ["img-test-1", "img-test-2"],
    assetRightsDigest: "sha256-rights-01",
    factSnapshotVersion: "fact-v1",
    approvedRevision: "rev-2",
    approvedDigest: "sha256-digest-rev2",
    publishState: "NOT_PUBLISHED",
    caseReference: "case-01",
    senderSource: "inbound-dm-01",
    customerAcceptanceBinding: "accept-bind-01",
    bookingId: "book-1001",
    bookingVersion: "bver-1",
    amountProvenance: { amount: 50000, currency: "KRW", status: "PENDING_SETTLEMENT" },
    canonical5ViewCheck: "5view-ok",
    activeStateAtRefresh: "active-ok",
    crossTenantCheck: "cross-ok",
    datasetMode: "TEST",
    observedAt: "2026-10-22T00:00:00.000Z",
    source: "mobile-375",
    creationState: "CREATED",
    error: null,
  };

  it("requires stepId to compare states safely; missing stepId returns NOT_VERIFIED", () => {
    const pcState: ObservedState = {
      ...baseValidState,
      observedAt: "2026-10-22T00:00:05.000Z",
      source: "pc-1440",
    };
    const res = compareObservedStates(baseValidState, pcState);
    expect(res.status).toBe("NOT_VERIFIED");
    expect(res.reason).toBe("STEP_ID_REQUIRED");
  });

  it("passes parity for valid step when canonical epoch and step required fields match", () => {
    const pcState: ObservedState = {
      ...baseValidState,
      observedAt: "2026-10-22T00:00:05.000Z",
      source: "pc-1440",
    };
    const res = compareObservedStates(baseValidState, pcState, "E093-01");
    expect(res.status).toBe("PASS");
    expect(res.epochMatched).toBe(true);
  });

  it("strictly checks value equality for step fields (e.g. factSnapshotVersion mismatch in E093-03 causes FAIL)", () => {
    const alteredFactState: ObservedState = {
      ...baseValidState,
      factSnapshotVersion: "fact-v2-different",
    };
    const res = compareObservedStates(baseValidState, alteredFactState, "E093-03");
    expect(res.status).toBe("FAIL");
    expect(res.reason).toBe("BUSINESS_FIELD_MISMATCH");
    expect(res.diffs).toContain("DIFF_FIELD: factSnapshotVersion");
    expect(JSON.stringify(res.diffs)).not.toContain("fact-v2-different");
  });

  it("compares imageReferences in strict order (sorting is forbidden because approval order is load-bearing)", () => {
    const reversedOrderState: ObservedState = {
      ...baseValidState,
      imageReferences: ["img-test-2", "img-test-1"],
    };
    const res = compareObservedStates(baseValidState, reversedOrderState, "E093-04");
    expect(res.status).toBe("FAIL");
    expect(res.reason).toBe("BUSINESS_FIELD_MISMATCH");
    expect(res.diffs).toContain("DIFF_FIELD: imageReferences");
  });

  it("rejects non-array or non-string elements in imageReferences without throwing TypeError", () => {
    const malformedImageState = {
      ...baseValidState,
      imageReferences: "not-an-array" as unknown as string[],
    };
    const res = compareObservedStates(malformedImageState, malformedImageState, "E093-04");
    expect(res.status).toBe("FAIL");
    expect(res.reason).toBe("INVALID_IMAGE_REFERENCES_TYPE");

    const nonStringElements = {
      ...baseValidState,
      imageReferences: [123, null] as unknown as string[],
    };
    const resElem = compareObservedStates(nonStringElements, nonStringElements, "E093-04");
    expect(resElem.status).toBe("FAIL");
    expect(resElem.reason).toBe("INVALID_IMAGE_REFERENCES_TYPE");
  });

  it("strictly validates amountProvenance: rejects empty object {}, both ERROR, non-finite, or missing fields", () => {
    // Empty object {} vs {}
    const emptyObjectState = {
      ...baseValidState,
      amountProvenance: {} as unknown as any,
    };
    const resEmpty = compareObservedStates(emptyObjectState, emptyObjectState, "E093-09");
    expect(resEmpty.status).toBe("FAIL");
    expect(resEmpty.reason).toBe("INVALID_AMOUNT_PROVENANCE_SHAPE");

    // Both status === ERROR
    const bothErrorState = {
      ...baseValidState,
      amountProvenance: { amount: 50000, currency: "KRW", status: "ERROR" },
    };
    const resErr = compareObservedStates(bothErrorState, bothErrorState, "E093-09");
    expect(resErr.status).toBe("FAIL");
    expect(resErr.reason).toBe("AMOUNT_PROVENANCE_STATUS_ERROR");

    // Non-finite or negative amount
    const negativeState = {
      ...baseValidState,
      amountProvenance: { amount: -100, currency: "KRW", status: "SETTLED" },
    };
    expect(compareObservedStates(negativeState, negativeState, "E093-09").status).toBe("FAIL");

    // Observed 0 is legally allowed when currency and status are valid
    const zeroAmountState = {
      ...baseValidState,
      amountProvenance: { amount: 0, currency: "KRW", status: "SETTLED" },
    };
    expect(compareObservedStates(zeroAmountState, zeroAmountState, "E093-09").status).toBe("PASS");

    // Unknown or non-allowlisted status (e.g. UNKNOWN, CUSTOM) must fail
    const unknownStatusState = {
      ...baseValidState,
      amountProvenance: { amount: 50000, currency: "KRW", status: "UNKNOWN" },
    };
    const resUnkStatus = compareObservedStates(unknownStatusState, unknownStatusState, "E093-09");
    expect(resUnkStatus.status).toBe("FAIL");
    expect(resUnkStatus.reason).toBe("AMOUNT_PROVENANCE_STATUS_INVALID");

    // Unsupported currency (e.g. arbitrary string XYZ) must fail
    const unsupportedCurrencyState = {
      ...baseValidState,
      amountProvenance: { amount: 50000, currency: "XYZ", status: "SETTLED" },
    };
    const resCurr = compareObservedStates(unsupportedCurrencyState, unsupportedCurrencyState, "E093-09");
    expect(resCurr.status).toBe("FAIL");
    expect(resCurr.reason).toBe("UNSUPPORTED_CURRENCY");
  });

  it("strictly validates observedAt timezone, non-blank source, and non-blank workspaceAlias", () => {
    // Date-only string (e.g. "2026-10-22") must NOT be mistaken for timezone offset
    const dateOnlyState: ObservedState = {
      ...baseValidState,
      observedAt: "2026-10-22",
    };
    const resDateOnly = compareObservedStates(dateOnlyState, dateOnlyState, "E093-01");
    expect(resDateOnly.status).toBe("FAIL");
    expect(resDateOnly.reason).toBe("INVALID_OBSERVED_AT_TIMESTAMP");

    // Missing timezone in timestamp
    const noTzState: ObservedState = {
      ...baseValidState,
      observedAt: "2026-10-22T00:00:00", // No Z or offset
    };
    const resTz = compareObservedStates(noTzState, noTzState, "E093-01");
    expect(resTz.status).toBe("FAIL");
    expect(resTz.reason).toBe("INVALID_OBSERVED_AT_TIMESTAMP");

    // Blank source
    const blankSourceState: ObservedState = {
      ...baseValidState,
      source: "   ",
    };
    const resSrc = compareObservedStates(blankSourceState, blankSourceState, "E093-01");
    expect(resSrc.status).toBe("FAIL");
    expect(resSrc.reason).toBe("INVALID_SOURCE");

    // Blank workspaceAlias
    const blankWsState: ObservedState = {
      ...baseValidState,
      workspaceAlias: "",
    };
    const resWs = compareObservedStates(blankWsState, blankWsState, "E093-01");
    expect(resWs.status).toBe("FAIL");
    expect(resWs.reason).toBe("INVALID_WORKSPACE_ALIAS");
  });

  it("handles legal NOT_CREATED creationState explicitly and rejects two undefined matching workrefs", () => {
    // Work item legitimately not created yet (e.g. before creation flow)
    const legitNotCreated: ObservedState = {
      ...baseValidState,
      canonicalWorkRef: undefined as unknown as string,
      creationState: "NOT_CREATED",
    };
    const resLegit = compareObservedStates(legitNotCreated, legitNotCreated, "E093-01");
    expect(resLegit.status).toBe("PASS");

    // Two undefined workrefs without explicit NOT_CREATED must NOT pass
    const unconfirmedUndefined: ObservedState = {
      ...baseValidState,
      canonicalWorkRef: undefined as unknown as string,
      creationState: undefined,
    };
    const resUnconfirmed = compareObservedStates(unconfirmedUndefined, unconfirmedUndefined, "E093-01");
    expect(resUnconfirmed.status).toBe("FAIL");
    expect(resUnconfirmed.reason).toBe("UNCONFIRMED_CREATION_STATE");
  });

  it("protects privacy by never leaking error messages or fixture secrets in diffs or reason", () => {
    const errStateA: ObservedState = {
      ...baseValidState,
      error: "DATABASE_TIMEOUT_WITH_SECRET_PASSWORD_XYZ123",
    };
    const errStateB: ObservedState = {
      ...baseValidState,
      error: "DATABASE_TIMEOUT_WITH_SECRET_PASSWORD_XYZ123",
    };
    const res = compareObservedStates(errStateA, errStateB, "E093-01");
    expect(res.status).toBe("FAIL");
    expect(res.reason).toBe("PARITY_BOTH_ERROR_FORBIDDEN");
    expect(JSON.stringify(res)).not.toContain("SECRET_PASSWORD_XYZ123");
  });

  it("strictly validates cross-tenant evaluation: rejects same-tenant and invalid counts", () => {
    const sameTenant: CrossTenantObservation = {
      requestingTenant: "tenant-a",
      targetTenant: "tenant-a",
      httpStatus: 403,
      dataReturnedCount: 0,
      leakedAssetReferences: [],
    };
    expect(evaluateCrossTenantIsolation(sameTenant).status).toBe("NOT_VERIFIED");
    expect(evaluateCrossTenantIsolation(sameTenant).reason).toBe("INVALID_CROSS_TENANT_PAIR: SAME_TENANT");

    const invalidCount: CrossTenantObservation = {
      requestingTenant: "tenant-a",
      targetTenant: "tenant-b",
      httpStatus: 403,
      dataReturnedCount: NaN,
      leakedAssetReferences: [],
    };
    expect(evaluateCrossTenantIsolation(invalidCount).status).toBe("NOT_VERIFIED");
    expect(evaluateCrossTenantIsolation(invalidCount).reason).toBe("INSUFFICIENT_OBSERVATION");

    const validCross: CrossTenantObservation = {
      requestingTenant: "tenant-a",
      targetTenant: "tenant-b",
      httpStatus: 403,
      dataReturnedCount: 0,
      leakedAssetReferences: [],
    };
    expect(evaluateCrossTenantIsolation(validCross).status).toBe("PASS");
  });
});

describe("E2E V0.93 Manifest & Anti-Optimism Accounting Invariants", () => {
  it("contains all 12 canonical steps in MANIFEST_STEPS and verifies zero drift with run-plan-only.mjs", () => {
    expect(MANIFEST_STEPS).toHaveLength(12);
    const manifestIds = MANIFEST_STEPS.map((s) => s.stepId);

    // Read run-plan-only.mjs and extract STEP_IDS array
    const runPlanOnlyPath = path.resolve(__dirname, "run-plan-only.mjs");
    const scriptContent = fs.readFileSync(runPlanOnlyPath, "utf-8");
    const match = scriptContent.match(/STEP_IDS\s*=\s*\[([\s\S]*?)\];/);
    expect(match).not.toBeNull();
    const parsedStepIds = (match![1].match(/"(E093-\d{2})"/g) || []).map((s) => s.replace(/"/g, ""));

    expect(parsedStepIds).toEqual(manifestIds);
  });

  it("strictly forbids counting bare PASS slots (missing evidenceRef or observedAt) as verified tasks", () => {
    const slots = createObservationSlots();
    const barePassSlots: ObservationSlot[] = slots.map((s) => ({
      ...s,
      status: "PASS",
      evidenceRef: null,
      observedAt: null,
    }));

    expect(countVerifiedBusinessTasks(barePassSlots)).toBe(0);
    expect(countContractCompletedSteps(barePassSlots)).toBe(0);
  });

  it("strictly rejects counting steps with duplicated viewports or mixed FAIL", () => {
    const malformedSlots: ObservationSlot[] = [
      {
        stepId: "E093-01",
        viewport: "MOBILE",
        status: "PASS",
        evidenceRef: "ref-1",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
      {
        stepId: "E093-01",
        viewport: "MOBILE",
        status: "PASS",
        evidenceRef: "ref-2",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
    ];
    expect(countContractCompletedSteps(malformedSlots)).toBe(0);

    const mixedSlots: ObservationSlot[] = [
      {
        stepId: "E093-01",
        viewport: "MOBILE",
        status: "PASS",
        evidenceRef: "ref-1",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
      {
        stepId: "E093-01",
        viewport: "PC",
        status: "FAIL",
        evidenceRef: "ref-2",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
    ];
    expect(countContractCompletedSteps(mixedSlots)).toBe(0);
  });

  it("ignores unknown/non-canonical step IDs (e.g. E093-13)", () => {
    const unknownStepSlots: ObservationSlot[] = [
      {
        stepId: "E093-13" as StepId,
        viewport: "MOBILE",
        status: "PASS",
        evidenceRef: "ref-1",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
      {
        stepId: "E093-13" as StepId,
        viewport: "PC",
        status: "PASS",
        evidenceRef: "ref-2",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
    ];
    expect(countContractCompletedSteps(unknownStepSlots)).toBe(0);
  });

  it("strictly separates contract completed steps from real E2E verified business tasks (which is 0 in skeleton phase)", () => {
    const validFixtureSlots: ObservationSlot[] = [
      {
        stepId: "E093-01",
        viewport: "MOBILE",
        status: "PASS",
        evidenceRef: "fixture-evidence-01",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
      {
        stepId: "E093-01",
        viewport: "PC",
        status: "PASS",
        evidenceRef: "fixture-evidence-02",
        observedAt: "2026-10-22T00:00:00.000Z",
      },
    ];

    expect(countContractCompletedSteps(validFixtureSlots)).toBe(1);
    expect(countVerifiedBusinessTasks(validFixtureSlots)).toBe(0);
  });
});

describe("E2E V0.93 Runner Skeleton & Injection Zero-Call Invariants", () => {
  it("never calls adapter.isReady() or any adapter methods in PLAN_ONLY mode", async () => {
    let methodCalled = false;
    const sideEffectAdapter = {
      isReady: () => {
        methodCalled = true;
        throw new Error("adapter.isReady() must NOT be called in PLAN_ONLY mode!");
      },
      executeStep: async () => {
        methodCalled = true;
        throw new Error("adapter.executeStep() must NOT be called in PLAN_ONLY mode!");
      },
    };

    const report = await runE2EPlanOnly({ adapter: sideEffectAdapter as unknown as any });
    expect(methodCalled).toBe(false);
    expect(report.mode).toBe("PLAN_ONLY");
    expect(report.actionsAttempted).toBe(0);
  });

  it("does not hardcode testedSha; records uncommitted working-tree provenance or NOT_OBSERVED", async () => {
    const reportWithoutProvenance = await runE2EPlanOnly();
    expect(reportWithoutProvenance.testedSha).toBe("NOT_OBSERVED");

    const validProvenance: GitProvenance = {
      headCommitSha: "742ee9accb784afb48368ae3c2b919a45f0f5b7d",
      isClean: false,
      workingTreeScope: "tests/e2e-v093/** and .claude/w3-e2e-* only",
    };
    const reportWithProvenance = await runE2EPlanOnly({ gitProvenance: validProvenance });
    expect(reportWithProvenance.testedSha).toBe("742ee9accb784afb48368ae3c2b919a45f0f5b7d");
    expect(reportWithProvenance.gitProvenance?.workingTreeScope).toBe("tests/e2e-v093/** and .claude/w3-e2e-* only");
  });
});
