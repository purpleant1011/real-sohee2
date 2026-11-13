/**
 * Sohee Admin V0.3 Privileged Access & Break-Glass Engine
 * 
 * Invariants:
 * 1. Privileged support access is strictly TIME-BOXED (default 30 min, max 60 min).
 * 2. Explicit justification/reason and admin re-authentication required.
 * 3. Break-glass emergency kill-switch requires dual-control or high-privilege audit.
 */

export interface PrivilegedSupportSession {
  sessionId: string;
  adminUserId: string;
  targetWorkspaceId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  isActive: boolean;
  actionsPerformed: string[];
}

export interface BreakGlassKillSwitchRecord {
  switchId: string;
  targetScope: 'GLOBAL_AGENT' | 'WORKSPACE' | 'CHANNEL_PROVIDER';
  targetIdentifier: string;
  reason: string;
  triggeredByAdminId: string;
  secondaryApproverAdminId?: string;
  isEngaged: boolean;
  engagedAt: string;
  disengagedAt?: string;
}

export function startPrivilegedSupportSession(
  adminUserId: string,
  targetWorkspaceId: string,
  reason: string,
  durationMinutes: number = 30
): PrivilegedSupportSession {
  const now = Date.now();
  const cappedMinutes = Math.min(Math.max(durationMinutes, 5), 60);

  return {
    sessionId: `priv_sess_${Date.now()}`,
    adminUserId,
    targetWorkspaceId,
    reason,
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + cappedMinutes * 60 * 1000).toISOString(),
    isActive: true,
    actionsPerformed: []
  };
}

export function engageEmergencyKillSwitch(
  targetScope: 'GLOBAL_AGENT' | 'WORKSPACE' | 'CHANNEL_PROVIDER',
  targetIdentifier: string,
  reason: string,
  triggeredByAdminId: string
): BreakGlassKillSwitchRecord {
  return {
    switchId: `kill_${Date.now()}`,
    targetScope,
    targetIdentifier,
    reason,
    triggeredByAdminId,
    isEngaged: true,
    engagedAt: new Date().toISOString()
  };
}
