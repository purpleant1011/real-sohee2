/**
 * State Comparison and Cross-Device Parity Contracts (ANI-1635)
 */

import { MANIFEST_STEPS, type StepId } from "./manifest";

export type ExplicitCreationState = "CREATED" | "NOT_CREATED" | "NOT_APPLICABLE";

export interface AmountProvenance {
  amount: number;
  currency: string;
  status: string;
}

export interface ObservedState {
  workspaceAlias: string;
  canonicalWorkRef?: string;
  canonicalEpoch: string;
  sourceSnapshotVersion?: string;
  draftRevision?: string;
  imageReferences?: string[];
  assetRightsDigest?: string | null;
  factSnapshotVersion?: string | null;
  approvedRevision?: string | null;
  approvedDigest?: string | null;
  publishState?: string | null;
  caseReference?: string | null;
  senderSource?: string | null;
  customerAcceptanceBinding?: string | null;
  bookingId?: string | null;
  bookingVersion?: string | null;
  amountProvenance?: AmountProvenance | null;
  canonical5ViewCheck?: string | null;
  activeStateAtRefresh?: string | null;
  crossTenantCheck?: string | null;
  datasetMode: "TEST" | "ACTUAL" | "SHOWCASE_DEMO" | "UNKNOWN";
  observedAt: string;
  source: string;
  error?: string | null;
  creationState?: ExplicitCreationState;
}

export interface ParityComparisonResult {
  status: "PASS" | "FAIL" | "NOT_VERIFIED";
  epochMatched: boolean;
  reason: string;
  diffs?: string[];
}

export interface CrossTenantObservation {
  requestingTenant: string;
  targetTenant: string;
  httpStatus: number;
  dataReturnedCount: number;
  leakedAssetReferences: string[];
}

export interface CrossTenantEvaluationResult {
  status: "PASS" | "FAIL" | "NOT_VERIFIED";
  reason: string;
}

// Strict ISO 8601 with explicit Date + 'T' + Time + Timezone (Z or offset)
const ISO_8601_TZ_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/i;

function isValidTimezoneTimestamp(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  if (!ISO_8601_TZ_REGEX.test(s.trim())) return false;
  return !isNaN(Date.parse(s));
}

// Supported currencies in this contract
const ALLOWED_CURRENCIES = new Set(["KRW"]);

// Observational status allowlist:
// PENDING_SETTLEMENT: Amount is observed on draft/proposal but settlement is pending.
// SETTLED: Amount is verified as settled in test fixture (not actual live payout).
// All other statuses (UNKNOWN, CUSTOM, ERROR, UNOBSERVED, MISSING) are rejected.
const ALLOWED_AMOUNT_STATUSES = new Set(["PENDING_SETTLEMENT", "SETTLED"]);

function isValidAmountProvenanceShape(p: unknown): p is AmountProvenance {
  if (!p || typeof p !== "object") return false;
  const rec = p as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length === 0) return false;

  return (
    typeof rec.amount === "number" &&
    Number.isFinite(rec.amount) &&
    rec.amount >= 0 &&
    typeof rec.currency === "string" &&
    rec.currency.trim().length > 0 &&
    typeof rec.status === "string" &&
    rec.status.trim().length > 0
  );
}

/**
 * Compares two observed states (e.g. from Mobile 375 and PC 1440) for parity.
 *
 * Rules:
 * 1. StepId is REQUIRED.
 * 2. Privacy invariant: Never echoes raw error messages, secrets, hashes, or payload JSON in diffs or reason.
 * 3. Both states must have matching, valid canonicalEpochs.
 * 4. Two states in ERROR forbidden from parity PASS.
 * 5. Two states with empty/null required fields forbidden from parity PASS.
 * 6. imageReferences must match in exact sequence (sorting forbidden).
 * 7. Non-TEST datasets or invalid observation timestamps (missing full T+TZ) fail immediately.
 * 8. Non-blank workspaceAlias and non-blank source required.
 * 9. Explicit creationState: NOT_CREATED is honored; unconfirmed undefined workrefs are rejected.
 * 10. amountProvenance enforces currency and status allowlists.
 */
