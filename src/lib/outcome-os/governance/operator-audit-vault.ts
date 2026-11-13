import crypto from 'node:crypto';
import {
  revokeExternalProviderToken,
  terminateRemoteBrowserSessions,
  type TokenRevocationResult,
  type BrowserSessionTerminationResult,
} from '@/features/operator-privacy/provider-revoker';

export interface OperatorSession {
  sessionId: string;
  operatorId: string;
  workspaceId: string;
  reason: string;
  activeBrowserSessionIds: string[];
  providerTokensToRevokeOnClose: Array<{
    provider: string;
    accessToken?: string | null;
  }>;
  isActive: boolean;
  openedAt: string;
  closedAt?: string;
}

export interface OperatorSessionClosure {
  sessionId: string;
  success: boolean;
  terminatedBrowserSessions: BrowserSessionTerminationResult[];
  revokedProviderTokens: TokenRevocationResult[];
  auditReceiptHash: string;
  closedAt: string;
}

export class OperatorAuditVault {
  private sessions = new Map<string, OperatorSession>();

  startOperatorSession(params: {
    operatorId: string;
    workspaceId: string;
    reason: string;
    activeBrowserSessionIds?: string[];
    providerTokensToRevokeOnClose?: Array<{
      provider: string;
      accessToken?: string | null;
    }>;
  }): OperatorSession {
    const sessionId = `op_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const session: OperatorSession = {
      sessionId,
      operatorId: params.operatorId,
      workspaceId: params.workspaceId,
      reason: params.reason,
      activeBrowserSessionIds: params.activeBrowserSessionIds || [],
      providerTokensToRevokeOnClose: params.providerTokensToRevokeOnClose || [],
      isActive: true,
      openedAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async terminateOperatorSession(sessionId: string): Promise<OperatorSessionClosure> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Operator session not found: ${sessionId}`);
    }

    session.isActive = false;
    session.closedAt = new Date().toISOString();

    // 1. Terminate remote browser sessions
    const browserResults = await terminateRemoteBrowserSessions({
      workspaceId: session.workspaceId,
      activeSessionIds: session.activeBrowserSessionIds,
    });

    // 2. Revoke external provider tokens
    const tokenResults: TokenRevocationResult[] = [];
    for (const tokenItem of session.providerTokensToRevokeOnClose) {
      const res = await revokeExternalProviderToken({
        provider: tokenItem.provider,
        accessToken: tokenItem.accessToken,
      });
      tokenResults.push(res);
    }

    // 3. Generate tamper-evident audit receipt hash
    const rawAuditPayload = JSON.stringify({
      sessionId,
      operatorId: session.operatorId,
      workspaceId: session.workspaceId,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      browserResults,
      tokenResults,
    });

    const auditReceiptHash = crypto
      .createHash('sha256')
      .update(rawAuditPayload)
      .digest('hex');

    return {
      sessionId,
      success: true,
      terminatedBrowserSessions: browserResults,
      revokedProviderTokens: tokenResults,
      auditReceiptHash,
      closedAt: session.closedAt,
    };
  }
}
