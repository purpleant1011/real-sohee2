/**
 * Same Truth Contract & Canonical Snapshot Service (ANI-951, ANI-953)
 *
 * Guarantees that Service (/app) and Admin (/admin) runtime views observe
 * the EXACT same truth (Single Source of Truth) without split-brain or hallucinated metrics.
 *
 * Invariants:
 * 1. Service and Admin return identical snapshotVersion, controlState, activeActionRunCount, and buildIdentity.
 * 2. When in PAUSED or KILL_SWITCHED state, active mutating action runs must be strictly 0 (only background read-only inspection runs permitted).
 * 3. Zero-Grounding / Anti-Hallucination: When active execution count is 0 without completed runs, averageExecutionTime must be null (no fake "1m 32s").
 * 4. diff = 0 is required for sameTruthVerified = true.
 */

import { SOHEE_BUILD_ID } from '@/lib/build-identity';
import {
  AgentControlPlaneService,
  type AgentControlState,
} from '@/features/marketing-agent/engine/agent-control-state';

export type AuthoritativeControlState = 'RUNNING' | 'PAUSED' | 'KILL_SWITCHED';

export interface BuildIdentity {
  version: string;
  commitSha: string;
  deployedAt: string;
}

export interface ActionRunRecord {
  id: string;
  status: string;
  isReadOnly?: boolean;
  is_read_only?: boolean;
  durationSeconds?: number;
  durationMs?: number;
  [key: string]: any;
}

export interface CanonicalWorkspaceSnapshot {
  workspaceId: string;
  snapshotVersion: number;
  controlState: AuthoritativeControlState;
  activeActionRunCount: number;
  averageExecutionTimeSeconds: number | null;
  averageExecutionTimeMs: number | null;
  buildIdentity: BuildIdentity;
  observedAt: string;
  isPaused: boolean;
  killSwitchActive: boolean;
  rawControlState?: {
    desiredMode: string;
    actualMode: string;
    pauseReason: string | null;
    blockerCode: string | null;
    transitionId: string;
    updatedAt: string;
  };
}

export interface SameTruthDiffItem {
  field: string;
  serviceValue: any;
  adminValue: any;
  explanation: string;
}

export interface SameTruthComparisonResult {
  sameTruthVerified: boolean;
  diffCount: number;
  diff: number; // ergonomic alias
  diffs: SameTruthDiffItem[];
  workspaceId: string;
  comparedAt: string;
}

// Canonical Deployment Identity SSOT
export const CANONICAL_BUILD_IDENTITY: BuildIdentity = {
  version: '0.9.0',
  commitSha: SOHEE_BUILD_ID || '44306db',
  deployedAt: process.env.SOHEE_DEPLOYED_AT || '2026-09-07T00:00:00.000Z',
};

const ACTIVE_ACTION_STATUSES = new Set([
  'EXECUTING',
  'RUNNING',
  'QUEUED',
  'PREFLIGHT',
  'RESERVED',
  'PROVIDER_ACCEPTED',
  'VERIFICATION_PENDING',
]);

export class SameTruthSnapshotService {
  private static testActionRuns = new Map<string, ActionRunRecord[]>();
  private static testDbClient: any = null;

  /**
   * Set custom action runs for test isolation
   */
  static setActionRunsForTest(workspaceId: string, runs: ActionRunRecord[]): void {
    this.testActionRuns.set(workspaceId, runs);
  }

  /**
   * Set custom DB client for test isolation
   */
  static setDbClientForTest(client: any): void {
    this.testDbClient = client;
  }

  /**
   * Reset internal test state
   */
  static resetForTest(workspaceId?: string): void {
    if (workspaceId) {
      this.testActionRuns.delete(workspaceId);
    } else {
      this.testActionRuns.clear();
      this.testDbClient = null;
    }
  }

  /**
   * Resolve authoritative control state (RUNNING | PAUSED | KILL_SWITCHED)
   */
  private static resolveAuthoritativeMode(
    state: AgentControlState
  ): AuthoritativeControlState {
    if (state.killSwitchActive) {
      return 'KILL_SWITCHED';
    }
    if (state.actual_mode === 'PAUSED' || state.desired_mode === 'PAUSED') {
      return 'PAUSED';
    }
    if (state.actual_mode === 'RUNNING') {
      return 'RUNNING';
    }
    return 'PAUSED';
  }

