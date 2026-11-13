import { describe, it, expect, beforeEach } from 'vitest';
import {
  CanonicalSameTruthDiagnostics,
  CURRENT_SNAPSHOT_VERSION,
} from '@/lib/same-truth/canonical-same-truth-diagnostics';
import type { CanonicalDomainState } from '@/types/same-truth-diagnostics';

describe('ANI-925: Same Truth Canonical Diagnostics & Snapshot Diff', () => {
  const workspaceId = 'ws_same_truth_test';

  beforeEach(() => {
    CanonicalSameTruthDiagnostics._reset();
  });

  const baseState: CanonicalDomainState = {
    runtimeMode: 'RUNNING',
    activeActionRunCount: 2,
    activeActionRunIds: ['run_001', 'run_002'],
    creditBalance: 150,
    readyPluginsCount: 5,
    readyPluginIds: ['plg_instagram_growth', 'plg_kakao_consult', 'plg_naver_blog_marketing', 'plg_meta_ads', 'plg_threads_growth'],
    adCampaignSpendKrw: 45000,
    revenueEventIds: ['rev_evt_01', 'rev_evt_02'],
    publishingQueueEventIds: ['queue_evt_101', 'queue_evt_102'],
  };

  describe('1. Normal Tenant Synchronization (Diff = 0 -> SYNCHRONIZED_GREEN)', () => {
    it('should confirm 100% identity when Service and Admin read from the same canonical resolver', () => {
      const serviceSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'SERVICE',
        state: { ...baseState },
      });

      const adminSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'ADMIN',
        state: { ...baseState },
      });

      expect(serviceSnap.snapshotVersion).toBe(CURRENT_SNAPSHOT_VERSION);
      expect(adminSnap.snapshotVersion).toBe(CURRENT_SNAPSHOT_VERSION);

      const diff = CanonicalSameTruthDiagnostics.compareSnapshots(serviceSnap, adminSnap);

      expect(diff.isIdentical).toBe(true);
      expect(diff.discrepancyCount).toBe(0);
      expect(diff.systemHealth).toBe('SYNCHRONIZED_GREEN');
      expect(diff.incidentId).toBeUndefined();

      // No open incidents
      expect(CanonicalSameTruthDiagnostics.getOpenIncidents(workspaceId).length).toBe(0);
    });
  });

  describe('2. Intentional Mismatch Injection & Split-Brain Incident Detection', () => {
    it('should detect credit and active-run discrepancies, deny green badge, and open incident', () => {
      const serviceSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'SERVICE',
        state: {
          ...baseState,
          creditBalance: 150, // Service reports 150
          activeActionRunCount: 2,
        },
      });

      // Split-brain injection on Admin side: credit 100, 1 active run
      const adminSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'ADMIN',
        state: {
          ...baseState,
          creditBalance: 100, // Discrepancy!
          activeActionRunCount: 1, // Discrepancy!
          activeActionRunIds: ['run_001'],
        },
      });

      const diff = CanonicalSameTruthDiagnostics.compareSnapshots(serviceSnap, adminSnap);

      expect(diff.isIdentical).toBe(false);
      expect(diff.systemHealth).toBe('SPLIT_BRAIN_INCIDENT');
      expect(diff.discrepancyCount).toBe(2);
      expect(diff.incidentId).toBeDefined();

      const dimensions = diff.discrepancies.map((d) => d.dimension);
      expect(dimensions).toContain('CREDIT_BALANCE');
      expect(dimensions).toContain('ACTIVE_RUNS');

      // Incident record persisted
      const openIncidents = CanonicalSameTruthDiagnostics.getOpenIncidents(workspaceId);
      expect(openIncidents.length).toBe(1);
      expect(openIncidents[0].incidentId).toBe(diff.incidentId);
      expect(openIncidents[0].severity).toBe('CRITICAL');
    });

    it('should detect plugin ready count and publishing queue mismatch', () => {
      const serviceSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'SERVICE',
        state: {
          ...baseState,
          readyPluginsCount: 5,
        },
      });

      const adminSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'ADMIN',
        state: {
          ...baseState,
          readyPluginsCount: 3, // Misses 2 plugins
          readyPluginIds: ['plg_instagram_growth', 'plg_kakao_consult', 'plg_naver_blog_marketing'],
          publishingQueueEventIds: ['queue_evt_101'], // Queue mismatch
        },
      });

      const diff = CanonicalSameTruthDiagnostics.compareSnapshots(serviceSnap, adminSnap);

      expect(diff.isIdentical).toBe(false);
      expect(diff.systemHealth).toBe('SPLIT_BRAIN_INCIDENT');

      const dimensions = diff.discrepancies.map((d) => d.dimension);
      expect(dimensions).toContain('READY_PLUGINS');
      expect(dimensions).toContain('CONTENT_QUEUE');
    });
  });

  describe('3. Incident Resolution Lifecycle', () => {
    it('should allow operators to resolve split-brain incidents with audit notes', () => {
      const serviceSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'SERVICE',
        state: { ...baseState, runtimeMode: 'RUNNING' },
      });
      const adminSnap = CanonicalSameTruthDiagnostics.createSnapshot({
        workspaceId,
        viewOrigin: 'ADMIN',
        state: { ...baseState, runtimeMode: 'PAUSED' },
      });

      const diff = CanonicalSameTruthDiagnostics.compareSnapshots(serviceSnap, adminSnap);
      const incidentId = diff.incidentId!;

      expect(CanonicalSameTruthDiagnostics.getOpenIncidents(workspaceId).length).toBe(1);

      // Operator resolves incident after manual reconciliation
      const resolved = CanonicalSameTruthDiagnostics.resolveIncident(
        incidentId,
        'Service 및 Admin 런타임 상태 캐시 갱신을 통해 동기화 완료'
      );

      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolutionNote).toContain('동기화 완료');
      expect(CanonicalSameTruthDiagnostics.getOpenIncidents(workspaceId).length).toBe(0);
    });
  });
});