export function compareObservedStates(
  stateA: ObservedState,
  stateB: ObservedState,
  stepId?: StepId
): ParityComparisonResult {
  if (!stepId) {
    return {
      status: "NOT_VERIFIED",
      epochMatched: false,
      reason: "STEP_ID_REQUIRED",
    };
  }

  if (!stateA || !stateB) {
    return {
      status: "NOT_VERIFIED",
      epochMatched: false,
      reason: "STATE_PAYLOAD_MISSING",
    };
  }

  // Error condition: Both in error must NOT PASS parity
  // Privacy: Never echo raw error strings
  if (stateA.error && stateB.error) {
    return {
      status: "FAIL",
      epochMatched: false,
      reason: "PARITY_BOTH_ERROR_FORBIDDEN",
      diffs: ["STATUS_ERROR_ON_BOTH"],
    };
  }
  if (stateA.error || stateB.error) {
    return {
      status: "FAIL",
      epochMatched: false,
      reason: "ONE_STATE_IN_ERROR",
      diffs: ["STATUS_ERROR_ON_ONE"],
    };
  }

  // Dataset mode check: Fail-closed if either state is not TEST
  if (stateA.datasetMode !== "TEST" || stateB.datasetMode !== "TEST") {
    return {
      status: "FAIL",
      epochMatched: false,
      reason: "DATASET_MODE_NOT_TEST",
    };
  }

  // Source validity check (non-blank)
  if (!stateA.source || stateA.source.trim() === "" || !stateB.source || stateB.source.trim() === "") {
    return {
      status: "FAIL",
      epochMatched: false,
      reason: "INVALID_SOURCE",
    };
  }

  // WorkspaceAlias validity check (non-blank)
  if (!stateA.workspaceAlias || stateA.workspaceAlias.trim() === "" || !stateB.workspaceAlias || stateB.workspaceAlias.trim() === "") {
    return {
      status: "FAIL",
      epochMatched: false,
      reason: "INVALID_WORKSPACE_ALIAS",
    };
  }

  // Timestamp validity check (must include explicit T and timezone)
  if (!isValidTimezoneTimestamp(stateA.observedAt) || !isValidTimezoneTimestamp(stateB.observedAt)) {
    return {
      status: "FAIL",
      epochMatched: false,
      reason: "INVALID_OBSERVED_AT_TIMESTAMP",
    };
  }

  // Canonical Epoch check: Parity requires stable, matching canonical epoch
  if (!stateA.canonicalEpoch || !stateB.canonicalEpoch) {
    return {
      status: "NOT_VERIFIED",
      epochMatched: false,
      reason: "CANONICAL_EPOCH_MISSING",
    };
  }

  if (stateA.canonicalEpoch !== stateB.canonicalEpoch) {
    return {
      status: "NOT_VERIFIED",
      epochMatched: false,
      reason: "CANONICAL_EPOCH_MISMATCH",
      diffs: ["DIFF_FIELD: canonicalEpoch"],
    };
  }

  // Find step configuration from manifest
  const stepConfig = MANIFEST_STEPS.find((s) => s.stepId === stepId);
  if (!stepConfig) {
    return {
      status: "NOT_VERIFIED",
      epochMatched: true,
      reason: "UNKNOWN_STEP_ID",
    };
  }

  const requiredFields = stepConfig.requiredStepFields;
  const diffs: string[] = [];

  for (const field of requiredFields) {
    const valA = (stateA as unknown as Record<string, unknown>)[field];
    const valB = (stateB as unknown as Record<string, unknown>)[field];

    // Work item creationState check
    if (field === "canonicalWorkRef") {
      if (valA === undefined && valB === undefined) {
        if (stateA.creationState === "NOT_CREATED" && stateB.creationState === "NOT_CREATED") {
          // Legitimate uncreated state verified explicitly
          continue;
        }
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "UNCONFIRMED_CREATION_STATE",
          diffs: ["DIFF_FIELD_UNCONFIRMED: canonicalWorkRef"],
        };
      }
    }

    // Null on both sides is forbidden from PASS
    if (valA === null && valB === null) {
      return {
        status: "FAIL",
        epochMatched: true,
        reason: "PARITY_EMPTY_OR_NULL_FORBIDDEN",
        diffs: [`DIFF_FIELD_NULL: ${field}`],
      };
    }

    // Undefined indicates unobserved field
    if (valA === undefined || valB === undefined) {
      return {
        status: "NOT_VERIFIED",
        epochMatched: true,
        reason: "REQUIRED_FIELD_MISSING",
        diffs: [`DIFF_FIELD_UNOBSERVED: ${field}`],
      };
    }

    // Empty string check
    if (valA === "" || valB === "") {
      return {
        status: "FAIL",
        epochMatched: true,
        reason: "INVALID_EMPTY_VALUE",
        diffs: [`DIFF_FIELD_EMPTY: ${field}`],
      };
    }

    // Specific comparison for imageReferences (exact sequence preservation, type verification)
    if (field === "imageReferences") {
      if (!Array.isArray(valA) || !Array.isArray(valB)) {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "INVALID_IMAGE_REFERENCES_TYPE",
          diffs: ["DIFF_FIELD_TYPE: imageReferences"],
        };
      }

      if (valA.length === 0 || valB.length === 0) {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "INVALID_EMPTY_VALUE",
          diffs: ["DIFF_FIELD_EMPTY: imageReferences"],
        };
      }

      const hasInvalidElements =
        valA.some((x) => typeof x !== "string" || x.trim() === "") ||
        valB.some((x) => typeof x !== "string" || x.trim() === "");

      if (hasInvalidElements) {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "INVALID_IMAGE_REFERENCES_TYPE",
          diffs: ["DIFF_FIELD_ELEMENTS: imageReferences"],
        };
      }

      const arrA = valA as string[];
      const arrB = valB as string[];
      if (arrA.length !== arrB.length || arrA.some((item, idx) => item !== arrB[idx])) {
        diffs.push("DIFF_FIELD: imageReferences");
      }
      continue;
    }

    // Specific comparison for amountProvenance (shape, currency allowlist, status allowlist)
    if (field === "amountProvenance") {
      if (!isValidAmountProvenanceShape(valA) || !isValidAmountProvenanceShape(valB)) {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "INVALID_AMOUNT_PROVENANCE_SHAPE",
          diffs: ["DIFF_FIELD_SHAPE: amountProvenance"],
        };
      }

      const provA = valA as AmountProvenance;
      const provB = valB as AmountProvenance;

      if (!ALLOWED_CURRENCIES.has(provA.currency) || !ALLOWED_CURRENCIES.has(provB.currency)) {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "UNSUPPORTED_CURRENCY",
          diffs: ["DIFF_FIELD_CURRENCY: amountProvenance"],
        };
      }

      if (provA.status === "ERROR" || provB.status === "ERROR") {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "AMOUNT_PROVENANCE_STATUS_ERROR",
          diffs: ["DIFF_FIELD_STATUS: amountProvenance"],
        };
      }

      if (!ALLOWED_AMOUNT_STATUSES.has(provA.status) || !ALLOWED_AMOUNT_STATUSES.has(provB.status)) {
        return {
          status: "FAIL",
          epochMatched: true,
          reason: "AMOUNT_PROVENANCE_STATUS_INVALID",
          diffs: ["DIFF_FIELD_STATUS: amountProvenance"],
        };
      }

      if (
        provA.amount !== provB.amount ||
        provA.currency !== provB.currency ||
        provA.status !== provB.status
      ) {
        diffs.push("DIFF_FIELD: amountProvenance");
      }
      continue;
    }

    // Strict primitive equality
    if (valA !== valB) {
      diffs.push(`DIFF_FIELD: ${field}`);
    }
  }

  // Also verify workspaceAlias and canonicalWorkRef parity across all steps
  if (stateA.workspaceAlias !== stateB.workspaceAlias) {
    diffs.push("DIFF_FIELD: workspaceAlias");
  }
  if (stateA.canonicalWorkRef !== stateB.canonicalWorkRef) {
    diffs.push("DIFF_FIELD: canonicalWorkRef");
  }

  if (diffs.length > 0) {
    return {
      status: "FAIL",
      epochMatched: true,
      reason: "BUSINESS_FIELD_MISMATCH",
      diffs,
    };
  }

  return {
    status: "PASS",
    epochMatched: true,
    reason: "PARITY_VERIFIED",
  };
}

