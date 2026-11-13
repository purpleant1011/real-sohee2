import { SOHEE_WORKER_VERSION } from '@/lib/build-identity';
import { AppError } from '@/lib/errors/app-error';
import { PersistenceError } from '@/lib/errors/persistence-error';

/**
 * 자율근무를 한 번도 켜지 않은 워크스페이스에 만들어지는 초기 안전 대기 사유.
 * 사용자가 내린 중지가 아니므로 실행 차단 판정에서 명시 중지와 구분한다.
 */
export const NEW_WORKSPACE_PAUSED_REASON = '신규 워크스페이스 안전 대기 (시작 대기)';

export type DesiredAgentMode = 'OFF' | 'RUNNING' | 'PAUSED';
export type ActualAgentMode = 'OFF' | 'ARMING' | 'RUNNING' | 'DEGRADED' | 'PAUSED' | 'BLOCKED';

export interface CanonicalRuntimeControlState {
  workspace_id: string;
  desired_mode: DesiredAgentMode;
  actual_mode: ActualAgentMode;
  active_plan_id: string | null;
  active_action_run_count: number;
  blocker_code: string | null;
  pause_reason: string | null;
  transition_id: string;
  snapshot_version: number;
  version: number; // CAS & DB SSOT concurrency version (ANI-947)
  updated_at: string;
}

