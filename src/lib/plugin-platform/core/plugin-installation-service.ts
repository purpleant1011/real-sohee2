import type {
  AgentEnergyPlanTier,
} from '@/types/autonomous-outcome-os';
import type {
  SoheePluginManifest,
  WorkspaceInstalledPlugin,
  PluginInstallationState,
} from '@/types/plugin-platform';

const PLAN_RANK: Record<AgentEnergyPlanTier, number> = {
  FREE_TASTE: 0,
  TIER_150K_STARTER: 1,
  TIER_300K_GROWTH: 2,
  TIER_500K_PRO_SCALE: 3,
};

export class PluginInstallationService {
  private installations: Map<string, WorkspaceInstalledPlugin> = new Map();

  private makeKey(workspaceId: string, pluginId: string): string {
    return `${workspaceId}::${pluginId}`;
  }

  /**
   * Installs a plugin into a workspace with plan entitlement check (ANI-780)
   * Invariant: INSTALLED != CONNECTED != READY.
   */
  installPlugin(params: {
    workspaceId: string;
    manifest: SoheePluginManifest;
    currentPlanTier: AgentEnergyPlanTier;
  }): {
    success: boolean;
    installation?: WorkspaceInstalledPlugin;
    state: PluginInstallationState;
    reason?: string;
  } {
    const { workspaceId, manifest, currentPlanTier } = params;
    const key = this.makeKey(workspaceId, manifest.pluginId);

    // 1. Plan Entitlement Gate
    const userRank = PLAN_RANK[currentPlanTier] ?? 0;
    const requiredRank = PLAN_RANK[manifest.minPlanTier] ?? 0;

    if (userRank < requiredRank) {
      return {
        success: false,
        state: 'PLAN_LOCKED',
        reason: `플러그인 [${manifest.displayName}]은(는) ${manifest.minPlanTier} 요금제 이상에서 지원됩니다.`,
      };
    }

    // 2. Check if already installed
    const existing = this.installations.get(key);
    if (existing && existing.state !== 'UNINSTALLED') {
      return {
        success: true,
        installation: existing,
        state: existing.state,
      };
    }

    // 3. Determine initial state: If scopes needed -> AUTH_REQUIRED; else -> READY
    const initialState: PluginInstallationState =
      manifest.requiredScopes && manifest.requiredScopes.length > 0 ? 'AUTH_REQUIRED' : 'READY';

    const installation: WorkspaceInstalledPlugin = {
      installationId: `inst_${workspaceId}_${manifest.pluginId}`,
      workspaceId,
      pluginId: manifest.pluginId,
      manifestVersion: manifest.version,
      state: initialState,
      installedAt: new Date().toISOString(),
      healthStatus: 'HEALTHY',
      lastHealthCheckedAt: new Date().toISOString(),
      approvalMode: manifest.approvalDefault,
      isCircuitBreakerOpen: false,
    };

    this.installations.set(key, installation);

    return {
      success: true,
      installation,
      state: initialState,
    };
  }

  /**
   * Marks external account connected and advances lifecycle to READY (ANI-777)
   */
  markAccountConnected(
    workspaceId: string,
    pluginId: string,
    connectedAccountId: string
  ): WorkspaceInstalledPlugin {
    const key = this.makeKey(workspaceId, pluginId);
    const inst = this.installations.get(key);
    if (!inst) {
      throw new Error(`Plugin [${pluginId}] is not installed in workspace [${workspaceId}].`);
    }

    inst.connectedAccountId = connectedAccountId;
    inst.state = 'READY';
    inst.healthStatus = 'HEALTHY';
    inst.lastHealthCheckedAt = new Date().toISOString();
    return inst;
  }

  /**
   * Opens circuit breaker during provider incidents (ANI-778)
   */
  setCircuitBreaker(workspaceId: string, pluginId: string, isOpen: boolean): void {
    const key = this.makeKey(workspaceId, pluginId);
    const inst = this.installations.get(key);
    if (inst) {
      inst.isCircuitBreakerOpen = isOpen;
      if (isOpen) {
        inst.state = 'DEGRADED';
      } else if (inst.connectedAccountId || inst.state === 'DEGRADED') {
        inst.state = 'READY';
      }
    }
  }

  /**
   * Uninstalls a plugin from a workspace
   */
  uninstallPlugin(workspaceId: string, pluginId: string): boolean {
    const key = this.makeKey(workspaceId, pluginId);
    return this.installations.delete(key);
  }

  /**
   * Toggles plugin between DISABLED and READY/AUTH_REQUIRED
   */
  togglePluginEnabled(workspaceId: string, pluginId: string): WorkspaceInstalledPlugin | null {
    const key = this.makeKey(workspaceId, pluginId);
    const inst = this.installations.get(key);
    if (!inst) return null;

    if (inst.state === 'DISABLED') {
      inst.state = inst.connectedAccountId ? 'READY' : 'AUTH_REQUIRED';
    } else {
      inst.state = 'DISABLED';
    }
    return inst;
  }

  getInstalledPlugin(workspaceId: string, pluginId: string): WorkspaceInstalledPlugin | null {
    return this.installations.get(this.makeKey(workspaceId, pluginId)) || null;
  }

  listWorkspaceInstallations(workspaceId: string): WorkspaceInstalledPlugin[] {
    return Array.from(this.installations.values()).filter((inst) => inst.workspaceId === workspaceId);
  }
}

export const defaultPluginInstallationService = new PluginInstallationService();

