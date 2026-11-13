export interface ProviderHealthReport {
  healthy: boolean;
  driftDetected: boolean;
  remedyAction: 'NONE' | 'REFRESH_TOKEN_AND_RUN_MIGRATION' | 'RECONNECT_PROVIDER';
}

export class DriftProviderWatchdog {
  private targetSchemaVersion = '20260904_v09_final';

  async checkProviderHealth(params: {
    provider: string;
    tokenValid: boolean;
    schemaVersion: string;
  }): Promise<ProviderHealthReport> {
    const isDrift = params.schemaVersion !== this.targetSchemaVersion;
    const isTokenHealthy = params.tokenValid;

    if (!isTokenHealthy || isDrift) {
      return {
        healthy: false,
        driftDetected: isDrift,
        remedyAction: 'REFRESH_TOKEN_AND_RUN_MIGRATION',
      };
    }

    return {
      healthy: true,
      driftDetected: false,
      remedyAction: 'NONE',
    };
  }
}