export interface AgentControlState extends CanonicalRuntimeControlState {
  workspaceId: string;
  desiredMode: DesiredAgentMode;
  actualMode: ActualAgentMode;
  activePlanId?: string | null;
  statusReason: string;
  policyVersion: string;
  budgetVersion: string;
  pausedScopes: string[];
  lastHeartbeatAt: string;
  workerVersion: string;
  killSwitchActive: boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface SetDesiredModeOptions {
  blockerCode?: string | null;
  creditBalance?: number;
  expectedVersion?: number;
}

export class RuntimeControlConflictError extends AppError {
  constructor(message = 'Runtime control state version conflict (optimistic CAS failed)') {
    super('CONFLICT', message);
    this.name = 'RuntimeControlConflictError';
  }
}

// Transient process-memory read cache. Strictly NOT authoritative SSOT.
// Authoritative SSOT is Supabase PostgreSQL table: workspace_runtime_control_states
const transientCache = new Map<string, AgentControlState>();

let testDbClient: any = null;
const defaultTestTableStore = new Map<string, any>();

function createInMemoryTestDbClient(): any {
  return {
    from: (tableName: string) => {
      if (tableName !== 'workspace_runtime_control_states') {
        throw new Error(`Unexpected table in test DB: ${tableName}`);
      }
      return {
        select: () => ({
          eq: (col: string, val: any) => ({
            maybeSingle: async () => {
              const row = defaultTestTableStore.get(val);
              return { data: row ? { ...row } : null, error: null };
            },
            single: async () => {
              const row = defaultTestTableStore.get(val);
              if (!row) return { data: null, error: new Error('Row not found') };
              return { data: { ...row }, error: null };
            },
          }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              const newRow = {
                ...row,
                created_at: row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              defaultTestTableStore.set(row.workspace_id, newRow);
              return { data: { ...newRow }, error: null };
            },
          }),
        }),
        upsert: (row: any, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => ({
          select: () => ({
            single: async () => {
              const existing = defaultTestTableStore.get(row.workspace_id);
              if (existing && options?.ignoreDuplicates) {
                return { data: null, error: new Error('JSON object requested, multiple (or no) rows returned') };
              }
              const mergedRow = {
                ...(existing || {}),
                ...row,
                created_at: existing?.created_at || row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              defaultTestTableStore.set(row.workspace_id, mergedRow);
              return { data: { ...mergedRow }, error: null };
            },
            maybeSingle: async () => {
              const existing = defaultTestTableStore.get(row.workspace_id);
              if (existing && options?.ignoreDuplicates) {
                return { data: null, error: null };
              }
              const mergedRow = {
                ...(existing || {}),
                ...row,
                created_at: existing?.created_at || row.created_at || new Date().toISOString(),
                updated_at: row.updated_at || new Date().toISOString(),
              };
              defaultTestTableStore.set(row.workspace_id, mergedRow);
              return { data: { ...mergedRow }, error: null };
            },
          }),
        }),
        update: (updates: any) => ({
          eq: (col1: string, val1: any) => ({
            eq: (col2: string, val2: any) => ({
              select: async () => {
                const workspaceId = col1 === 'workspace_id' ? val1 : val2;
                const expectedVersion = col1 === 'version' ? val1 : val2;
                const existing = defaultTestTableStore.get(workspaceId);
                if (!existing || existing.version !== expectedVersion) {
                  return { data: [], error: null };
                }
                const updatedRow = {
                  ...existing,
                  ...updates,
                  version: updates.version ?? existing.version + 1,
                  snapshot_version: updates.snapshot_version ?? existing.snapshot_version + 1,
                  updated_at: updates.updated_at || new Date().toISOString(),
                };
                defaultTestTableStore.set(workspaceId, updatedRow);
                return { data: [{ ...updatedRow }], error: null };
              },
            }),
            select: async () => {
              const existing = defaultTestTableStore.get(val1);
              if (!existing) return { data: [], error: null };
              const updatedRow = {
                ...existing,
                ...updates,
                version: updates.version ?? existing.version + 1,
                snapshot_version: updates.snapshot_version ?? existing.snapshot_version + 1,
                updated_at: updates.updated_at || new Date().toISOString(),
              };
              defaultTestTableStore.set(val1, updatedRow);
              return { data: [{ ...updatedRow }], error: null };
            },
          }),
        }),
      };
    },
  };
}

async function getAuthoritativeDbClient(): Promise<any> {
  if (testDbClient) return testDbClient;
  if (process.env.NODE_ENV === 'test' && !process.env.INTEGRATION_TEST_REAL_SUPABASE) {
    return createInMemoryTestDbClient();
  }
  try {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin');
    const client = createAdminSupabaseClient();
    if (client) return client;
  } catch {
    // Admin unavailable
  }
  try {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const client = await createServerSupabaseClient();
    if (client) return client;
  } catch {
    // Server client unavailable
  }

  // In test environment, fallback to structured in-memory table mock if no client injected
  if (process.env.NODE_ENV === 'test') {
    return createInMemoryTestDbClient();
  }

  throw new PersistenceError(
    'AgentControlPlaneService',
    'Authoritative Supabase database client unavailable (Fail-Closed)'
  );
}

function generateTransitionId(prefix = 'tr'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToAgentControlState(row: any): AgentControlState {
  const version = Number(row.version ?? row.snapshot_version ?? 1);
  const snapshotVersion = Number(row.snapshot_version ?? row.version ?? 1);
  const nowIso = row.updated_at || new Date().toISOString();
  const desiredMode = row.desired_mode as DesiredAgentMode;
  const actualMode = row.actual_mode as ActualAgentMode;
  const blockerCode = row.blocker_code ?? null;
  const pauseReason = row.pause_reason ?? null;

  return {
    // Canonical SSOT 10 fields + version
    workspace_id: row.workspace_id,
    desired_mode: desiredMode,
    actual_mode: actualMode,
    active_plan_id: row.active_plan_id ?? null,
    active_action_run_count: Number(row.active_action_run_count ?? 0),
    blocker_code: blockerCode,
    pause_reason: pauseReason,
    transition_id: row.transition_id || generateTransitionId('init'),
    snapshot_version: snapshotVersion,
    version: version,
    updated_at: nowIso,

    // Compatibility & metadata fields
    workspaceId: row.workspace_id,
    desiredMode: desiredMode,
    actualMode: actualMode,
    activePlanId: row.active_plan_id ?? null,
    statusReason:
      pauseReason ||
      (actualMode === 'BLOCKED'
        ? `업무 차단됨 (${blockerCode})`
        : desiredMode === 'PAUSED'
          ? '사용자에 의해 업무 일시정지됨'
          : desiredMode === 'OFF'
            ? '에이전트 꺼짐'
            : '정상 자율 운영 중'),
    policyVersion: 'v1.0.0',
    budgetVersion: 'v1.0.0',
    pausedScopes: [],
    lastHeartbeatAt: typeof row.last_heartbeat_at === 'string' ? row.last_heartbeat_at : '',
    workerVersion: SOHEE_WORKER_VERSION,
    killSwitchActive: Boolean(row.kill_switch_active),
    updatedBy: row.updated_by || 'system',
    updatedAt: nowIso,
  };
}

function agentControlStateToRow(state: AgentControlState): any {
  return {
    workspace_id: state.workspace_id,
    desired_mode: state.desired_mode,
    actual_mode: state.actual_mode,
    active_plan_id: state.active_plan_id,
    active_action_run_count: state.active_action_run_count,
    blocker_code: state.blocker_code,
    pause_reason: state.pause_reason,
    transition_id: state.transition_id,
    snapshot_version: state.snapshot_version,
    version: state.version,
    kill_switch_active: state.killSwitchActive,
    last_heartbeat_at: state.lastHeartbeatAt,
    updated_by: state.updatedBy,
    updated_at: state.updated_at,
  };
}

function makeDualReturn<T extends object>(promise: Promise<T>, fallback: T): T & Promise<T> {
  // Prevent unhandled rejection crashes when callers read synchronous properties only
  promise.catch(() => {});

  const proxy = new Proxy(promise as any, {
    get(target, prop, receiver) {
      if (prop === 'then') return target.then.bind(target);
      if (prop === 'catch') return target.catch.bind(target);
      if (prop === 'finally') return target.finally.bind(target);
      if (prop in target) return target[prop];
      return (fallback as any)[prop];
    },
    has(target, prop) {
      return prop in target || prop in fallback;
    },
    ownKeys(target) {
      const keys = new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(fallback)]);
      return Array.from(keys);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop in target) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
      }
      return (
        Reflect.getOwnPropertyDescriptor(fallback, prop) || {
          value: (fallback as any)[prop],
          writable: true,
          enumerable: true,
          configurable: true,
        }
      );
    },
  });
  return proxy as T & Promise<T>;
}

