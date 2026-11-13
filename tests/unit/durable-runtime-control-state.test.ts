import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentControlPlaneService,
  RuntimeControlConflictError,
  type CanonicalRuntimeControlState,
} from '@/features/marketing-agent/engine/agent-control-state';
import { PersistenceError } from '@/lib/errors/persistence-error';

// Authoritative in-memory PostgreSQL table mock simulating Supabase
interface ControlStateRow {
  workspace_id: string;
  desired_mode: string;
  actual_mode: string;
  active_plan_id: string | null;
  active_action_run_count: number;
  blocker_code: string | null;
  pause_reason: string | null;
  transition_id: string;
  snapshot_version: number;
  version: number;
  kill_switch_active: boolean;
  last_heartbeat_at: string | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function createMockSupabaseClient(tableStore: Map<string, ControlStateRow>, simulateFailure = false) {
  return {
    from: vi.fn((tableName: string) => {
      if (tableName !== 'workspace_runtime_control_states') {
        throw new Error(`Unexpected table: ${tableName}`);
      }

      if (simulateFailure) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: new Error('Postgres connection failed') }),
              single: async () => ({ data: null, error: new Error('Postgres connection failed') }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: new Error('Postgres insert failed') }),
            }),
          }),
          upsert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: new Error('Postgres upsert failed') }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({ data: null, error: new Error('Postgres update failed') }),
              }),
            }),
          }),
        };
      }

      return {
        select: (columns = '*') => ({
          eq: (column: string, val: any) => ({
            maybeSingle: async () => {
              if (column === 'workspace_id') {
                if ((tableStore as any).__simulateFirstSelectEmpty && val === (tableStore as any).__raceTargetWorkspaceId) {
                  delete (tableStore as any).__simulateFirstSelectEmpty;
                  return { data: null, error: null };
                }
                const row = tableStore.get(val);
                return { data: row ? { ...row } : null, error: null };
              }
              return { data: null, error: null };
            },
            single: async () => {
              if (column === 'workspace_id') {
                const row = tableStore.get(val);
                if (!row) return { data: null, error: new Error('Row not found') };
                return { data: { ...row }, error: null };
              }
              return { data: null, error: new Error('Row not found') };
            },
          }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              const newRow: ControlStateRow = {
                ...row,
                created_at: row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              tableStore.set(row.workspace_id, newRow);
              return { data: { ...newRow }, error: null };
            },
          }),
        }),
        // 운영 코드는 최초 초기화/복구를 upsert(onConflict: workspace_id, ignoreDuplicates: true)로 수행한다.
        upsert: (row: any, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => ({
          select: () => ({
            single: async () => {
              const existing = tableStore.get(row.workspace_id);
              if (existing && options?.ignoreDuplicates) {
                // PostgREST: ON CONFLICT DO NOTHING returns 0 rows when conflicted
                return { data: null, error: new Error('JSON object requested, multiple (or no) rows returned') };
              }
              const newRow: ControlStateRow = {
                ...(existing || {}),
                ...row,
                created_at: existing?.created_at || row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              tableStore.set(row.workspace_id, newRow);
              return { data: { ...newRow }, error: null };
            },
            maybeSingle: async () => {
              const existing = tableStore.get(row.workspace_id);
              if (existing && options?.ignoreDuplicates) {
                return { data: null, error: null };
              }
              const newRow: ControlStateRow = {
                ...(existing || {}),
                ...row,
                created_at: existing?.created_at || row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              tableStore.set(row.workspace_id, newRow);
              return { data: { ...newRow }, error: null };
            },
          }),
        }),
        update: (updates: any) => ({
          eq: (col1: string, val1: any) => ({
            eq: (col2: string, val2: any) => ({
              select: async () => {
                // Support CAS: col1 is workspace_id, col2 is version (or vice versa)
                const workspaceId = col1 === 'workspace_id' ? val1 : val2;
                const expectedVersion = col1 === 'version' ? val1 : val2;

                const existing = tableStore.get(workspaceId);
                if (!existing) {
                  return { data: [], error: null };
                }

                if (existing.version !== expectedVersion) {
                  // CAS failed! No rows updated
                  return { data: [], error: null };
                }

                const updatedRow: ControlStateRow = {
                  ...existing,
                  ...updates,
                  version: updates.version ?? updates.snapshot_version ?? existing.version + 1,
                  snapshot_version: updates.snapshot_version ?? updates.version ?? existing.snapshot_version + 1,
                  updated_at: updates.updated_at || new Date().toISOString(),
                };
                tableStore.set(workspaceId, updatedRow);
                return { data: [{ ...updatedRow }], error: null };
              },
            }),
            select: async () => {
              // Non-CAS update by workspace_id
              if (col1 === 'workspace_id') {
                const existing = tableStore.get(val1);
                if (!existing) return { data: [], error: null };
                const updatedRow: ControlStateRow = {
                  ...existing,
                  ...updates,
                  version: updates.version ?? updates.snapshot_version ?? existing.version + 1,
                  snapshot_version: updates.snapshot_version ?? updates.version ?? existing.snapshot_version + 1,
                  updated_at: updates.updated_at || new Date().toISOString(),
                };
                tableStore.set(val1, updatedRow);
                return { data: [{ ...updatedRow }], error: null };
              }
              return { data: [], error: null };
            },
          }),
        }),
      };
    }),
  };
}