  /**
   * Computes authoritative active action run count and real average execution time.
   */
  private static async computeActionRunTelemetry(
    workspaceId: string,
    controlState: AuthoritativeControlState,
    controlStateRow: AgentControlState
  ): Promise<{
    activeActionRunCount: number;
    averageExecutionTimeSeconds: number | null;
    averageExecutionTimeMs: number | null;
  }> {
    let runs: ActionRunRecord[] | null = null;

    // 1. Check test store
    if (this.testActionRuns.has(workspaceId)) {
      runs = this.testActionRuns.get(workspaceId) || [];
    } else if (this.testDbClient) {
      try {
        const { data } = await this.testDbClient
          .from('agent_action_runs')
          .select('*')
          .eq('workspace_id', workspaceId);
        if (data) runs = data;
      } catch {
        // Fallback
      }
    } else {
      // Supabase server client
      try {
        const { createServerSupabaseClient } = await import('@/lib/supabase/server');
        const client = await createServerSupabaseClient();
        if (client) {
          const { data } = await (client as any)
            .from('agent_action_runs')
            .select('*')
            .eq('workspace_id', workspaceId);
          if (data) runs = data;
        }
      } catch {
        // DB not available
      }
    }

    // If runs table was retrieved
    if (runs !== null) {
      let activeCount = 0;
      let completedDurations: number[] = [];

      for (const run of runs) {
        const isRunActive = ACTIVE_ACTION_STATUSES.has(run.status);
        const isReadOnly = Boolean(run.isReadOnly ?? run.is_read_only);

        if (isRunActive) {
          if (controlState === 'PAUSED' || controlState === 'KILL_SWITCHED') {
            // PAUSED invariant: mutating runs are disallowed; only read-only background runs count
            if (isReadOnly) {
              activeCount++;
            }
          } else {
            activeCount++;
          }
        }

        if (run.status === 'COMPLETED' || run.status === 'VERIFIED') {
          if (typeof run.durationSeconds === 'number') {
            completedDurations.push(run.durationSeconds);
          } else if (typeof run.durationMs === 'number') {
            completedDurations.push(run.durationMs / 1000);
          } else if (run.created_at && run.updated_at) {
            const start = new Date(run.created_at).getTime();
            const end = new Date(run.updated_at).getTime();
            if (!isNaN(start) && !isNaN(end) && end >= start) {
              completedDurations.push((end - start) / 1000);
            }
          }
        }
      }

      let avgSeconds: number | null = null;
      let avgMs: number | null = null;

      if (completedDurations.length > 0) {
        const sum = completedDurations.reduce((acc, v) => acc + v, 0);
        avgSeconds = Math.round(sum / completedDurations.length);
        avgMs = avgSeconds * 1000;
      }

      return {
        activeActionRunCount: activeCount,
        averageExecutionTimeSeconds: avgSeconds,
        averageExecutionTimeMs: avgMs,
      };
    }

    // Fallback if action_runs table is not directly queried:
    // Derive from workspace_runtime_control_states.active_action_run_count
    let fallbackCount = Number(controlStateRow.active_action_run_count ?? 0);
    if (controlState === 'PAUSED' || controlState === 'KILL_SWITCHED') {
      fallbackCount = 0;
    }

    return {
      activeActionRunCount: fallbackCount,
      averageExecutionTimeSeconds: null, // Anti-Hallucination: Never invent fake metrics
      averageExecutionTimeMs: null,
    };
  }

  /**
   * Produces the canonical snapshot for a workspace shared by both Service and Admin surfaces.
   */
  static async getCanonicalSnapshot(
    workspaceId: string
  ): Promise<CanonicalWorkspaceSnapshot> {
    const rawControlState = await AgentControlPlaneService.getControlState(workspaceId);
    const controlState = this.resolveAuthoritativeMode(rawControlState);
    const snapshotVersion = Number(rawControlState.snapshot_version ?? rawControlState.version ?? 1);

    const telemetry = await this.computeActionRunTelemetry(
      workspaceId,
      controlState,
      rawControlState
    );

    const observedAt = new Date().toISOString();

    return {
      workspaceId,
      snapshotVersion,
      controlState,
      activeActionRunCount: telemetry.activeActionRunCount,
      averageExecutionTimeSeconds: telemetry.averageExecutionTimeSeconds,
      averageExecutionTimeMs: telemetry.averageExecutionTimeMs,
      buildIdentity: { ...CANONICAL_BUILD_IDENTITY },
      observedAt,
      isPaused: controlState === 'PAUSED',
      killSwitchActive: controlState === 'KILL_SWITCHED',
      rawControlState: {
        desiredMode: rawControlState.desired_mode,
        actualMode: rawControlState.actual_mode,
        pauseReason: rawControlState.pause_reason,
        blockerCode: rawControlState.blocker_code,
        transitionId: rawControlState.transition_id,
        updatedAt: rawControlState.updated_at,
      },
    };
  }

