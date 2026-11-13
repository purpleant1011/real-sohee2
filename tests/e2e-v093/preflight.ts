/**
 * Preflight Safety Guards and Environment Verification Contracts (ANI-1635)
 */

export interface ValidationResult {
  valid: boolean;
  reason: string;
}

export interface EnvironmentProof {
  datasetMode: "TEST" | "ACTUAL" | "SHOWCASE_DEMO" | "UNKNOWN";
  serverIsolationProof: string;
  providerWritesBlocked: boolean;
  adapterBindingPresent: boolean;
}

export interface EnvironmentVerificationResult {
  allowed: boolean;
  reason: string;
}

/**
 * Interface definition for future trusted server attestor.
 * In this skeleton phase, this is an unbound interface; no implementation is assumed.
 */
export interface TrustedServerAttestor {
  verifyIsolation(proof: EnvironmentProof): Promise<{ verified: boolean; token: string }>;
}

/**
 * Validates that the target origin is an exact, credential-free loopback origin.
 * Strictly rejects external URLs, pseudo-hostnames, and embedded credentials.
 * Privacy invariant: Never echoes raw input or error message strings in the reason.
 */
export function validateLoopbackOrigin(rawUrl: string): ValidationResult {
  try {
    const parsed = new URL(rawUrl);

    // Reject embedded credentials
    if (parsed.username || parsed.password) {
      return { valid: false, reason: "CREDENTIALS_IN_URL_FORBIDDEN" };
    }

    // Protocol must be http
    if (parsed.protocol !== "http:") {
      return { valid: false, reason: "NON_HTTP_PROTOCOL_FORBIDDEN" };
    }

    const hostname = parsed.hostname;

    // Exact loopback hostnames only
    const isExactLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1";

    if (!isExactLoopback) {
      return { valid: false, reason: "NON_LOOPBACK_HOSTNAME_FORBIDDEN" };
    }

    return { valid: true, reason: "LOOPBACK_ORIGIN_VERIFIED" };
  } catch {
    // Return fixed constant code without leaking malformed URL or error message
    return { valid: false, reason: "INVALID_URL_SYNTAX" };
  }
}

/**
 * Validates environment isolation proof structure and attestation status.
 *
 * Rules:
 * - Reject ACTUAL, SHOWCASE_DEMO, and UNKNOWN datasets with fixed reason code.
 * - Structural validation verifies proof hash, blocked provider writes, and test adapter binding.
 * - Crucial Invariant: Even if structure is well-formed (arbitrary string or 64-hex),
 *   execution cannot be granted because the trusted server attestor is currently UNBOUND.
 *   Therefore allowed remains FALSE and reason is ENV_ATTESTATION_UNBOUND (fail-closed).
 */
export function validateTestEnvironmentProof(
  proof: EnvironmentProof
): EnvironmentVerificationResult {
  if (!proof || typeof proof !== "object") {
    return { allowed: false, reason: "PROOF_PAYLOAD_MISSING" };
  }

  // Reject non-TEST datasets immediately with fixed reason code
  if (proof.datasetMode !== "TEST") {
    return {
      allowed: false,
      reason: "DATASET_MODE_NOT_TEST",
    };
  }

  // Structural check: server isolation proof hash must be present and non-empty
  if (!proof.serverIsolationProof || typeof proof.serverIsolationProof !== "string" || proof.serverIsolationProof.trim() === "") {
    return {
      allowed: false,
      reason: "SERVER_ISOLATION_PROOF_MISSING",
    };
  }

  // External provider writes MUST be blocked
  if (proof.providerWritesBlocked !== true) {
    return {
      allowed: false,
      reason: "PROVIDER_WRITES_NOT_BLOCKED",
    };
  }

  // Test adapter binding must be confirmed
  if (proof.adapterBindingPresent !== true) {
    return {
      allowed: false,
      reason: "TEST_ADAPTER_BINDING_MISSING",
    };
  }

  // Attestor verification boundary:
  // Client-submitted hashes/booleans are not authoritative server attestations.
  // In the current skeleton stage, the attestor is unbound, so execution is NOT allowed.
  return {
    allowed: false,
    reason: "ENV_ATTESTATION_UNBOUND",
  };
}