describe('Task 1.1: Runtime Control DB SSOT & CAS Guarantees (ANI-947)', () => {
  const WORKSPACE_ID = 'ws-ani-947-truth';
  let dbTable: Map<string, ControlStateRow>;

  beforeEach(() => {
    dbTable = new Map();
    const mockClient = createMockSupabaseClient(dbTable);
    AgentControlPlaneService.setDbClientForTest(mockClient as any);
    AgentControlPlaneService.resetForTest(WORKSPACE_ID);
  });

  it('1. persists canonical runtime control state to Supabase table on initialization and query', async () => {
    const state = await AgentControlPlaneService.getControlState(WORKSPACE_ID);

    expect(state.workspace_id).toBe(WORKSPACE_ID);
    expect(state.desired_mode).toBe('PAUSED');
    expect(state.actual_mode).toBe('PAUSED');
    expect(state.version).toBe(1);
    expect(state.snapshot_version).toBe(1);
    expect(state.active_plan_id).toBeNull();
    expect(state.active_action_run_count).toBe(0);
    expect(state.blocker_code).toBeNull();
    expect(state.pause_reason).toBeDefined();
    expect(state.transition_id).toMatch(/^init-/);
    expect(state.updated_at).toBeDefined();

    // Verify DB authoritative row exists
    const dbRow = dbTable.get(WORKSPACE_ID);
    expect(dbRow).toBeDefined();
    expect(dbRow?.desired_mode).toBe('PAUSED');
    expect(dbRow?.version).toBe(1);
  });

  it('2. supports optimistic concurrency (CAS): successfully updates desired mode when expectedVersion matches', async () => {
    // Initial fetch to establish version 1
    const initial = await AgentControlPlaneService.getControlState(WORKSPACE_ID);
    expect(initial.version).toBe(1);

    // Atomic CAS transition: 1 -> 2
    const updated = await AgentControlPlaneService.setDesiredMode(
      WORKSPACE_ID,
      'RUNNING',
      'owner@clinic.kr',
      '영업 시작 승인',
      1 // expectedVersion
    );

    expect(updated.desired_mode).toBe('RUNNING');
    expect(updated.actual_mode).toBe('RUNNING');
    expect(updated.version).toBe(2);
    expect(updated.snapshot_version).toBe(2);

    // Verify DB authoritative state is updated
    const dbRow = dbTable.get(WORKSPACE_ID);
    expect(dbRow?.desired_mode).toBe('RUNNING');
    expect(dbRow?.version).toBe(2);
  });

  it('3. supports optimistic concurrency (CAS): throws conflict error when expectedVersion is stale', async () => {
    await AgentControlPlaneService.getControlState(WORKSPACE_ID); // Version 1

    // Update to version 2
    await AgentControlPlaneService.setDesiredMode(
      WORKSPACE_ID,
      'RUNNING',
      'owner@clinic.kr',
      '영업 시작 승인',
      1
    );

    // Attempt concurrent update with stale expectedVersion 1 (current is 2)
    await expect(
      AgentControlPlaneService.setDesiredMode(
        WORKSPACE_ID,
        'PAUSED',
        'another-actor',
        '동시 요청 충돌 시도',
        1 // stale version!
      )
    ).rejects.toThrowError(RuntimeControlConflictError);

    // DB state must remain intact at version 2, RUNNING
    const dbRow = dbTable.get(WORKSPACE_ID);
    expect(dbRow?.desired_mode).toBe('RUNNING');
    expect(dbRow?.version).toBe(2);
  });

  it('4. cold-start preservation: clears in-memory transient cache and restores exact DB state', async () => {
    // 1. Establish state in DB
    await AgentControlPlaneService.setDesiredMode(
      WORKSPACE_ID,
      'RUNNING',
      'owner@clinic.kr',
      '정상 근무 시작',
      1
    );

    const dbRowBefore = dbTable.get(WORKSPACE_ID);
    expect(dbRowBefore?.desired_mode).toBe('RUNNING');
    expect(dbRowBefore?.version).toBe(2);

    // 2. Simulate serverless cold-start: wipe transient process memory completely
    AgentControlPlaneService.clearTransientCache();

    // 3. Next request re-queries authoritative DB
    const restored = await AgentControlPlaneService.getControlState(WORKSPACE_ID);

    expect(restored.workspace_id).toBe(WORKSPACE_ID);
    expect(restored.desired_mode).toBe('RUNNING');
    expect(restored.actual_mode).toBe('RUNNING');
    expect(restored.version).toBe(2);
    expect(restored.snapshot_version).toBe(2);
  });

  it('5. fail-closed: throws PersistenceError on DB failure instead of masking with silent in-memory fallback', async () => {
    // Set a failing DB client
    const failingClient = createMockSupabaseClient(dbTable, true);
    AgentControlPlaneService.setDbClientForTest(failingClient as any);
    AgentControlPlaneService.clearTransientCache();

    await expect(
      AgentControlPlaneService.getControlState('ws-unreachable')
    ).rejects.toThrowError(PersistenceError);
  });

  it('6. handles blocker codes and kill switch faithfully with DB persistence', async () => {
    // RUNNING with NO_CREDIT blocker
    const blocked = await AgentControlPlaneService.setDesiredMode(
      WORKSPACE_ID,
      'RUNNING',
      'owner@clinic.kr',
      '시작 요청',
      { blockerCode: 'NO_CREDIT', creditBalance: 0, expectedVersion: 1 }
    );

    expect(blocked.desired_mode).toBe('RUNNING');
    expect(blocked.actual_mode).toBe('BLOCKED');
    expect(blocked.blocker_code).toBe('NO_CREDIT');
    expect(blocked.version).toBe(2);

    const dbRow = dbTable.get(WORKSPACE_ID);
    expect(dbRow?.actual_mode).toBe('BLOCKED');
    expect(dbRow?.blocker_code).toBe('NO_CREDIT');
  });

  it('7. prevents version rollback when calling unconditional update across cold-starts', async () => {
    // 1. Advance DB state to version 5
    dbTable.set(WORKSPACE_ID, {
      workspace_id: WORKSPACE_ID,
      desired_mode: 'PAUSED',
      actual_mode: 'PAUSED',
      active_plan_id: null,
      active_action_run_count: 0,
      blocker_code: null,
      pause_reason: null,
      transition_id: 'tr-v5',
      snapshot_version: 5,
      version: 5,
      kill_switch_active: false,
      last_heartbeat_at: null,
      updated_by: 'system',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 2. Cold start: wipe in-memory cache completely
    AgentControlPlaneService.clearTransientCache();

    // 3. Unconditional toggleKillSwitch without local cache
    const updated = await AgentControlPlaneService.toggleKillSwitch(
      WORKSPACE_ID,
      true,
      'admin-operator',
      '비상 차단'
    );

    // Version must NOT rollback to 2; it must advance monotonically from authoritative DB version 5 -> 6
    expect(updated.version).toBe(6);
    expect(updated.snapshot_version).toBe(6);
    expect(dbTable.get(WORKSPACE_ID)?.version).toBe(6);
  });

  it('8. rolls back transient cache to previous state on DB mutation failure', async () => {
    // Establish initial state
    await AgentControlPlaneService.getControlState(WORKSPACE_ID);

    // Inject failing client
    const failingClient = createMockSupabaseClient(dbTable, true);
    AgentControlPlaneService.setDbClientForTest(failingClient as any);

    await expect(
      AgentControlPlaneService.setDesiredMode(WORKSPACE_ID, 'RUNNING', 'owner', '실패할 명령')
    ).rejects.toThrowError(PersistenceError);

    // Cache must remain rolled back at PAUSED
    const cachedState = AgentControlPlaneService.getControlState(WORKSPACE_ID);
    expect(cachedState.desired_mode).toBe('PAUSED');
  });
  it('9. getControlState 초기화 레이스 컨디션: DB에 이미 concurrent worker가 설정한 킬스위치(kill_switch_active=true)가 존재할 때 기본 상태(false)로 덮어쓰지 않고 DB의 킬스위치를 온전히 보존한다', async () => {
    // Given: 초기 select 시점에는 비어있었으나 upsert 직전에 concurrent worker가 킬스위치를 켠 상황
    AgentControlPlaneService.clearTransientCache();
    dbTable.set(WORKSPACE_ID, {
      workspace_id: WORKSPACE_ID,
      desired_mode: 'BLOCKED',
      actual_mode: 'BLOCKED',
      active_plan_id: null,
      active_action_run_count: 0,
      blocker_code: 'KILL_SWITCH_ACTIVE',
      pause_reason: null,
      transition_id: 'tr-v1',
      snapshot_version: 1,
      version: 1,
      kill_switch_active: true,
      last_heartbeat_at: null,
      updated_by: 'owner',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    // 첫 select 시점에는 미발견된 것처럼 시뮬레이션
    (dbTable as any).__simulateFirstSelectEmpty = true;
    (dbTable as any).__raceTargetWorkspaceId = WORKSPACE_ID;

    // When: getControlState 호출
    const state = await AgentControlPlaneService.getControlState(WORKSPACE_ID);

    // Then: DB에 있던 킬스위치 활성 상태가 기본값(false/PAUSED)으로 덮어씌워지지 않고 그대로 보존되어야 한다
    expect(state.killSwitchActive).toBe(true);
    expect(state.actual_mode).toBe('BLOCKED');
    expect(dbTable.get(WORKSPACE_ID)?.kill_switch_active).toBe(true);
  });
});
