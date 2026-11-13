export type DataProvenance = 'measured' | 'calculated' | 'estimated' | 'demo';

export interface ValueWithProvenance<T> {
  value: T;
  provenance: DataProvenance;
  sourceDescription: string;
  measuredAt?: string;
  calculationInputs?: string[];
  confidence?: number;
}

export type ActionStatus = 
  | 'draft'
  | 'approval_pending'
  | 'approved'
  | 'queued'
  | 'executing'
  | 'verification_pending'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'blocked_by_policy'
  | 'needs_reauth';

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface ChannelHealth {
  channelKey: string;
  displayName: string;
  status: 'connected' | 'disconnected' | 'needs_reauth' | 'warning';
  lastSyncedAt: string;
  errorMessage?: string;
}