export class AgentControlPlaneService {
  /**
   * Test hook: set custom Supabase client for unit test isolation
   */
  static setDbClientForTest(client: any): void {
    testDbClient = client;
  }

  /**
   * Wipe process-memory transient cache (simulating cold-start serverless worker)
   */
  static clearTransientCache(): void {
    transientCache.clear();
  }

  /**
   * Reset transient store for unit testing and state isolation
   */
  static resetForTest(workspaceId?: string): void {
    if (workspaceId) {
      transientCache.delete(workspaceId);
      defaultTestTableStore.delete(workspaceId);
    } else {
      transientCache.clear();
      defaultTestTableStore.clear();
      testDbClient = null;
    }
  }

  private static createDefaultState(workspaceId: string): AgentControlState {
    const nowIso = new Date().toISOString();
    return {
      workspace_id: workspaceId,
      desired_mode: 'PAUSED',
      actual_mode: 'PAUSED',
      active_plan_id: null,
      active_action_run_count: 0,
      blocker_code: null,
      pause_reason: NEW_WORKSPACE_PAUSED_REASON,
      transition_id: generateTransitionId('init'),
      snapshot_version: 1,
      version: 1,
      updated_at: nowIso,

      workspaceId,
      desiredMode: 'PAUSED',
      actualMode: 'PAUSED',
      activePlanId: null,
      statusReason: '신규 워크스페이스 안전 대기 (시작 대기)',
      policyVersion: 'v1.0.0',
      budgetVersion: 'v1.0.0',
      pausedScopes: [],
      lastHeartbeatAt: nowIso,
      workerVersion: SOHEE_WORKER_VERSION,
      killSwitchActive: false,
      updatedBy: 'system',
      updatedAt: nowIso,
    };
  }

