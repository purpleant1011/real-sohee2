import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface ReadbackCheckerResult {
  isLive: boolean;
  permalink?: string;
  authoritativeId?: string;
  contentSnippet?: string;
}

export interface ExecutionReceipt {
  receiptId: string;
  workspaceId: string;
  actionType: string;
  channel: string;
  providerObjectId: string;
  externalUrl: string;
  contentFingerprint: string;
  verifiedAt: string;
  verificationMethod: 'GRAPH_API_GET' | 'NAVER_SEARCH_READBACK' | 'ASIDE_BROWSER_READBACK' | 'CANONICAL_CONNECTOR';
  status: 'VERIFIED_CANONICAL' | 'VERIFY_FAILED';
}

export interface VerificationRequest {
  workspaceId?: string;
  actionType?: string;
  channel?: string;
  contentBody?: string;
  providerResult: { status: number; temporaryPostId?: string };
  readbackChecker: () => Promise<ReadbackCheckerResult>;
}

export interface VerificationOutcome {
  isVerified: boolean;
  status: 'VERIFIED_CANONICAL' | 'RESULT_UNKNOWN_RECONCILE_REQUIRED' | 'PROVIDER_REJECTED' | 'VERIFY_FAILED';
  allowImmediateRetry: boolean;
  receipt?: ExecutionReceipt;
  errorReason?: string;
}

async function computeContentFingerprint(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * External Verification Engine (ANI-704)
 * Invariant: Provider Accepted != External Verified.
 * Only issues tamper-proof ExecutionReceipt after authoritative read-after-write readback.
 */
export async function verifyExternalActionReadback(
  request: VerificationRequest
): Promise<VerificationOutcome> {
  const workspaceId = request.workspaceId;
  if (!workspaceId) {
    return {
      isVerified: false,
      status: 'VERIFY_FAILED',
      allowImmediateRetry: false,
      errorReason: 'workspaceId is required for canonical verification.',
    };
  }

  const actionType = request.actionType || 'PUBLISH_CONTENT';
  const channel = request.channel || 'instagram';
  const contentBody = request.contentBody || '';
  const { providerResult, readbackChecker } = request;

  // 1. Check provider HTTP status
  if (providerResult.status < 200 || providerResult.status >= 300) {
    return {
      isVerified: false,
      status: 'PROVIDER_REJECTED',
      allowImmediateRetry: false,
      errorReason: `Provider HTTP Error: ${providerResult.status}`,
    };
  }

  try {
    // 2. Perform authoritative readback
    const readback = await readbackChecker();

    // Strict validation: must have valid permalink and authoritativeId
    if (readback.isLive && readback.permalink && readback.authoritativeId) {
      // Invariant: Reject obvious dummy/placeholder URLs in production
      if (
        readback.permalink.includes('example.com') ||
        readback.permalink.includes('fake-post') ||
        readback.permalink.includes('placeholder')
      ) {
        return {
          isVerified: false,
          status: 'VERIFY_FAILED',
          allowImmediateRetry: false,
          errorReason: 'Mock/Placeholder permalinks are prohibited in canonical verification.',
        };
      }

      // Invariant: Channel hostname check
      const expectedHost = channel === 'instagram' ? 'instagram.com' : channel === 'naver' ? 'naver.com' : 'threads.net';
      if (!readback.permalink.includes(expectedHost)) {
        return {
          isVerified: false,
          status: 'VERIFY_FAILED',
          allowImmediateRetry: false,
          errorReason: `Invalid channel permalink: expected ${expectedHost} in URL, got ${readback.permalink}`,
        };
      }

      const fingerprint = await computeContentFingerprint(contentBody);
      const receiptId = `rcpt_${Date.now()}_${fingerprint.slice(0, 6)}`;

      const receipt: ExecutionReceipt = {
        receiptId,
        workspaceId,
        actionType,
        channel,
        providerObjectId: readback.authoritativeId,
        externalUrl: readback.permalink,
        contentFingerprint: fingerprint,
        verifiedAt: new Date().toISOString(),
        verificationMethod: channel === 'naver' ? 'NAVER_SEARCH_READBACK' : 'GRAPH_API_GET',
        status: 'VERIFIED_CANONICAL',
      };

      // 3. Persist receipt into database (Fail-closed: persist failure MUST NOT return success)
      try {
        const supabase = await createServerSupabaseClient();
        const { error: insertError } = await (supabase as any).from('agent_execution_receipts').upsert({
          receipt_id: receipt.receiptId,
          workspace_id: receipt.workspaceId,
          action_type: receipt.actionType,
          channel: receipt.channel,
          provider_object_id: receipt.providerObjectId,
          external_url: receipt.externalUrl,
          content_fingerprint: receipt.contentFingerprint,
          verified_at: receipt.verifiedAt,
          verification_method: receipt.verificationMethod,
          status: receipt.status,
        }, { onConflict: 'receipt_id' });

        if (insertError) {
          return {
            isVerified: false,
            status: 'RESULT_UNKNOWN_RECONCILE_REQUIRED',
            allowImmediateRetry: false,
            errorReason: `Receipt persistence failed: ${insertError.message}. Verification cannot be certified.`,
          };
        }
      } catch (dbErr: any) {
        return {
          isVerified: false,
          status: 'RESULT_UNKNOWN_RECONCILE_REQUIRED',
          allowImmediateRetry: false,
          errorReason: `Database error during receipt persistence: ${dbErr?.message || String(dbErr)}. Verification cannot be certified.`,
        };
      }

      return {
        isVerified: true,
        status: 'VERIFIED_CANONICAL',
        allowImmediateRetry: false,
        receipt,
      };
    }

    // Readback failed or not yet visible: RESULT_UNKNOWN (requires reconcile, blind retry prohibited)
    return {
      isVerified: false,
      status: 'RESULT_UNKNOWN_RECONCILE_REQUIRED',
      allowImmediateRetry: false,
      errorReason: 'Provider accepted the action, but read-after-write external verification could not confirm live presence.',
    };
  } catch (err: unknown) {
    return {
      isVerified: false,
      status: 'RESULT_UNKNOWN_RECONCILE_REQUIRED',
      allowImmediateRetry: false,
      errorReason: `Readback inspection error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

