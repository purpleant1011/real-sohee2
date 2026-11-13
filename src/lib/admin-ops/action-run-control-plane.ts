/**
 * Admin ActionRun Control Plane (ANI-868)
 * 
 * Core Invariants:
 * 1. Primary Operating Object: ActionRun is the primary root entity for runtime observability.
 * 2. Full Lineage: Every ActionRun connects customer, workspace, plugin, capability, provider, credits, evidence, and outcome.
 * 3. Strict NO DATA Taxonomy: Differentiates NORMAL_EMPTY vs NOT_CONNECTED vs COLLECTION_FAILED.
 * 4. 4-Tier Independent Interruption Controls:
 *    - GLOBAL_KILL_SWITCH
 *    - PLUGIN_KILL_SWITCH
 *    - PROVIDER_CIRCUIT_BREAKER
 *    - WORKSPACE_AUTONOMY_PAUSE
 * 5. Immediate Propagation: Admin state mutations propagate instantaneously to Service planners and routers.
 */

export type ActionRunState =
  | 'QUEUED'
  | 'PREFLIGHT_PASSED'
  | 'IN_FLIGHT'
  | 'ACCEPTED'
  | 'VERIFIED'
  | 'RECONCILE_PENDING'
  | 'FAILED'
  | 'CANCELLED';

export type NoDataReason = 'NORMAL_EMPTY' | 'NOT_CONNECTED' | 'COLLECTION_FAILED' | 'DATA_AVAILABLE';

export interface ActionRunControlRecord {
  runId: string;
  customerId: string;
  workspaceId: string;
  pluginId: string;
  pluginVersion: string;
  capabilityId: string;
  provider: string;
  status: ActionRunState;
  noDataTaxonomy: NoDataReason;
  credits: {
    reserved: number;
    settled: number;
  };
  evidenceId?: string;
  outcomeId?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface InterruptionControlState {
  globalKillSwitch: boolean;
  blockedPlugins: Set<string>;
  openCircuitBreakers: Set<string>; // provider keys e.g. "instagram", "naver"
  pausedWorkspaces: Set<string>;
}

export class ActionRunControlPlane {
  private runs: Map<string, ActionRunControlRecord> = new Map();
  private controlState: InterruptionControlState = {
    globalKillSwitch: false,
    blockedPlugins: new Set(),
    openCircuitBreakers: new Set(),
    pausedWorkspaces: new Set(),
  };

  recordRun(run: ActionRunControlRecord): void {
    this.runs.set(run.runId, run);
  }

  getRun(runId: string): ActionRunControlRecord | undefined {
    return this.runs.get(runId);
  }

  listRuns(filter?: { workspaceId?: string; status?: ActionRunState }): ActionRunControlRecord[] {
    let result = Array.from(this.runs.values());
    if (filter?.workspaceId) {
      result = result.filter((r) => r.workspaceId === filter.workspaceId);
    }
    if (filter?.status) {
      result = result.filter((r) => r.status === filter.status);
    }
    return result;
  }

  // --- 4-Tier Interruption Controls ---

  setGlobalKillSwitch(active: boolean): void {
    this.controlState.globalKillSwitch = active;
  }

  setPluginKillSwitch(pluginId: string, blocked: boolean): void {
    if (blocked) {
      this.controlState.blockedPlugins.add(pluginId);
    } else {
      this.controlState.blockedPlugins.delete(pluginId);
    }
  }

  setProviderCircuitBreaker(provider: string, isOpen: boolean): void {
    if (isOpen) {
      this.controlState.openCircuitBreakers.add(provider);
    } else {
      this.controlState.openCircuitBreakers.delete(provider);
    }
  }

  setWorkspaceAutonomyPause(workspaceId: string, isPaused: boolean): void {
    if (isPaused) {
      this.controlState.pausedWorkspaces.add(workspaceId);
    } else {
      this.controlState.pausedWorkspaces.delete(workspaceId);
    }
  }

  /**
   * Evaluates runtime execution admissibility against the 4 independent tiers.
   */
  canExecute(workspaceId: string, pluginId: string, provider: string): {
    admissible: boolean;
    blockedByTier?: 'GLOBAL_KILL_SWITCH' | 'PLUGIN_KILL_SWITCH' | 'PROVIDER_CIRCUIT_BREAKER' | 'WORKSPACE_AUTONOMY_PAUSE';
    reason?: string;
  } {
    if (this.controlState.globalKillSwitch) {
      return {
        admissible: false,
        blockedByTier: 'GLOBAL_KILL_SWITCH',
        reason: 'Global emergency kill switch is engaged.',
      };
    }

    if (this.controlState.blockedPlugins.has(pluginId)) {
      return {
        admissible: false,
        blockedByTier: 'PLUGIN_KILL_SWITCH',
        reason: `Plugin '${pluginId}' is killed by administrator.`,
      };
    }

    if (this.controlState.openCircuitBreakers.has(provider)) {
      return {
        admissible: false,
        blockedByTier: 'PROVIDER_CIRCUIT_BREAKER',
        reason: `Provider circuit breaker for '${provider}' is open due to external errors.`,
      };
    }

    if (this.controlState.pausedWorkspaces.has(workspaceId)) {
      return {
        admissible: false,
        blockedByTier: 'WORKSPACE_AUTONOMY_PAUSE',
        reason: `Workspace '${workspaceId}' autonomy is paused.`,
      };
    }

    return {
      admissible: true,
    };
  }
}
