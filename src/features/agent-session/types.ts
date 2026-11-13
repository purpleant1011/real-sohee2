/**
 * Canonical Agent Session Types (ANI-918, ANI-939)
 * 
 * SSOT for durable agent sessions across routes, devices, reloads, and approval workflows.
 */

export type AgentSessionStatus = 'ACTIVE' | 'IDLE' | 'AWAITING_APPROVAL' | 'PAUSED' | 'CLOSED';

export type DeviceChannel = 'desktop' | 'mobile' | 'tablet';

export interface CanonicalSurfaceContext {
  route: string;
  routeName?: string;
  tab?: string;
  selectedItemId?: string;
  entityType?: 'post' | 'customer' | 'campaign' | 'rule' | 'ad' | 'setting' | string;
  filters?: Record<string, unknown>;
  timeRange?: string;
  viewMode?: string;
  metadata?: Record<string, unknown>;
}

export interface CanonicalAgentSession {
  id: string;
  workspaceId: string;
  sessionId: string;
  threadId: string;
  conversationId?: string;
  currentSurface: CanonicalSurfaceContext;
  correlationId: string;
  snapshotVersion: number;
  deviceChannel: DeviceChannel;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveSessionParams {
  workspaceId: string;
  sessionId?: string;
  threadId?: string;
  surface?: CanonicalSurfaceContext;
  deviceChannel?: DeviceChannel;
  correlationId?: string;
}

export interface SessionResolutionResult {
  session: CanonicalAgentSession;
  isNewSession: boolean;
  reconnected: boolean;
  mismatchDetected?: boolean;
}

export interface UpdateSurfaceParams {
  workspaceId: string;
  sessionId: string;
  surface: CanonicalSurfaceContext;
  expectedVersion?: number;
}
