/**
 * Sohee V0.9 5th Update · Wave 3 System
 * Account & Trust Center Figma Parity Model (6 Core Domains)
 * 
 * 1. Account & Business
 * 2. Plan, Credits & Ad Spend
 * 3. Connections & Permissions
 * 4. Data & Privacy
 * 5. Security & Audit Trail
 * 6. Service Dependency Health
 * 
 * Traceability: ANI-931, Figma 63:1728 / 64:1631
 */

export type SystemTrustDomain = 
  | 'account'
  | 'plan_credits'
  | 'connections'
  | 'privacy'
  | 'security'
  | 'health';

export interface ChannelConnectionRecord {
  connectionId: string;
  workspaceId: string;
  channel: 'instagram' | 'naver' | 'daangn' | 'threads' | 'kakao';
  channelLabel: string;
  accountHandle: string;
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED';
  grantedScopes: string[];
  connectedAt: string;
  lastUsedAt: string | null;
}

export interface ServiceDependencyHealth {
  serviceId: string;
  serviceName: string;
  category: 'EDGE_WORKERS' | 'DATABASE' | 'AI_RUNTIME' | 'QUEUE_R2';
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latencyMs: number;
  source: string;
  freshness: string;
  lastError: string | null;
}

export interface SecurityAuditRecord {
  auditId: string;
  workspaceId: string;
  actionType: 'REVOKE_CHANNEL' | 'EXPORT_DATA' | 'UPDATE_POLICY' | 'CREDIT_PURCHASE';
  performer: string;
  details: string;
  ipAddress?: string;
  timestamp: string;
  readbackVerified: boolean;
}

export interface SystemTrustCenterState {
  workspaceId: string;
  account: {
    businessName: string;
    ownerName: string;
    businessNumber: string;
    location: string;
    contactEmail: string;
  };
  planCredits: {
    planTier: 'STANDARD' | 'PRO' | 'ENTERPRISE';
    creditBalance: number;
    externalAdSpendTotalKrw: number;
    monthlyCreditCapacity: number;
  };
  connections: ChannelConnectionRecord[];
  health: ServiceDependencyHealth[];
  audits: SecurityAuditRecord[];
}
