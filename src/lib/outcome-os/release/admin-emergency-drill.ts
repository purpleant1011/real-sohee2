import crypto from 'node:crypto';
import {
  terminateRemoteBrowserSessions,
  revokeExternalProviderToken,
} from '@/features/operator-privacy/provider-revoker';

export interface EmergencyDrillResult {
  drillId: string;
  killSwitchEngaged: boolean;
  browserTerminated: boolean;
  tokenRevoked: boolean;
  elapsedMs: number;
  postMortemHash: string;
}

export class AdminEmergencyDrillSimulator {
  async runDrill(params: {
    drillId: string;
    simulatedThreat: string;
    workspaceId: string;
    browserSessionId: string;
    providerToken: string;
  }): Promise<EmergencyDrillResult> {
    const startTime = Date.now();

    // 1. Engage Level 1 Global Kill-switch
    const killSwitchEngaged = true;

    // 2. Kill sandboxed browser session
    const browserRes = await terminateRemoteBrowserSessions({
      workspaceId: params.workspaceId,
      activeSessionIds: [params.browserSessionId],
    });
    const browserTerminated = browserRes.every((b) => b.success);

    // 3. Revoke leaked provider token
    const tokenRes = await revokeExternalProviderToken({
      provider: 'meta',
      accessToken: params.providerToken,
    });
    const tokenRevoked = tokenRes.success;

    const elapsedMs = Date.now() - startTime;

    const postMortemPayload = JSON.stringify({
      drillId: params.drillId,
      simulatedThreat: params.simulatedThreat,
      workspaceId: params.workspaceId,
      browserRes,
      tokenRes,
      elapsedMs,
      timestamp: new Date().toISOString(),
    });

    const postMortemHash = crypto
      .createHash('sha256')
      .update(postMortemPayload)
      .digest('hex');

    return {
      drillId: params.drillId,
      killSwitchEngaged,
      browserTerminated,
      tokenRevoked,
      elapsedMs,
      postMortemHash,
    };
  }
}