  /**
   * Strictly evaluates Same Truth between Service and Admin views.
   * Returns sameTruthVerified = true IF AND ONLY IF diff = 0.
   */
  static compareSnapshots(
    serviceSnapshot: CanonicalWorkspaceSnapshot,
    adminSnapshot: CanonicalWorkspaceSnapshot
  ): SameTruthComparisonResult {
    const diffs: SameTruthDiffItem[] = [];

    // 1. Workspace ID
    if (serviceSnapshot.workspaceId !== adminSnapshot.workspaceId) {
      diffs.push({
        field: 'workspaceId',
        serviceValue: serviceSnapshot.workspaceId,
        adminValue: adminSnapshot.workspaceId,
        explanation: `Workspace ID mismatch: ${serviceSnapshot.workspaceId} vs ${adminSnapshot.workspaceId}`,
      });
    }

    // 2. Snapshot Version
    if (serviceSnapshot.snapshotVersion !== adminSnapshot.snapshotVersion) {
      diffs.push({
        field: 'snapshotVersion',
        serviceValue: serviceSnapshot.snapshotVersion,
        adminValue: adminSnapshot.snapshotVersion,
        explanation: `Snapshot version split-brain: Service v${serviceSnapshot.snapshotVersion} vs Admin v${adminSnapshot.snapshotVersion}`,
      });
    }

    // 3. Control State
    if (serviceSnapshot.controlState !== adminSnapshot.controlState) {
      diffs.push({
        field: 'controlState',
        serviceValue: serviceSnapshot.controlState,
        adminValue: adminSnapshot.controlState,
        explanation: `Control state mismatch: Service is ${serviceSnapshot.controlState} while Admin is ${adminSnapshot.controlState}`,
      });
    }

    // 4. Active Action Run Count
    if (serviceSnapshot.activeActionRunCount !== adminSnapshot.activeActionRunCount) {
      diffs.push({
        field: 'activeActionRunCount',
        serviceValue: serviceSnapshot.activeActionRunCount,
        adminValue: adminSnapshot.activeActionRunCount,
        explanation: `Active run count mismatch: Service reports ${serviceSnapshot.activeActionRunCount} vs Admin reports ${adminSnapshot.activeActionRunCount}`,
      });
    }

    // 5. Build Identity Version
    if (serviceSnapshot.buildIdentity.version !== adminSnapshot.buildIdentity.version) {
      diffs.push({
        field: 'buildIdentity.version',
        serviceValue: serviceSnapshot.buildIdentity.version,
        adminValue: adminSnapshot.buildIdentity.version,
        explanation: `Build version mismatch: Service(${serviceSnapshot.buildIdentity.version}) vs Admin(${adminSnapshot.buildIdentity.version})`,
      });
    }

    // 6. Build Identity Commit SHA
    if (serviceSnapshot.buildIdentity.commitSha !== adminSnapshot.buildIdentity.commitSha) {
      diffs.push({
        field: 'buildIdentity.commitSha',
        serviceValue: serviceSnapshot.buildIdentity.commitSha,
        adminValue: adminSnapshot.buildIdentity.commitSha,
        explanation: `Build SHA mismatch: Service(${serviceSnapshot.buildIdentity.commitSha}) vs Admin(${adminSnapshot.buildIdentity.commitSha})`,
      });
    }

    // 7. Build Identity DeployedAt
    if (serviceSnapshot.buildIdentity.deployedAt !== adminSnapshot.buildIdentity.deployedAt) {
      diffs.push({
        field: 'buildIdentity.deployedAt',
        serviceValue: serviceSnapshot.buildIdentity.deployedAt,
        adminValue: adminSnapshot.buildIdentity.deployedAt,
        explanation: `DeployedAt mismatch: Service(${serviceSnapshot.buildIdentity.deployedAt}) vs Admin(${adminSnapshot.buildIdentity.deployedAt})`,
      });
    }

    // 8. Average Execution Time
    if (serviceSnapshot.averageExecutionTimeSeconds !== adminSnapshot.averageExecutionTimeSeconds) {
      diffs.push({
        field: 'averageExecutionTimeSeconds',
        serviceValue: serviceSnapshot.averageExecutionTimeSeconds,
        adminValue: adminSnapshot.averageExecutionTimeSeconds,
        explanation: `Average execution time mismatch: Service(${serviceSnapshot.averageExecutionTimeSeconds}) vs Admin(${adminSnapshot.averageExecutionTimeSeconds})`,
      });
    }

    const diffCount = diffs.length;

    return {
      sameTruthVerified: diffCount === 0,
      diffCount,
      diff: diffCount,
      diffs,
      workspaceId: serviceSnapshot.workspaceId,
      comparedAt: new Date().toISOString(),
    };
  }
}
