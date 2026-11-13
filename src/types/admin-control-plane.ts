/**
 * Sohee V0.9 5th Update · Wave 4 Admin
 * Customer360 · Incident Center · Outcome SLO Control Plane Types
 * 
 * Traceability: ANI-933
 */

import { DatasetMode } from './workbench-contract';

export type IncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3';
export type IncidentState = 'ACTIVE' | 'MITIGATING' | 'RESOLVED' | 'APPROVAL_REQUIRED';

export interface CanonicalIdChain {
  identityId: string;
  businessId: string;
  workspaceId: string;
  planId: string;
  channelIds: string[];
  firstVerifiedActionId?: string;
  firstBookingId?: string;
  firstRevenueEventId?: string;
  latestPaymentId?: string;
}

export interface Customer360ActivationTimelineEvent {
  step:
    | 'IDENTITY_CREATED'
    | 'BUSINESS_VERIFIED'
    | 'WORKSPACE_PROVISIONED'
    | 'PLAN_ACTIVATED'
    | 'CHANNEL_CONNECTED'
    | 'FIRST_VERIFIED_ACTION'
    | 'FIRST_BOOKING_CAPTURED'
    | 'FIRST_REVENUE_VERIFIED';
  timestamp: string;
  canonicalId: string;
  evidenceId?: string;
  verified: boolean;
}

export interface Customer360CanonicalRecord {
  workspaceId: string;
  companyName: string;
  representativeName: string;
  businessNumber: string;
  datasetMode: DatasetMode; // 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST'
  idChain: CanonicalIdChain;
  activationTimeline: Customer360ActivationTimelineEvent[];
  creditBalance: {
    total: number;
    purchased: number;
    promotional: number;
    reserved: number;
  };
  totalVerifiedRevenueKrw: number;
  openIncidentCount: number;
  riskScore: number;
}

export interface ProductionIncident {
  incidentId: string;
  severity: IncidentSeverity;
  state: IncidentState;
  title: string;
  summary: string;
  affectedWorkspaceIds: string[];
  affectedProviders: string[];
  customerImpactDescription: string;
  mitigationPlan: string;
  incidentOwner: string;
  startedAt: string;
  mitigatedAt?: string;
  resolvedAt?: string;
  correlationId: string;
  evidenceId?: string;
}

export interface OutcomeSloMetric {
  sloKey:
    | 'VERIFIED_WRITE'
    | 'READBACK_SUCCESS'
    | 'SCHEDULE_ON_TIME'
    | 'BOOKING_VERIFICATION'
    | 'RECONCILE_LATENCY'
    | 'CREDIT_SETTLEMENT'
    | 'MEASUREMENT_FRESHNESS';
  name: string;
  currentValue: number; // percentage (0~100) or latency (ms)
  targetThreshold: number;
  unit: '%' | 'ms' | 'sec';
  isHealthy: boolean;
  sourceMetric: string; // "source/freshness 없는 healthy/100% badge 0건" 강제
  freshnessSeconds: number;
  measuredAt: string;
}

export interface PrivilegedSupportActionRequest {
  supportCaseId: string;
  operatorSessionId: string;
  workspaceId: string;
  actionType: 'CREDIT_ADJUSTMENT' | 'REVOKE_CHANNEL' | 'MANUAL_UNBLOCK' | 'EMERGENCY_CAMPAIGN_STOP';
  reason: string;
  correlationId: string;
  actionRunId?: string;
  ledgerEntryId?: string;
}

export interface PrivilegedSupportAuditRecord {
  auditId: string;
  supportCaseId: string;
  operatorSessionId: string;
  workspaceId: string;
  actionType: string;
  reason: string;
  correlationId: string;
  actionRunId?: string;
  ledgerEntryId?: string;
  executedAt: string;
  evidenceDigest: string;
}

export interface AdminGlobalSearchResult {
  query: string;
  matchedEntity: 'WORKSPACE' | 'ACTION_RUN' | 'CORRELATION' | 'PROVIDER' | 'EVIDENCE' | 'PAYMENT' | 'SUPPORT_CASE';
  canonicalId: string;
  summary: string;
  workspaceId: string;
  deepLink: string;
}