  /**
   * Returns authoritative runtime control state for a workspace.
   * Backed by Supabase PostgreSQL table workspace_runtime_control_states.
   * Returns a Dual-Return object (both Promise and synchronous fields for backwards compatibility).
   */
  static getControlState(workspaceId: string): AgentControlState & Promise<AgentControlState> {
    // 동기 호환 속성은 미검증 캐시를 실행 허가로 노출하지 않는다. 정본은 await 결과뿐이다.
    const fallback: AgentControlState = {
      ...this.createDefaultState(workspaceId),
      actualMode: 'DEGRADED', actual_mode: 'DEGRADED', killSwitchActive: true,
      statusReason: '서버 제어 상태 확인 전 · 실행 차단',
    };

    const fetchPromise = (async () => {
      const client = await getAuthoritativeDbClient();

      const { data, error } = await client
        .from('workspace_runtime_control_states')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error) {
        throw new PersistenceError('getControlState', error.message, error);
      }

      if (data) {
        const hydrated = rowToAgentControlState(data);
        if (data.workspace_id !== workspaceId) throw new PersistenceError('getControlState', 'Workspace mismatch');
        transientCache.set(workspaceId, hydrated);
        return hydrated;
      }

      // First-time init: persist current transient state or default safe state into Supabase DB
      // Use ignoreDuplicates: true so a concurrent worker or owner kill-switch update is NEVER overwritten with defaults.
      const stateToPersist = this.createDefaultState(workspaceId);
      const initialRow = agentControlStateToRow(stateToPersist);

      const { data: inserted, error: insertError } = await client
        .from('workspace_runtime_control_states')
        .upsert(initialRow, { onConflict: 'workspace_id', ignoreDuplicates: true })
        .select()
        .maybeSingle();

      if (insertError || !inserted) {
        // Check if concurrent worker already created or updated it
        const { data: retryData, error: retryError } = await client
          .from('workspace_runtime_control_states')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (retryData) {
          const hydrated = rowToAgentControlState(retryData);
          transientCache.set(workspaceId, hydrated);
          return hydrated;
        }
        if (insertError) {
          throw new PersistenceError('getControlState:insert', insertError.message, insertError);
        }
        if (retryError) {
          throw new PersistenceError('getControlState:retry', retryError.message, retryError);
        }
      }

      const hydrated = rowToAgentControlState(inserted!);
      transientCache.set(workspaceId, hydrated);
      return hydrated;
    })();

