/**
 * Sohee V0.8.9 Cloud Browser Agent Session Vault
 * 
 * Manages:
 * 1. Encrypted session cookies & state tokens for Naver Blog and Daangn.
 * 2. Concurrency-safe session lease & release mechanism.
 * 3. Health check & automatic re-authentication notifications.
 */

export interface BrowserSessionVaultItem {
  workspaceId: string;
  channelId: 'NAVER_BLOG' | 'DAANGN';
  accountIdentifier: string;
  encryptedCookieJar: string;
  sessionState: 'HEALTHY' | 'STALE' | 'EXPIRED' | 'REAUTH_REQUIRED';
  leaseHolderId?: string | null;
  leasedAt?: string | null;
  leaseExpiresAt?: string | null;
  lastUsedAt: string;
}

export interface BrowserExecutionReceipt {
  success: boolean;
  channelId: 'NAVER_BLOG' | 'DAANGN';
  publishedUrl?: string;
  screenshotEvidenceUrl?: string;
  domCaptureSnippet?: string;
  executionDurationMs: number;
  errorMessage?: string;
}

/**
 * 브라우저 세션 임대 획득 (Concurreny-safe lease)
 */
export function acquireSessionLease(
  session: BrowserSessionVaultItem,
  workerId: string,
  leaseDurationMs: number = 60000
): { acquired: boolean; updatedSession: BrowserSessionVaultItem } {
  const now = Date.now();
  const isCurrentlyLeased =
    session.leaseExpiresAt && new Date(session.leaseExpiresAt).getTime() > now;

  if (isCurrentlyLeased && session.leaseHolderId !== workerId) {
    return { acquired: false, updatedSession: session };
  }

  const updated: BrowserSessionVaultItem = {
    ...session,
    leaseHolderId: workerId,
    leasedAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + leaseDurationMs).toISOString(),
    lastUsedAt: new Date(now).toISOString()
  };

  return { acquired: true, updatedSession: updated };
}

/**
 * 브라우저 세션 임대 해제
 */
export function releaseSessionLease(
  session: BrowserSessionVaultItem,
  workerId: string
): BrowserSessionVaultItem {
  if (session.leaseHolderId === workerId) {
    return {
      ...session,
      leaseHolderId: null,
      leasedAt: null,
      leaseExpiresAt: null
    };
  }
  return session;
}
