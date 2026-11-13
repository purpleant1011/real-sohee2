import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import {
  SameTruthSnapshotService,
  type CanonicalWorkspaceSnapshot,
} from '@/lib/runtime-truth/same-truth-snapshot-service';
import { GET as getServiceRuntimeState } from '@/app/api/workspaces/[workspaceId]/agent/runtime-state/route';
import {
  GET as getAdminRuntimeSnapshot,
  POST as postAdminRuntimeSnapshot,
} from '@/app/api/admin/runtime/snapshot/route';

// Mock workspace authentication guard
vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: vi.fn().mockResolvedValue({
    ok: true,
    userId: 'usr_test_owner',
    role: 'owner',
    workspaceId: 'ws_same_truth_test',
  }),
}));

// Mock operator authentication guard
vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn().mockResolvedValue({
    operatorId: 'op_test_admin',
    email: 'admin@example.com',
    permissionScopes: [{ permission: 'agent.read', workspaceScope: 'all' }],
  }),
}));

// ANI-1753: SameTruthSnapshotService 가 createServerSupabaseClient() 를 동적 import 해 DB 를 읽는다.
// 대역이 없으면 실제 요청이 나가 5초 타임아웃으로 실패한다.
vi.mock('@/lib/supabase/server', async () =>
  (await import('./helpers/fake-supabase-server')).fakeServerSupabaseModule(),
);

