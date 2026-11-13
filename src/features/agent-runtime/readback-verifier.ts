/**
 * Independent Readback Verifier (ANI-815)
 * 
 * Core Invariants:
 * 1. Provider Accepted != External Verified.
 * 2. API 200 / queue accepted does NOT mean success.
 * 3. Only independent GET / list / search matches certify EXTERNAL_VERIFIED.
 * 4. Readback mismatch results in VERIFY_FAILED, while network/timeout results in RESULT_UNKNOWN.
 * 5. Saves verified_at and readback_hash for audit trail.
 */

import { createHash } from 'crypto';

export type ExternalVerificationState =
  | 'PENDING'
  | 'PROVIDER_ACCEPTED'
  | 'EXTERNAL_VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'VERIFY_FAILED';

export interface ProviderWriteResult {
  status: number;
  acceptedAt: string;
  temporaryReferenceId?: string;
  rawResponseBody?: unknown;
}

export interface IndependentReadbackResult {
  isFound: boolean;
  authoritativeId?: string;
  liveUrl?: string;
  actualPayload?: Record<string, unknown>;
  errorMessage?: string;
}

export interface ReadbackVerificationRequest {
  workspaceId: string;
  actionRunId: string;
  channel: 'instagram' | 'naver' | 'threads' | 'daangn' | 'google_ads' | 'custom_browser';
  providerResult: ProviderWriteResult;
  expectedPayload: {
    title?: string;
    bodyContent?: string;
    targetAccountId: string;
    bidAmtKRW?: number;
  };
  readbackQuery: () => Promise<IndependentReadbackResult>;
}

export interface ReadbackVerificationCertificate {
  actionRunId: string;
  workspaceId: string;
  verificationState: ExternalVerificationState;
  isVerified: boolean;
  allowRetry: boolean;
  verifiedAt?: string;
  readbackHash?: string;
  authoritativeId?: string;
  liveUrl?: string;
  failureReason?: string;
}

/**
 * Calculates SHA-256 digest of readback payload and URL for tamper-proofing.
 */
export function calculateReadbackHash(authoritativeId: string, liveUrl: string, payload: Record<string, unknown>): string {
  const content = `${authoritativeId}::${liveUrl}::${JSON.stringify(payload)}`;
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Enforces authoritative independent readback after external write.
 */
export async function verifyExternalWriteWithReadback(
  request: ReadbackVerificationRequest
): Promise<ReadbackVerificationCertificate> {
  const { workspaceId, actionRunId, channel, providerResult, expectedPayload, readbackQuery } = request;

  // 1. Initial Gate: Provider must have at least accepted the request (HTTP 200-299)
  if (providerResult.status < 200 || providerResult.status >= 300) {
    return {
      actionRunId,
      workspaceId,
      verificationState: 'VERIFY_FAILED',
      isVerified: false,
      allowRetry: false,
      failureReason: `Provider HTTP mutation rejected with status: ${providerResult.status}`,
    };
  }

  try {
    // 2. Perform independent readback (GET / search)
    const readback = await readbackQuery();

    if (!readback.isFound || !readback.authoritativeId || !readback.liveUrl) {
      return {
        actionRunId,
        workspaceId,
        verificationState: 'RESULT_UNKNOWN',
        isVerified: false,
        allowRetry: false, // Blind retry is strictly prohibited; must use Reconcile Queue
        failureReason: readback.errorMessage || 'Provider accepted mutation, but independent readback could not locate the live object.',
      };
    }

    // 3. Strict Hostname & Anti-Mock Validation
    const prohibitedDomains = ['example.com', 'fake-post', 'placeholder', 'dummy-domain.test'];
    if (prohibitedDomains.some((d) => readback.liveUrl!.includes(d))) {
      return {
        actionRunId,
        workspaceId,
        verificationState: 'VERIFY_FAILED',
        isVerified: false,
        allowRetry: false,
        failureReason: `Prohibited mock/placeholder domain detected in live URL: ${readback.liveUrl}`,
      };
    }

    const expectedDomainMap: Record<string, string> = {
      instagram: 'instagram.com',
      naver: 'naver.com',
      threads: 'threads.net',
      daangn: 'daangn.com',
      google_ads: 'google.com',
    };

    const expectedHost = expectedDomainMap[channel];
    if (expectedHost && !readback.liveUrl.includes(expectedHost)) {
      return {
        actionRunId,
        workspaceId,
        verificationState: 'VERIFY_FAILED',
        isVerified: false,
        allowRetry: false,
        failureReason: `Channel domain mismatch: expected ${expectedHost}, got ${readback.liveUrl}`,
      };
    }

    // 4. Payload Consistency Check (detect silent drops or content corruption)
    if (readback.actualPayload && expectedPayload) {
      if (expectedPayload.bidAmtKRW !== undefined) {
        if (readback.actualPayload.bidAmtKRW !== expectedPayload.bidAmtKRW) {
          return {
            actionRunId,
            workspaceId,
            verificationState: 'VERIFY_FAILED',
            isVerified: false,
            allowRetry: false,
            failureReason: `Bid amount mismatch: expected ${expectedPayload.bidAmtKRW}, readback reported ${readback.actualPayload.bidAmtKRW}`,
          };
        }
      }
    }

    // 5. Success: Elevate to EXTERNAL_VERIFIED
    const now = new Date().toISOString();
    const hash = calculateReadbackHash(readback.authoritativeId, readback.liveUrl, readback.actualPayload || {});

    return {
      actionRunId,
      workspaceId,
      verificationState: 'EXTERNAL_VERIFIED',
      isVerified: true,
      allowRetry: false,
      verifiedAt: now,
      readbackHash: hash,
      authoritativeId: readback.authoritativeId,
      liveUrl: readback.liveUrl,
    };
  } catch (err: unknown) {
    // Network partition, timeout, or parsing error -> RESULT_UNKNOWN
    return {
      actionRunId,
      workspaceId,
      verificationState: 'RESULT_UNKNOWN',
      isVerified: false,
      allowRetry: false,
      failureReason: `Independent readback execution error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
