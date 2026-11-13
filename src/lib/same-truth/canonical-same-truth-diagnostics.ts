import crypto from 'crypto';
import type {
  CanonicalDomainState,
  SameTruthSnapshot,
  SameTruthDiffReport,
  SameTruthDiscrepancy,
  SplitBrainIncident,
} from '@/types/same-truth-diagnostics';

export const CURRENT_SNAPSHOT_VERSION = 5; // Wave 0.9.5 SSOT Version

export class CanonicalSameTruthDiagnostics {
  private static incidents: Map<string, SplitBrainIncident> = new Map();

  /**
   * Helper: create snapshot for Service or Admin view
   */
  public static createSnapshot(params: {
    workspaceId: string;
    viewOrigin: 'SERVICE' | 'ADMIN';
    state: CanonicalDomainState;
    datasetMode?: 'PRODUCTION_LIVE' | 'READBACK_VERIFIED';
  }): SameTruthSnapshot {
    const { workspaceId, viewOrigin, state, datasetMode = 'PRODUCTION_LIVE' } = params;
    const snapshotId = `snap_${viewOrigin.toLowerCase()}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    return {
      snapshotId,
      workspaceId,
      viewOrigin,
      snapshotVersion: CURRENT_SNAPSHOT_VERSION,
      freshnessIso: new Date().toISOString(),
      datasetMode,
      state: {
        ...state,
        activeActionRunIds: [...state.activeActionRunIds].sort(),
        readyPluginIds: [...state.readyPluginIds].sort(),
        revenueEventIds: [...state.revenueEventIds].sort(),
        publishingQueueEventIds: [...state.publishingQueueEventIds].sort(),
      },
    };
  }

  /**
   * Automated Diagnostics: Compare Service vs Admin Snapshots (ANI-925)
   * Evaluates all 7 critical dimensions and issues an Incident on any mismatch.
   */
  public static compareSnapshots(
    serviceSnapshot: SameTruthSnapshot,
    adminSnapshot: SameTruthSnapshot
  ): SameTruthDiffReport {
    if (serviceSnapshot.workspaceId !== adminSnapshot.workspaceId) {
      throw new Error(
        `Cannot compare snapshots from different workspaces: ${serviceSnapshot.workspaceId} vs ${adminSnapshot.workspaceId}`
      );
    }

    const reportId = `diff_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const discrepancies: SameTruthDiscrepancy[] = [];
    const s = serviceSnapshot.state;
    const a = adminSnapshot.state;

    // 1. Runtime Mode
    if (s.runtimeMode !== a.runtimeMode) {
      discrepancies.push({
        dimension: 'RUNTIME_MODE',
        serviceValue: s.runtimeMode,
        adminValue: a.runtimeMode,
        severity: 'CRITICAL',
        explanation: `런타임 가동 모드 불일치: Service(${s.runtimeMode}) vs Admin(${a.runtimeMode})`,
      });
    }

    // 2. Active ActionRun Count & IDs
    const activeRunsMatch =
      s.activeActionRunCount === a.activeActionRunCount &&
      JSON.stringify(s.activeActionRunIds) === JSON.stringify(a.activeActionRunIds);
    if (!activeRunsMatch) {
      discrepancies.push({
        dimension: 'ACTIVE_RUNS',
        serviceValue: { count: s.activeActionRunCount, ids: s.activeActionRunIds },
        adminValue: { count: a.activeActionRunCount, ids: a.activeActionRunIds },
        severity: 'CRITICAL',
        explanation: `활성 ActionRun 불일치: Service(${s.activeActionRunCount}건) vs Admin(${a.activeActionRunCount}건)`,
      });
    }

    // 3. Credit Balance (Canonical ledger fold)
    if (s.creditBalance !== a.creditBalance) {
      discrepancies.push({
        dimension: 'CREDIT_BALANCE',
        serviceValue: s.creditBalance,
        adminValue: a.creditBalance,
        severity: 'CRITICAL',
        explanation: `소희 크레딧 잔액 불일치: Service(${s.creditBalance} SC) vs Admin(${a.creditBalance} SC)`,
      });
    }

    // 4. Ready Plugins Count & IDs
    const pluginsMatch =
      s.readyPluginsCount === a.readyPluginsCount &&
      JSON.stringify(s.readyPluginIds) === JSON.stringify(a.readyPluginIds);
    if (!pluginsMatch) {
      discrepancies.push({
        dimension: 'READY_PLUGINS',
        serviceValue: { count: s.readyPluginsCount, ids: s.readyPluginIds },
        adminValue: { count: a.readyPluginsCount, ids: a.readyPluginIds },
        severity: 'CRITICAL',
        explanation: `READY 플러그인 목록 불일치: Service(${s.readyPluginsCount}개) vs Admin(${a.readyPluginsCount}개)`,
      });
    }

    // 5. Ad Spend
    if (s.adCampaignSpendKrw !== a.adCampaignSpendKrw) {
      discrepancies.push({
        dimension: 'AD_SPEND',
        serviceValue: s.adCampaignSpendKrw,
        adminValue: a.adCampaignSpendKrw,
        severity: 'WARNING',
        explanation: `외부 광고비 집행액 불일치: Service(${s.adCampaignSpendKrw}원) vs Admin(${a.adCampaignSpendKrw}원)`,
      });
    }

    // 6. Revenue Event IDs
    const revenueMatch = JSON.stringify(s.revenueEventIds) === JSON.stringify(a.revenueEventIds);
    if (!revenueMatch) {
      discrepancies.push({
        dimension: 'REVENUE_EVENTS',
        serviceValue: s.revenueEventIds,
        adminValue: a.revenueEventIds,
        severity: 'CRITICAL',
        explanation: `매출 성과 이벤트 ID 불일치: Service(${s.revenueEventIds.length}건) vs Admin(${a.revenueEventIds.length}건)`,
      });
    }

    // 7. Content Queue Event IDs
    const queueMatch = JSON.stringify(s.publishingQueueEventIds) === JSON.stringify(a.publishingQueueEventIds);
    if (!queueMatch) {
      discrepancies.push({
        dimension: 'CONTENT_QUEUE',
        serviceValue: s.publishingQueueEventIds,
        adminValue: a.publishingQueueEventIds,
        severity: 'CRITICAL',
        explanation: `발행 대기 큐 이벤트 불일치: Service(${s.publishingQueueEventIds.length}건) vs Admin(${a.publishingQueueEventIds.length}건)`,
      });
    }

    const isIdentical = discrepancies.length === 0;
    let incidentId: string | undefined;

    if (!isIdentical) {
      // Invariant: Green badge prohibited; automatically register incident
      incidentId = `inc_split_brain_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const incident: SplitBrainIncident = {
        incidentId,
        workspaceId: serviceSnapshot.workspaceId,
        createdAt: new Date().toISOString(),
        severity: 'CRITICAL',
        discrepancyCount: discrepancies.length,
        discrepancies,
        status: 'OPEN',
      };
      this.incidents.set(incidentId, incident);
    }

    return {
      reportId,
      workspaceId: serviceSnapshot.workspaceId,
      evaluatedAt: new Date().toISOString(),
      snapshotVersion: CURRENT_SNAPSHOT_VERSION,
      isIdentical,
      discrepancyCount: discrepancies.length,
      discrepancies,
      systemHealth: isIdentical ? 'SYNCHRONIZED_GREEN' : 'SPLIT_BRAIN_INCIDENT',
      incidentId,
    };
  }

  /**
   * List open incidents for workspace
   */
  public static getOpenIncidents(workspaceId: string): SplitBrainIncident[] {
    return Array.from(this.incidents.values()).filter(
      (i) => i.workspaceId === workspaceId && i.status === 'OPEN'
    );
  }

  /**
   * Resolve an incident
   */
  public static resolveIncident(incidentId: string, note: string): SplitBrainIncident {
    const inc = this.incidents.get(incidentId);
    if (!inc) {
      throw new Error(`Incident not found: ${incidentId}`);
    }

    inc.status = 'RESOLVED';
    inc.resolvedAt = new Date().toISOString();
    inc.resolutionNote = note;
    return inc;
  }

  public static _reset(): void {
    this.incidents.clear();
  }
}
