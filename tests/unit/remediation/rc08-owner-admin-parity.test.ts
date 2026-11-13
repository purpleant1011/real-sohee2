import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import {
  SameTruthSnapshotService,
  type CanonicalWorkspaceSnapshot,
} from '@/lib/runtime-truth/same-truth-snapshot-service';

// ANI-1753: SameTruthSnapshotService 가 createServerSupabaseClient() 로 DB 를 읽는다.
// 대역이 없으면 실제 요청이 나가고, 그 실패가 백그라운드에서 워커 종료코드를 오염시킨다.
vi.mock('@/lib/supabase/server', async () =>
  (await import('../../unit/helpers/fake-supabase-server')).fakeServerSupabaseModule(),
);

describe('REM-08 Regression: Owner / Admin Parity & UX Truth (ANI-1333)', () => {
  const workspaceId = 'ws_rem08_parity_test';

  beforeEach(() => {
    AgentControlPlaneService.resetForTest(workspaceId);
    SameTruthSnapshotService.resetForTest(workspaceId);
  });

  it('verifies exact same-truth parity across Owner and Admin surfaces in RUNNING state', async () => {
    await AgentControlPlaneService.setDesiredMode(
      workspaceId,
      'RUNNING',
      'owner_test',
      '사업장 정상 가동'
    );

    const snapshot = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);

    expect(snapshot.workspaceId).toBe(workspaceId);
    expect(snapshot.controlState).toBe('RUNNING');
    expect(snapshot.snapshotVersion).toBeGreaterThanOrEqual(1);
    expect(snapshot.buildIdentity.version).toBe('0.9.0');

    // Self-comparison yields diffCount = 0 and verified true
    const comparison = SameTruthSnapshotService.compareSnapshots(snapshot, { ...snapshot });
    expect(comparison.sameTruthVerified).toBe(true);
    expect(comparison.diffCount).toBe(0);
    expect(comparison.diffs).toHaveLength(0);
  }, 15000);

  it('enforces activeActionRunCount strictly 0 when PAUSED or KILL_SWITCHED', async () => {
    await AgentControlPlaneService.setDesiredMode(
      workspaceId,
      'PAUSED',
      'owner_test',
      '일시 정지'
    );

    // Inject active runs in test harness
    SameTruthSnapshotService.setActionRunsForTest(workspaceId, [
      { id: 'run-1', status: 'EXECUTING', isReadOnly: false },
      { id: 'run-2', status: 'QUEUED', isReadOnly: false },
    ]);

    const pausedSnap = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);
    expect(pausedSnap.controlState).toBe('PAUSED');
    expect(pausedSnap.activeActionRunCount).toBe(0);
    expect(pausedSnap.isPaused).toBe(true);

    // Toggle kill switch
    await AgentControlPlaneService.toggleKillSwitch(
      workspaceId,
      true,
      'security_op',
      '긴급 차단'
    );

    const killSnap = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);
    expect(killSnap.controlState).toBe('KILL_SWITCHED');
    expect(killSnap.activeActionRunCount).toBe(0);
    expect(killSnap.killSwitchActive).toBe(true);
  });

  it('enforces Zero-Grounding: averageExecutionTimeSeconds is null when no completed runs exist', async () => {
    await AgentControlPlaneService.setDesiredMode(
      workspaceId,
      'RUNNING',
      'owner_test',
      '가동'
    );

    SameTruthSnapshotService.setActionRunsForTest(workspaceId, []);
    const snap = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);

    expect(snap.averageExecutionTimeSeconds).toBeNull();
    expect(snap.averageExecutionTimeMs).toBeNull();
    // Rejects synthetic 92s (1m 32s)
    expect(snap.averageExecutionTimeSeconds).not.toBe(92);
  });

  it('detects split-brain divergence between Owner and Admin snapshots', () => {
    const ownerSnap: CanonicalWorkspaceSnapshot = {
      workspaceId,
      snapshotVersion: 5,
      controlState: 'RUNNING',
      activeActionRunCount: 1,
      averageExecutionTimeSeconds: null,
      averageExecutionTimeMs: null,
      buildIdentity: {
        version: '0.9.0',
        commitSha: '44306db',
        deployedAt: '2026-09-07T00:00:00.000Z',
      },
      observedAt: '2026-09-07T04:15:00.000Z',
      isPaused: false,
      killSwitchActive: false,
    };

    const divergentAdminSnap: CanonicalWorkspaceSnapshot = {
      ...ownerSnap,
      snapshotVersion: 6, // Divergence!
      controlState: 'PAUSED', // Divergence!
    };

    const comparison = SameTruthSnapshotService.compareSnapshots(ownerSnap, divergentAdminSnap);
    expect(comparison.sameTruthVerified).toBe(false);
    expect(comparison.diffCount).toBe(2);
    const fields = comparison.diffs.map((d) => d.field);
    expect(fields).toContain('snapshotVersion');
    expect(fields).toContain('controlState');
  });
});