describe('Task 4.2: Service / Admin Same Truth Contract & Snapshot Service (ANI-951, ANI-953)', () => {
  const workspaceId = 'ws_same_truth_test';

  beforeEach(() => {
    vi.clearAllMocks();
    AgentControlPlaneService.resetForTest(workspaceId);
    SameTruthSnapshotService.resetForTest(workspaceId);
  });

  describe('1. Canonical Same Truth Invariant: Service & Admin Identical Snapshots', () => {
    it('returns identical snapshotVersion, controlState, activeActionRunCount, and buildIdentity', async () => {
      // Setup workspace in RUNNING state
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        'RUNNING',
        'usr_test_owner',
        '사업장 정상 가동 시작'
      );

      // 1. Fetch from Service API Route
      const serviceReq = new NextRequest(
        `http://localhost:3000/api/workspaces/${workspaceId}/agent/runtime-state`
      );
      const serviceRes = await getServiceRuntimeState(serviceReq, {
        params: Promise.resolve({ workspaceId }),
      });

      expect(serviceRes.status).toBe(200);
      expect(serviceRes.headers.get('Cache-Control')).toContain('no-store');
      const serviceSnap: CanonicalWorkspaceSnapshot = await serviceRes.json();

      // 2. Fetch from Admin API Route
      const adminReq = new NextRequest(
        `http://localhost:3000/api/admin/runtime/snapshot?workspaceId=${workspaceId}`
      );
      const adminRes = await getAdminRuntimeSnapshot(adminReq);

      expect(adminRes.status).toBe(200);
      expect(adminRes.headers.get('Cache-Control')).toContain('no-store');
      const adminSnap: CanonicalWorkspaceSnapshot = await adminRes.json();

      // Invariants: Exact SSOT match
      expect(serviceSnap.workspaceId).toBe(workspaceId);
      expect(adminSnap.workspaceId).toBe(workspaceId);
      expect(serviceSnap.snapshotVersion).toBe(adminSnap.snapshotVersion);
      expect(serviceSnap.controlState).toBe(adminSnap.controlState);
      expect(serviceSnap.controlState).toBe('RUNNING');
      expect(serviceSnap.activeActionRunCount).toBe(adminSnap.activeActionRunCount);

      // Build Identity: Exactly 0.9.0 release version
      expect(serviceSnap.buildIdentity.version).toBe('0.9.0');
      expect(adminSnap.buildIdentity.version).toBe('0.9.0');
      expect(serviceSnap.buildIdentity.commitSha).toBe(adminSnap.buildIdentity.commitSha);
      expect(serviceSnap.buildIdentity.deployedAt).toBe(adminSnap.buildIdentity.deployedAt);

      // Compare Snapshots: diff = 0
      const comparison = SameTruthSnapshotService.compareSnapshots(serviceSnap, adminSnap);
      expect(comparison.sameTruthVerified).toBe(true);
      expect(comparison.diffCount).toBe(0);
      expect(comparison.diffs).toHaveLength(0);
    });
  });

  describe('2. PAUSED Invariant: Active Run Count Strictly 0 & Synchronized Across Surfaces', () => {
    it('guarantees activeActionRunCount is strictly 0 on both Service and Admin when PAUSED', async () => {
      // Simulate registering actions, but state is PAUSED
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        'PAUSED',
        'usr_test_owner',
        '사장님 긴급 점검 지시'
      );

      // Even if background runs exist, in PAUSED state active action run count must be 0
      SameTruthSnapshotService.setActionRunsForTest(workspaceId, [
        { id: 'run-1', status: 'EXECUTING', isReadOnly: false },
        { id: 'run-2', status: 'QUEUED', isReadOnly: false },
      ]);

      const serviceReq = new NextRequest(
        `http://localhost:3000/api/workspaces/${workspaceId}/agent/runtime-state`
      );
      const serviceRes = await getServiceRuntimeState(serviceReq, {
        params: Promise.resolve({ workspaceId }),
      });
      const serviceSnap: CanonicalWorkspaceSnapshot = await serviceRes.json();

      const adminReq = new NextRequest(
        `http://localhost:3000/api/admin/runtime/snapshot?workspaceId=${workspaceId}`
      );
      const adminRes = await getAdminRuntimeSnapshot(adminReq);
      const adminSnap: CanonicalWorkspaceSnapshot = await adminRes.json();

      expect(serviceSnap.controlState).toBe('PAUSED');
      expect(adminSnap.controlState).toBe('PAUSED');
      expect(serviceSnap.activeActionRunCount).toBe(0);
      expect(adminSnap.activeActionRunCount).toBe(0);

      const comparison = SameTruthSnapshotService.compareSnapshots(serviceSnap, adminSnap);
      expect(comparison.sameTruthVerified).toBe(true);
      expect(comparison.diffCount).toBe(0);
    });

    it('allows only read-only runs when explicitly PAUSED', async () => {
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        'PAUSED',
        'usr_test_owner',
        '점검 중'
      );

      // 1 read-only inspection run, 1 write mutating run
      SameTruthSnapshotService.setActionRunsForTest(workspaceId, [
        { id: 'run-read', status: 'EXECUTING', isReadOnly: true },
        { id: 'run-write', status: 'EXECUTING', isReadOnly: false },
      ]);

      const snap = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);
      expect(snap.controlState).toBe('PAUSED');
      // Mutating run is excluded; only read-only run counts
      expect(snap.activeActionRunCount).toBe(1);
    });
  });

  describe('3. Zero-Grounding / Anti-Hallucination Law: No Fake Statistics', () => {
    it('returns null or 0 for averageExecutionTime when activeActionRunCount is 0 without completed runs', async () => {
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        'RUNNING',
        'usr_test_owner',
        '클린 런타임'
      );

      SameTruthSnapshotService.setActionRunsForTest(workspaceId, []);

      const serviceReq = new NextRequest(
        `http://localhost:3000/api/workspaces/${workspaceId}/agent/runtime-state`
      );
      const serviceRes = await getServiceRuntimeState(serviceReq, {
        params: Promise.resolve({ workspaceId }),
      });
      const serviceSnap: CanonicalWorkspaceSnapshot = await serviceRes.json();

      const adminReq = new NextRequest(
        `http://localhost:3000/api/admin/runtime/snapshot?workspaceId=${workspaceId}`
      );
      const adminRes = await getAdminRuntimeSnapshot(adminReq);
      const adminSnap: CanonicalWorkspaceSnapshot = await adminRes.json();

      // Zero-Grounding Invariant: Never fabricate "1m 32s" (92s) or synthetic metrics
      expect(serviceSnap.averageExecutionTimeSeconds).toBeNull();
      expect(adminSnap.averageExecutionTimeSeconds).toBeNull();
      expect(serviceSnap.averageExecutionTimeSeconds).not.toBe(92);
      expect(adminSnap.averageExecutionTimeSeconds).not.toBe(92);

      const comparison = SameTruthSnapshotService.compareSnapshots(serviceSnap, adminSnap);
      expect(comparison.sameTruthVerified).toBe(true);
      expect(comparison.diffCount).toBe(0);
    });

    it('calculates genuine average execution time only when completed runs exist', async () => {
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        'RUNNING',
        'usr_test_owner',
        '실행 이력 보유'
      );

      SameTruthSnapshotService.setActionRunsForTest(workspaceId, [
        { id: 'run-1', status: 'COMPLETED', durationSeconds: 20 },
        { id: 'run-2', status: 'COMPLETED', durationSeconds: 40 },
        { id: 'run-3', status: 'EXECUTING', isReadOnly: false },
      ]);

      const snap = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);
      expect(snap.activeActionRunCount).toBe(1);
      // Genuine average: (20 + 40) / 2 = 30s
      expect(snap.averageExecutionTimeSeconds).toBe(30);
    });
  });

  describe('4. Diff = 0 Contract: Same Truth Verification', () => {
    it('returns sameTruthVerified = true ONLY when diff = 0', () => {
      const baseSnap: CanonicalWorkspaceSnapshot = {
        workspaceId,
        snapshotVersion: 3,
        controlState: 'RUNNING',
        activeActionRunCount: 1,
        averageExecutionTimeSeconds: 30,
        averageExecutionTimeMs: 30000,
        buildIdentity: {
          version: '0.9.0',
          commitSha: '44306db',
          deployedAt: '2026-09-07T00:00:00.000Z',
        },
        observedAt: '2026-09-07T04:15:00.000Z',
        isPaused: false,
        killSwitchActive: false,
      };

      const identicalSnap = { ...baseSnap };
      const res = SameTruthSnapshotService.compareSnapshots(baseSnap, identicalSnap);

      expect(res.diffCount).toBe(0);
      expect(res.diff).toBe(0);
      expect(res.sameTruthVerified).toBe(true);
      expect(res.diffs).toHaveLength(0);
    });

    it('detects snapshotVersion discrepancy and rejects sameTruthVerified', () => {
      const serviceSnap: CanonicalWorkspaceSnapshot = {
        workspaceId,
        snapshotVersion: 2,
        controlState: 'RUNNING',
        activeActionRunCount: 0,
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

      const splitBrainAdminSnap: CanonicalWorkspaceSnapshot = {
        ...serviceSnap,
        snapshotVersion: 3, // Version mismatch!
      };

      const res = SameTruthSnapshotService.compareSnapshots(serviceSnap, splitBrainAdminSnap);
      expect(res.diffCount).toBe(1);
      expect(res.sameTruthVerified).toBe(false);
      expect(res.diffs[0].field).toBe('snapshotVersion');
    });

    it('detects controlState and activeActionRunCount split-brain', () => {
      const serviceSnap: CanonicalWorkspaceSnapshot = {
        workspaceId,
        snapshotVersion: 5,
        controlState: 'PAUSED',
        activeActionRunCount: 0,
        averageExecutionTimeSeconds: null,
        averageExecutionTimeMs: null,
        buildIdentity: {
          version: '0.9.0',
          commitSha: '44306db',
          deployedAt: '2026-09-07T00:00:00.000Z',
        },
        observedAt: '2026-09-07T04:15:00.000Z',
        isPaused: true,
        killSwitchActive: false,
      };

      const divergentAdminSnap: CanonicalWorkspaceSnapshot = {
        ...serviceSnap,
        controlState: 'RUNNING', // Desynchronized!
        activeActionRunCount: 2, // Desynchronized!
      };

      const res = SameTruthSnapshotService.compareSnapshots(serviceSnap, divergentAdminSnap);
      expect(res.diffCount).toBe(2);
      expect(res.sameTruthVerified).toBe(false);
      const fields = res.diffs.map((d) => d.field);
      expect(fields).toContain('controlState');
      expect(fields).toContain('activeActionRunCount');
    });

    it('detects buildIdentity version divergence (e.g. 0.8.8 vs 0.9.0)', () => {
      const serviceSnap: CanonicalWorkspaceSnapshot = {
        workspaceId,
        snapshotVersion: 1,
        controlState: 'RUNNING',
        activeActionRunCount: 0,
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

      const staleAdminSnap: CanonicalWorkspaceSnapshot = {
        ...serviceSnap,
        buildIdentity: {
          version: '0.8.8' as any, // Stale version!
          commitSha: '44306db',
          deployedAt: '2026-09-07T00:00:00.000Z',
        },
      };

      const res = SameTruthSnapshotService.compareSnapshots(serviceSnap, staleAdminSnap);
      expect(res.diffCount).toBe(1);
      expect(res.sameTruthVerified).toBe(false);
      expect(res.diffs[0].field).toBe('buildIdentity.version');
    });
  });

  describe('5. KILL_SWITCHED Invariant', () => {
    it('reflects KILL_SWITCHED on both surfaces and zeroes activeActionRunCount', async () => {
      await AgentControlPlaneService.toggleKillSwitch(
        workspaceId,
        true,
        'security_team',
        '긴급 보안 점검'
      );

      SameTruthSnapshotService.setActionRunsForTest(workspaceId, [
        { id: 'run-1', status: 'EXECUTING', isReadOnly: false },
      ]);

      const serviceReq = new NextRequest(
        `http://localhost:3000/api/workspaces/${workspaceId}/agent/runtime-state`
      );
      const serviceRes = await getServiceRuntimeState(serviceReq, {
        params: Promise.resolve({ workspaceId }),
      });
      const serviceSnap: CanonicalWorkspaceSnapshot = await serviceRes.json();

      const adminReq = new NextRequest(
        `http://localhost:3000/api/admin/runtime/snapshot?workspaceId=${workspaceId}`
      );
      const adminRes = await getAdminRuntimeSnapshot(adminReq);
      const adminSnap: CanonicalWorkspaceSnapshot = await adminRes.json();

      expect(serviceSnap.controlState).toBe('KILL_SWITCHED');
      expect(adminSnap.controlState).toBe('KILL_SWITCHED');
      expect(serviceSnap.activeActionRunCount).toBe(0);
      expect(adminSnap.activeActionRunCount).toBe(0);
      expect(serviceSnap.killSwitchActive).toBe(true);
      expect(adminSnap.killSwitchActive).toBe(true);

      const comparison = SameTruthSnapshotService.compareSnapshots(serviceSnap, adminSnap);
      expect(comparison.sameTruthVerified).toBe(true);
      expect(comparison.diffCount).toBe(0);
    });
  });

  describe('6. Admin Comparison API Route (POST)', () => {
    it('compares provided serviceSnapshot with admin canonical snapshot via POST', async () => {
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        'RUNNING',
        'usr_test_owner',
        '정상 운영'
      );

      const canonical = await SameTruthSnapshotService.getCanonicalSnapshot(workspaceId);

      const postReq = new NextRequest(
        'http://localhost:3000/api/admin/runtime/snapshot',
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId,
            serviceSnapshot: canonical,
          }),
        }
      );

      const res = await postAdminRuntimeSnapshot(postReq);
      expect(res.status).toBe(200);
      const comparisonResult = await res.json();
      expect(comparisonResult.sameTruthVerified).toBe(true);
      expect(comparisonResult.diffCount).toBe(0);
    });
  });

  describe('7. Auth & Input Validation Guarding', () => {
    it('returns 401 on service route when workspace authorization fails', async () => {
      const { requireWorkspaceMembership } = await import('@/lib/auth/workspace-guard');
      vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      } as any);

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${workspaceId}/agent/runtime-state`
      );
      const res = await getServiceRuntimeState(req, {
        params: Promise.resolve({ workspaceId }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('AUTH_REQUIRED');
    });

    it('returns 400 on admin route when workspaceId query param is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/runtime/snapshot');
      const res = await getAdminRuntimeSnapshot(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('WORKSPACE_ID_REQUIRED');
    });
  });
});