/**
 * Evaluates cross-tenant isolation enforcement.
 *
 * Requirements:
 * - Requesting tenant and target tenant must be distinct (A !== B). Same-tenant is NOT cross-tenant -> NOT_VERIFIED.
 * - Observation fields must be valid and non-negative; otherwise NOT_VERIFIED.
 * - Leaked data count > 0 or leaked asset refs > 0 -> FAIL.
 * - 403 or 404 HTTP status -> PASS.
 * - 200 (even with 0 returned items) or other codes -> FAIL (silent swallowing / failure to refuse).
 */
export function evaluateCrossTenantIsolation(
  obs: CrossTenantObservation
): CrossTenantEvaluationResult {
  if (!obs || typeof obs !== "object") {
    return {
      status: "NOT_VERIFIED",
      reason: "INSUFFICIENT_OBSERVATION",
    };
  }

  if (!obs.requestingTenant || !obs.targetTenant) {
    return {
      status: "NOT_VERIFIED",
      reason: "INSUFFICIENT_OBSERVATION",
    };
  }

  if (obs.requestingTenant === obs.targetTenant) {
    return {
      status: "NOT_VERIFIED",
      reason: "INVALID_CROSS_TENANT_PAIR: SAME_TENANT",
    };
  }

  if (
    typeof obs.dataReturnedCount !== "number" ||
    isNaN(obs.dataReturnedCount) ||
    obs.dataReturnedCount < 0 ||
    !Array.isArray(obs.leakedAssetReferences)
  ) {
    return {
      status: "NOT_VERIFIED",
      reason: "INSUFFICIENT_OBSERVATION",
    };
  }

  if (obs.leakedAssetReferences.length > 0 || obs.dataReturnedCount > 0) {
    return {
      status: "FAIL",
      reason: "CROSS_TENANT_DATA_LEAK",
    };
  }

  if (obs.httpStatus === 403 || obs.httpStatus === 404) {
    return {
      status: "PASS",
      reason: "ISOLATION_ENFORCED",
    };
  }

  return {
    status: "FAIL",
    reason: "ISOLATION_REFUSAL_MISSING",
  };
}
