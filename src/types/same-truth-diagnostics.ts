export interface CanonicalDomainState {
  runtimeMode: 'RUNNING' | 'PAUSED' | 'IDLE' | 'EMERGENCY_STOP';
  activeActionRunCount: number;
  activeActionRunIds: string[];
  creditBalance: number;
  readyPluginsCount: number;
  readyPluginIds: string[];
  adCampaignSpendKrw: number;
  revenueEventIds: string[];
  publishingQueueEventIds: string[];
}

export interface SameTruthSnapshot {
  snapshotId: string;
  workspaceId: string;
  viewOrigin: 'SERVICE' | 'ADMIN';
  snapshotVersion: number;
  freshnessIso: string;
  datasetMode: 'PRODUCTION_LIVE' | 'READBACK_VERIFIED';
  state: CanonicalDomainState;
}

export type DiscrepancyDimension =
  | 'RUNTIME_MODE'
  | 'ACTIVE_RUNS'
  | 'CREDIT_BALANCE'
  | 'READY_PLUGINS'
  | 'AD_SPEND'
  | 'REVENUE_EVENTS'
  | 'CONTENT_QUEUE';

export interface SameTruthDiscrepancy {
  dimension: DiscrepancyDimension;
  serviceValue: unknown;
  adminValue: unknown;
  severity: 'CRITICAL' | 'WARNING';
  explanation: string;
}

export interface SameTruthDiffReport {
  reportId: string;
  workspaceId: string;
  evaluatedAt: string;
  snapshotVersion: number;
  isIdentical: boolean;
  discrepancyCount: number;
  discrepancies: SameTruthDiscrepancy[];
  systemHealth: 'SYNCHRONIZED_GREEN' | 'SPLIT_BRAIN_INCIDENT';
  incidentId?: string;
}

export interface SplitBrainIncident {
  incidentId: string;
  workspaceId: string;
  createdAt: string;
  severity: 'CRITICAL';
  discrepancyCount: number;
  discrepancies: SameTruthDiscrepancy[];
  status: 'OPEN' | 'RESOLVED';
  resolvedAt?: string;
  resolutionNote?: string;
}
