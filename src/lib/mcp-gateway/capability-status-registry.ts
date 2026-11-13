/**
 * Capability Status Registry (ANI-973, ANI-974)
 * 
 * Tracks live operational status of capabilities per workspace:
 * - OPERATIONAL_READY: Tool is fully registered, configured, and ready to execute.
 * - NOT_IMPLEMENTED: Capability definition exists but no domain handler or MCP adapter is implemented.
 * - DISCONNECTED: Upstream provider credentials, OAuth tokens, or channel connections are missing or expired.
 * - BLOCKED: Tool execution is prohibited by safety policy, tenant restriction, or emergency killswitch.
 * - DEGRADED: Tool is experiencing elevated error rates, high latency, or schema drift.
 */

import { SOHEE_CAPABILITY_REGISTRY, resolveCapabilityId } from '@/lib/agent-os/mcp-capability-registry';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';

export type CapabilityOperationalStatus =
  | 'OPERATIONAL_READY'
  | 'NOT_IMPLEMENTED'
  | 'DISCONNECTED'
  | 'BLOCKED'
  | 'DEGRADED';

export interface CapabilityStatusEntry {
  status: CapabilityOperationalStatus;
  reason?: string;
  updatedAt: string;
}

// Built-in implemented capability IDs in ToolDispatcher domainMap
const IMPLEMENTED_DOMAIN_CAPABILITIES = new Set<string>([
  'content.generate',
  'content.rewrite',
  'image.generate',
  'mcp_generate_visual_image',
  'publish.create',
  'mcp_publish_live',
  'customer.search',
  'mcp_query_customers',
  'comment.reply',
  'dm.send',
  'reservation.list',
  'reservation.create',
  'mcp_manage_reservation',
  'review.list',
  'review.respond',
  'interaction.list',
  'comment.reply_draft',
  'dm.reply_draft',
  'ads.list',
  'ads.status',
  'campaign.create',
  'automation.list',
  'knowledge.search',
  'knowledge.propose',
  'autonomy.update',
  'mcp_control_autonomy',
  'emergency_killswitch',
  'mcp_emergency_killswitch',
  'performance.summary',
  'report.generate',
  'app.navigate',
  'mcp_navigate_console',
  'credit.status',
  'recovery.list',
  'recovery.open',
  'recovery.prepare',
  'recovery.get',
  'recovery.request_send_approval',
  'recovery.request_booking_approval',
]);

export class CapabilityStatusRegistry {
  // workspaceId -> capabilityId -> CapabilityStatusEntry
  private static overrides: Map<string, Map<string, CapabilityStatusEntry>> = new Map();

  /**
   * Set status override for testing or dynamic runtime monitoring
   */
  public static setOverride(
    workspaceId: string,
    capabilityId: string,
    status: CapabilityOperationalStatus,
    reason?: string
  ): void {
    const canonicalId = resolveCapabilityId(capabilityId);
    let wsMap = this.overrides.get(workspaceId);
    if (!wsMap) {
      wsMap = new Map();
      this.overrides.set(workspaceId, wsMap);
    }
    wsMap.set(canonicalId, {
      status,
      reason,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Clear status override
   */
  public static clearOverride(workspaceId: string, capabilityId: string): void {
    const canonicalId = resolveCapabilityId(capabilityId);
    const wsMap = this.overrides.get(workspaceId);
    if (wsMap) {
      wsMap.delete(canonicalId);
    }
  }

  /**
   * Reset overrides for testing
   */
  public static resetForTest(workspaceId?: string): void {
    if (workspaceId) {
      this.overrides.delete(workspaceId);
    } else {
      this.overrides.clear();
    }
  }

  /**
   * Resolve live operational status for a capability in a workspace
   */
  public static async getStatus(
    workspaceId: string,
    capabilityId: string
  ): Promise<{ status: CapabilityOperationalStatus; reason?: string }> {
    const canonicalId = resolveCapabilityId(capabilityId);

    // 1. Check workspace-specific overrides
    const wsMap = this.overrides.get(workspaceId);
    if (wsMap?.has(canonicalId)) {
      const entry = wsMap.get(canonicalId)!;
      return { status: entry.status, reason: entry.reason };
    }

    // 2. Check global override if any
    const globalMap = this.overrides.get('*');
    if (globalMap?.has(canonicalId)) {
      const entry = globalMap.get(canonicalId)!;
      return { status: entry.status, reason: entry.reason };
    }

    // 3. Check Kill Switch
    let controlState;
    try { controlState = await AgentControlPlaneService.getControlState(workspaceId); } catch {
      const definition = SOHEE_CAPABILITY_REGISTRY[canonicalId];
      const safeRead = definition && !definition.isWrite && definition.riskTier === 'LOW';
      if (!safeRead && !['emergency_killswitch', 'mcp_emergency_killswitch'].includes(canonicalId)) return { status: 'DEGRADED', reason: '서버 제어 상태를 확인하지 못했어요.' };
    }
    if (
      (controlState?.actual_mode === 'BLOCKED' ||
        controlState?.blocker_code === 'KILL_SWITCH_ACTIVE' ||
        controlState?.killSwitchActive) &&
      canonicalId !== 'emergency_killswitch' &&
      canonicalId !== 'mcp_emergency_killswitch' &&
      canonicalId !== 'recovery.list' &&
      canonicalId !== 'recovery.get'
    ) {
      return {
        status: 'BLOCKED',
        reason: '긴급 킬스위치가 활성화되어 있어 도구 실행이 차단되었습니다.',
      };
    }

    // 4. Check registry existence and domain implementation
    const isKnown =
      Boolean(SOHEE_CAPABILITY_REGISTRY[canonicalId]) ||
      canonicalId.startsWith('recovery.');
    const isImplemented = IMPLEMENTED_DOMAIN_CAPABILITIES.has(canonicalId);

    if (!isKnown || !isImplemented) {
      return {
        status: 'NOT_IMPLEMENTED',
        reason: `도구 [${capabilityId}]의 실제 도메인 실행기가 구현되지 않았습니다 (Fail-Closed).`,
      };
    }

    // Default: OPERATIONAL_READY
    return {
      status: 'OPERATIONAL_READY',
    };
  }
}