    return makeDualReturn(fetchPromise, fallback);
  }

  /**
   * Transition desired mode with optimistic concurrency control (CAS) and DB SSOT persistence.
   *
   * Signatures supported:
   * - setDesiredMode(workspaceId, desiredMode, reason, expectedVersion)
   * - setDesiredMode(workspaceId, desiredMode, updatedBy, reason, options)
   * - setDesiredMode(workspaceId, desiredMode, updatedBy, reason, expectedVersion)
   */
  static setDesiredMode(
    workspaceId: string,
    desiredMode: DesiredAgentMode,
    updatedByOrReason: string,
    reasonOrExpectedVersion?: string | number,
    optionsOrExpectedVersion?: SetDesiredModeOptions | number
  ): AgentControlState & Promise<AgentControlState> {
    let updatedBy = 'system';
    let reason: string | undefined;
    let expectedVersion: number | undefined;
    let blockerCode: string | null | undefined;
    let creditBalance: number | undefined;

    if (typeof reasonOrExpectedVersion === 'number') {
      // Signature: setDesiredMode(workspaceId, mode, reason, expectedVersion)
      reason = updatedByOrReason;
      expectedVersion = reasonOrExpectedVersion;
      if (typeof optionsOrExpectedVersion === 'object' && optionsOrExpectedVersion !== null) {
        blockerCode = optionsOrExpectedVersion.blockerCode;
        creditBalance = optionsOrExpectedVersion.creditBalance;
        if (typeof optionsOrExpectedVersion.expectedVersion === 'number') {
          expectedVersion = optionsOrExpectedVersion.expectedVersion;
        }
      }
    } else {
      // Signature: setDesiredMode(workspaceId, mode, updatedBy, reason?, options?)
      updatedBy = updatedByOrReason;
      reason = typeof reasonOrExpectedVersion === 'string' ? reasonOrExpectedVersion : undefined;
      if (typeof optionsOrExpectedVersion === 'number') {
        expectedVersion = optionsOrExpectedVersion;
      } else if (typeof optionsOrExpectedVersion === 'object' && optionsOrExpectedVersion !== null) {
        blockerCode = optionsOrExpectedVersion.blockerCode;
        creditBalance = optionsOrExpectedVersion.creditBalance;
        expectedVersion = optionsOrExpectedVersion.expectedVersion;
      }
    }

    const current = transientCache.get(workspaceId) || this.createDefaultState(workspaceId);
    const nowIso = new Date().toISOString();

    let actualMode: ActualAgentMode = current.actual_mode;
    let finalBlockerCode: string | null = blockerCode !== undefined ? blockerCode : current.blocker_code;

    if (desiredMode === 'OFF') {
      actualMode = 'OFF';
      finalBlockerCode = null;
    } else if (desiredMode === 'PAUSED') {
      actualMode = 'PAUSED';
      finalBlockerCode = null;
    } else if (desiredMode === 'RUNNING') {
      if (current.killSwitchActive) {
        actualMode = 'BLOCKED';
        finalBlockerCode = finalBlockerCode || 'KILL_SWITCH_ACTIVE';
      } else if (creditBalance === 0 || blockerCode) {
        actualMode = 'BLOCKED';
        finalBlockerCode = blockerCode || 'NO_CREDIT';
      } else {
        actualMode = 'RUNNING';
        finalBlockerCode = null;
      }
    }

    const pauseReason = desiredMode === 'PAUSED' ? reason || '사용자에 의해 업무 일시정지됨' : null;
    const statusReason =
      reason ||
      (desiredMode === 'PAUSED'
        ? '사용자에 의해 업무 일시정지됨'
        : actualMode === 'BLOCKED'
          ? `업무 차단됨 (${finalBlockerCode})`
          : desiredMode === 'OFF'
            ? '에이전트 꺼짐'
            : '정상 자율 운영 중');

    const baseVersion = expectedVersion !== undefined ? expectedVersion : current.version || current.snapshot_version || 1;
    const nextVersion = baseVersion + 1;
    const nextTransitionId = generateTransitionId('mode');

    const fallbackUpdated: AgentControlState = {
      ...current,
      workspace_id: workspaceId,
      desired_mode: desiredMode,
      actual_mode: actualMode,
      blocker_code: finalBlockerCode,
      pause_reason: pauseReason,
      transition_id: nextTransitionId,
      snapshot_version: nextVersion,
      version: nextVersion,
      updated_at: nowIso,

      workspaceId,
      desiredMode,
      actualMode,
      statusReason,
      updatedBy,
      updatedAt: nowIso,
      lastHeartbeatAt: nowIso,
    };

    // 요청 중 값은 정본 캐시에 반영하지 않는다. 성공한 DB 응답만 아래에서 기록한다.

    const mutationPromise = (async () => {
      try {
        const client = await getAuthoritativeDbClient();

        // Check authoritative current DB state to prevent version rollback
        const { data: existingRow, error: selectError } = await client
          .from('workspace_runtime_control_states')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (selectError) {
          throw new PersistenceError('setDesiredMode:select', selectError.message, selectError);
        }

        const authoritativeCurrentVersion = existingRow
          ? Math.max(Number(existingRow.version ?? 1), Number(existingRow.snapshot_version ?? 1))
          : 1;

        const effectiveNextVersion =
          expectedVersion !== undefined ? expectedVersion + 1 : authoritativeCurrentVersion + 1;

        const updates = {
          desired_mode: desiredMode,
          actual_mode: desiredMode === 'RUNNING'
            ? existingRow?.kill_switch_active === true || creditBalance === 0 || blockerCode ? 'BLOCKED' : 'RUNNING'
            : desiredMode,
          blocker_code: desiredMode !== 'RUNNING' ? null : existingRow?.kill_switch_active === true ? 'KILL_SWITCH_ACTIVE' : blockerCode || (creditBalance === 0 ? 'NO_CREDIT' : null),
          pause_reason: pauseReason,
          transition_id: nextTransitionId,
          snapshot_version: effectiveNextVersion,
          version: effectiveNextVersion,
          updated_by: updatedBy,
          updated_at: nowIso,
        };

        if (expectedVersion !== undefined) {
          // Optimistic CAS: update only if version matches expectedVersion
          const { data, error } = await client
            .from('workspace_runtime_control_states')
            .update(updates)
            .eq('workspace_id', workspaceId)
            .eq('version', expectedVersion)
            .select();

          if (error) {
            throw new PersistenceError('setDesiredMode:cas', error.message, error);
          }

          if (data && data.length > 0) {
            const hydrated = rowToAgentControlState(data[0]);
            transientCache.set(workspaceId, hydrated);
            return hydrated;
          }

          // If no row updated, check if fresh workspace transitioning from initial version 1
          if (expectedVersion === 1 && !existingRow) {
            const insertRow = {
              ...agentControlStateToRow(fallbackUpdated),
              ...updates,
              version: 2,
              snapshot_version: 2,
            };
            const { data: inserted, error: insertError } = await client
              .from('workspace_runtime_control_states')
              .upsert(insertRow, { onConflict: 'workspace_id' })
              .select()
              .single();

            if (!insertError && inserted) {
              const hydrated = rowToAgentControlState(inserted);
              transientCache.set(workspaceId, hydrated);
              return hydrated;
            }
          }

          // Concurrency conflict / stale version: revert cache and fail closed
          transientCache.set(workspaceId, current);
          throw new RuntimeControlConflictError(
            `Runtime control state version conflict for workspace ${workspaceId}: expected version ${expectedVersion}`
          );
        } else {
          // Unconditional update by workspace_id with monotonic version
          if (existingRow) {
            const { data, error } = await client
              .from('workspace_runtime_control_states')
              .update(updates)
              .eq('workspace_id', workspaceId)
              .eq('version', authoritativeCurrentVersion)
              .select();

            if (error) {
              throw new PersistenceError('setDesiredMode:update', error.message, error);
            }

            if (data && data.length > 0) {
              const hydrated = rowToAgentControlState(data[0]);
              transientCache.set(workspaceId, hydrated);
              return hydrated;
            }
            throw new RuntimeControlConflictError('서버 제어 상태가 다른 요청에서 변경되었습니다.');
          }

          // If not found in DB yet, insert fresh row
          const insertRow = {
            ...agentControlStateToRow(fallbackUpdated),
            ...updates,
          };

          const { data: inserted, error: insertError } = await client
            .from('workspace_runtime_control_states')
            .upsert(insertRow, { onConflict: 'workspace_id' })
            .select()
            .single();

          if (insertError) {
            throw new PersistenceError('setDesiredMode:insert', insertError.message, insertError);
          }

          const hydrated = rowToAgentControlState(inserted);
          transientCache.set(workspaceId, hydrated);
          return hydrated;
        }
      } catch (err) {
        // Rollback transient cache on any DB failure
        transientCache.set(workspaceId, current);
        throw err;
      }
    })();

    return makeDualReturn(mutationPromise, { ...fallbackUpdated, actualMode: 'DEGRADED', actual_mode: 'DEGRADED', killSwitchActive: true });
  }

  static toggleKillSwitch(
    workspaceId: string,
    active: boolean,
    updatedBy: string,
    reason?: string
  ): AgentControlState & Promise<AgentControlState> {
    const current = transientCache.get(workspaceId) || this.createDefaultState(workspaceId);
    const nowIso = new Date().toISOString();

    const actualMode: ActualAgentMode = active ? 'BLOCKED' : current.desired_mode === 'RUNNING' ? 'RUNNING' : 'PAUSED';
    const blockerCode = active ? 'KILL_SWITCH_ACTIVE' : null;
    const nextVersion = (current.version || current.snapshot_version || 1) + 1;
    const nextTransitionId = generateTransitionId('killswitch');

    const fallbackUpdated: AgentControlState = {
      ...current,
      killSwitchActive: active,
      actual_mode: actualMode,
      actualMode,
      blocker_code: blockerCode,
      transition_id: nextTransitionId,
      snapshot_version: nextVersion,
      version: nextVersion,
      statusReason: active
        ? reason || 'Global Kill Switch 활성화됨: 모든 외부 쓰기 작업 차단'
        : 'Kill Switch 해제: 정상 복구',
      updatedBy,
      updated_at: nowIso,
      updatedAt: nowIso,
      lastHeartbeatAt: nowIso,
    };

    // 요청 중 값은 정본 캐시에 반영하지 않는다. 성공한 DB 응답만 아래에서 기록한다.

    const mutationPromise = (async () => {
      try {
        const client = await getAuthoritativeDbClient();

        // Read DB state to prevent version rollback across cold-starts
        const { data: existingRow, error: selectError } = await client
          .from('workspace_runtime_control_states')
          .select('*')
          .eq('workspace_id', workspaceId)
          .maybeSingle();

        if (selectError) {
          throw new PersistenceError('toggleKillSwitch:select', selectError.message, selectError);
        }

        const authoritativeCurrentVersion = existingRow
          ? Math.max(Number(existingRow.version ?? 1), Number(existingRow.snapshot_version ?? 1))
          : (current.version || current.snapshot_version || 1);

        const effectiveNextVersion = authoritativeCurrentVersion + 1;

        const updates = {
          kill_switch_active: active,
          actual_mode: active ? 'BLOCKED' : existingRow?.desired_mode === 'RUNNING' ? 'RUNNING' : existingRow?.desired_mode === 'OFF' ? 'OFF' : 'PAUSED',
          blocker_code: blockerCode,
          transition_id: nextTransitionId,
          snapshot_version: effectiveNextVersion,
          version: effectiveNextVersion,
          updated_by: updatedBy,
          updated_at: nowIso,
        };

        if (existingRow) {
          const { data, error } = await client
            .from('workspace_runtime_control_states')
            .update(updates)
            .eq('workspace_id', workspaceId)
            .eq('version', authoritativeCurrentVersion)
            .select();

          if (error) {
            throw new PersistenceError('toggleKillSwitch:update', error.message, error);
          }

          if (data && data.length > 0) {
            const hydrated = rowToAgentControlState(data[0]);
            transientCache.set(workspaceId, hydrated);
            return hydrated;
          }
          throw new RuntimeControlConflictError('서버 제어 상태가 다른 요청에서 변경되었습니다.');
        }

        const insertRow = {
          ...agentControlStateToRow(fallbackUpdated),
          ...updates,
        };

        const { data: inserted, error: insertError } = await client
          .from('workspace_runtime_control_states')
          .upsert(insertRow, { onConflict: 'workspace_id' })
          .select()
          .single();

        if (insertError) {
          throw new PersistenceError('toggleKillSwitch:insert', insertError.message, insertError);
        }

        const hydrated = rowToAgentControlState(inserted);
        transientCache.set(workspaceId, hydrated);
        return hydrated;
      } catch (err) {
        // Rollback transient cache on failure
        transientCache.set(workspaceId, current);
        throw err;
      }
    })();

    return makeDualReturn(mutationPromise, { ...fallbackUpdated, actualMode: 'DEGRADED', actual_mode: 'DEGRADED', killSwitchActive: true });
  }

  static updateHeartbeat(workspaceId: string, workerVersion: string): AgentControlState & Promise<AgentControlState> {
    const current = transientCache.get(workspaceId) || this.createDefaultState(workspaceId);
    const nowIso = new Date().toISOString();

    const fallbackUpdated: AgentControlState = {
      ...current,
      workerVersion,
      lastHeartbeatAt: nowIso,
      updated_at: nowIso,
      updatedAt: nowIso,
    };

    transientCache.set(workspaceId, fallbackUpdated);

    const mutationPromise = (async () => {
      try {
        const client = await getAuthoritativeDbClient();

        const updates = {
          last_heartbeat_at: nowIso,
          updated_at: nowIso,
        };

        const { data, error } = await client
          .from('workspace_runtime_control_states')
          .update(updates)
          .eq('workspace_id', workspaceId)
          .select();

        if (error) {
          throw new PersistenceError('updateHeartbeat:update', error.message, error);
        }

        if (data && data.length > 0) {
          const hydrated = rowToAgentControlState(data[0]);
          transientCache.set(workspaceId, hydrated);
          return hydrated;
        }

        transientCache.set(workspaceId, fallbackUpdated);
        return fallbackUpdated;
      } catch (err) {
        transientCache.set(workspaceId, current);
        throw err;
      }
    })();

    return makeDualReturn(mutationPromise, { ...fallbackUpdated, actualMode: 'DEGRADED', actual_mode: 'DEGRADED', killSwitchActive: true });
  }
}
