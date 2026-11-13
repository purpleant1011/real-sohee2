/**
 * Approved Fact Snapshot Gate (V0.93 W7 P0 Gate)
 *
 * Boundary Note:
 * This module defines structural contracts identical to W8 (`src/features/knowledge/approved-fact-resolver.ts`)
 * without importing W8 modules that are not yet merged into this worktree.
 * All verifications are fail-closed: missing resolver or missing snapshot strictly blocks approval & publish.
 */

import {
  loadApprovedFactSnapshot as w8LoadApprovedFactSnapshot,
  assertFactSnapshotCurrent as w8AssertFactSnapshotCurrent,
} from '@/features/knowledge/approved-fact-resolver'

export interface ApprovedFactRow {
  id: string
  workspace_id: string
  category: string
  content: string
  status: string
  source_candidate_id: string
  approved_by_user_id: string
  approved_at: string
  valid_from: string
  valid_until: string | null
  supersedes_fact_id: string | null
  created_at: string
}

export interface ApprovedFactSnapshot {
  readonly workspaceId: string
  readonly resolvedAt: string
  readonly facts: readonly Readonly<ApprovedFactRow>[]
  readonly hash: string
}

export type FactReader = {
  from(table: string): {
    select(columns: string, options?: { count?: 'exact' }): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown; count?: unknown }>
    }
  }
}

export type FactSnapshotLoader = (
  client: FactReader,
  workspaceId: string,
  at?: string,
) => Promise<ApprovedFactSnapshot>

export type FactSnapshotAsserter = (
  previous: ApprovedFactSnapshot,
  current: ApprovedFactSnapshot,
) => void

export interface FactSnapshotResolver {
  readonly loadApprovedFactSnapshot: FactSnapshotLoader
  readonly assertFactSnapshotCurrent: FactSnapshotAsserter
}

export type FactSnapshotGateSuccess = {
  readonly ok: true
  readonly currentSnapshot: ApprovedFactSnapshot
}

export type FactSnapshotGateFailure = {
  readonly ok: false
  readonly status: 409 | 503
  readonly code: 'FACT_REVIEW_REQUIRED' | 'FACT_READ_FAILED' | 'FACT_SOURCE_UNAVAILABLE'
  readonly reason:
    | 'SNAPSHOT_MISSING'
    | 'WORKSPACE_MISMATCH'
    | 'FACTS_CHANGED'
    | 'RESOLVER_UNAVAILABLE'
    | 'READ_FAILED'
    | 'UNKNOWN_VERIFIER_ERROR'
    | 'CHANNEL_SOURCE_REVOKED'
    | 'CHANNEL_GATE_FAILED'
  readonly error: string
}

export type FactSnapshotGateResult = FactSnapshotGateSuccess | FactSnapshotGateFailure

/**
 * Single static adapter point for W8 integration.
 * Statically wired to W8 loadApprovedFactSnapshot and assertFactSnapshotCurrent.
 * Zero mutable globals or setters.
 */
const defaultFactSnapshotResolver: FactSnapshotResolver = Object.freeze({
  loadApprovedFactSnapshot: (client: FactReader, workspaceId: string, at?: string) =>
    w8LoadApprovedFactSnapshot(client as any, workspaceId, at) as Promise<ApprovedFactSnapshot>,
  assertFactSnapshotCurrent: (previous: ApprovedFactSnapshot, current: ApprovedFactSnapshot) =>
    w8AssertFactSnapshotCurrent(previous as any, current as any),
})

export function getDefaultFactSnapshotResolver(): FactSnapshotResolver | null {
  return defaultFactSnapshotResolver
}

/**
 * Creates a guarded FactReader gateway locked to a specific workspace and table.
 *
 * Enforces:
 * 1. Only table 'knowledge_facts' can be read. (Throws on unauthorized tables).
 * 2. Only column 'workspace_id' matching the bound workspaceId can be queried. (Throws on mismatch).
 * 3. Passes columns and query options (e.g. { count: 'exact' }) through to the underlying executor.
 * 4. Bypasses deep Supabase Client generic resolution to prevent TS2589 compiler issues.
 */
export function createWorkspaceFactReader(
  workspaceId: string,
  readRows: (
    columns: string,
    options?: { count?: 'exact' },
  ) => PromiseLike<{ data: unknown; error: unknown; count?: unknown }>,
  rawClient?: any,
): FactReader & { rpc?: (name: string, args: any) => PromiseLike<any> } {
  if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
    throw new Error('INVALID_FACT_READER_WORKSPACE')
  }
  return {
    from(table: string) {
      if (table !== 'knowledge_facts') {
        throw new Error(`UNAUTHORIZED_FACT_TABLE: ${table}`)
      }
      return {
        select(columns: string, options?: { count?: 'exact' }) {
          return {
            eq(column: string, value: string) {
              if (column !== 'workspace_id' || value !== workspaceId) {
                throw new Error(`UNAUTHORIZED_FACT_QUERY: ${column}=${value}`)
              }
              return readRows(columns, options)
            },
          }
        },
      }
    },
    rpc(name: string, args: any) {
      if (typeof rawClient?.rpc === 'function') {
        return rawClient.rpc(name, args)
      }
      return Promise.resolve({ data: null, error: { message: 'RPC_NOT_SUPPORTED' } })
    },
  }
}

function isIsoTimezoneString(val: unknown): val is string {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(val)) return false
  return Number.isFinite(Date.parse(val))
}

function isApprovedFactRow(val: unknown): val is ApprovedFactRow {
  if (!val || typeof val !== 'object') return false
  const r = val as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    Boolean(r.id.trim()) &&
    typeof r.workspace_id === 'string' &&
    Boolean(r.workspace_id.trim()) &&
    typeof r.category === 'string' &&
    Boolean(r.category.trim()) &&
    typeof r.content === 'string' &&
    Boolean(r.content.trim()) &&
    typeof r.status === 'string' &&
    Boolean(r.status.trim()) &&
    typeof r.source_candidate_id === 'string' &&
    Boolean(r.source_candidate_id.trim()) &&
    typeof r.approved_by_user_id === 'string' &&
    Boolean(r.approved_by_user_id.trim()) &&
    isIsoTimezoneString(r.approved_at) &&
    isIsoTimezoneString(r.valid_from) &&
    (r.valid_until === null || isIsoTimezoneString(r.valid_until)) &&
    (r.supersedes_fact_id === null || (typeof r.supersedes_fact_id === 'string' && Boolean(r.supersedes_fact_id.trim()))) &&
    isIsoTimezoneString(r.created_at)
  )
}

export function isApprovedFactSnapshot(val: unknown): val is ApprovedFactSnapshot {
  if (!val || typeof val !== 'object') return false
  const s = val as Record<string, unknown>
  if (
    typeof s.workspaceId !== 'string' ||
    !s.workspaceId.trim() ||
    !isIsoTimezoneString(s.resolvedAt) ||
    typeof s.hash !== 'string' ||
    !s.hash.trim() ||
    !Array.isArray(s.facts)
  ) {
    return false
  }
  return s.facts.every((f) => isApprovedFactRow(f) && f.workspace_id === s.workspaceId)
}

/**
 * Validates the currency of the stored fact snapshot against the live knowledge ledger.
 *
 * Evaluation Invariants:
 * 1. Previous snapshot envelope & workspace validation precedes resolver check.
 *    (Missing/corrupted snapshot always returns 409 SNAPSHOT_MISSING/WORKSPACE_MISMATCH even if resolver is null).
 * 2. Missing resolver when previous snapshot is valid: 503 FACT_SOURCE_UNAVAILABLE.
 * 3. Loader/DB read failure or invalid current snapshot envelope: 503 FACT_READ_FAILED.
 * 4. Current snapshot workspace mismatch: 503 FACT_READ_FAILED (permissive fake assert cannot bypass).
 * 5. Stale facts / hash mismatch (FACT_SNAPSHOT_STALE): 409 FACT_REVIEW_REQUIRED.
 * 6. Unexpected verifier exception: 503 FACT_READ_FAILED.
 * 7. Error DTO contains strictly user-safe Korean copy and reason codes — NO raw facts, tokens, or hashes.
 * 8. Never mutates or auto-replaces the stored snapshot.
 */
export async function revalidateApprovedFactSnapshot(input: {
  admin: FactReader
  workspaceId: string
  previousSnapshot: unknown
  resolver?: FactSnapshotResolver | null
  at?: string
  learningDependencies?: Array<{ workspaceId: string; sourceId: string; revision: number }>
  learningEpoch?: number
}): Promise<FactSnapshotGateResult> {
  const { admin, workspaceId, previousSnapshot, at, learningDependencies, learningEpoch } = input

  if (!workspaceId || typeof workspaceId !== 'string') {
    return {
      ok: false,
      status: 409,
      code: 'FACT_REVIEW_REQUIRED',
      reason: 'WORKSPACE_MISMATCH',
      error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    }
  }

  // 1. Envelope validation: previousSnapshot must be a valid ApprovedFactSnapshot
  if (!isApprovedFactSnapshot(previousSnapshot)) {
    return {
      ok: false,
      status: 409,
      code: 'FACT_REVIEW_REQUIRED',
      reason: 'SNAPSHOT_MISSING',
      error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    }
  }

  if (previousSnapshot.workspaceId !== workspaceId) {
    return {
      ok: false,
      status: 409,
      code: 'FACT_REVIEW_REQUIRED',
      reason: 'WORKSPACE_MISMATCH',
      error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
    }
  }

  // 2. Resolver availability check
  const resolver = input.resolver
  if (!resolver) {
    return {
      ok: false,
      status: 503,
      code: 'FACT_SOURCE_UNAVAILABLE',
      reason: 'RESOLVER_UNAVAILABLE',
      error: '가게 정보 확인 서비스를 준비하고 있어요. 잠시 후 다시 시도해 주세요.',
    }
  }

  // 3. Load live current snapshot using server clock
  const resolveAt = isIsoTimezoneString(at) ? at : new Date().toISOString()
  let currentSnapshot: ApprovedFactSnapshot
  try {
    currentSnapshot = await resolver.loadApprovedFactSnapshot(admin, workspaceId, resolveAt)
  } catch (_readErr: unknown) {
    return {
      ok: false,
      status: 503,
      code: 'FACT_READ_FAILED',
      reason: 'READ_FAILED',
      error: '가게 정보 확인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
    }
  }

  // 4. Validate current snapshot envelope and tenant
  if (!isApprovedFactSnapshot(currentSnapshot)) {
    return {
      ok: false,
      status: 503,
      code: 'FACT_READ_FAILED',
      reason: 'READ_FAILED',
      error: '가게 정보 확인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
    }
  }

  if (currentSnapshot.workspaceId !== workspaceId) {
    return {
      ok: false,
      status: 503,
      code: 'FACT_READ_FAILED',
      reason: 'READ_FAILED',
      error: '가게 정보 확인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
    }
  }

  // 5. Assert currency
  try {
    resolver.assertFactSnapshotCurrent(previousSnapshot, currentSnapshot)
  } catch (assertErr: unknown) {
    if (assertErr instanceof Error && assertErr.message === 'FACT_SNAPSHOT_STALE') {
      return {
        ok: false,
        status: 409,
        code: 'FACT_REVIEW_REQUIRED',
        reason: 'FACTS_CHANGED',
        error: '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.',
      }
    }
    return {
      ok: false,
      status: 503,
      code: 'FACT_READ_FAILED',
      reason: 'UNKNOWN_VERIFIER_ERROR',
      error: '가게 정보 확인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
    }
  }

  // 6. Channel Learning Dependency Validation (ANI-2205)
  if (
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1' &&
    learningDependencies &&
    learningDependencies.length > 0 &&
    typeof (admin as any)?.rpc === 'function'
  ) {
    try {
      const { createSupabaseConsumerGate, validateLearningResult } = await import('@/features/channel-learning/consumer-gate')
      const gate = createSupabaseConsumerGate(admin as any, 'content')
      const isValid = await validateLearningResult(
        {
          workspaceId,
          epoch: learningEpoch ?? 1,
          dependencies: learningDependencies,
          purpose: 'content',
        },
        gate
      )
      if (!isValid) {
        return {
          ok: false,
          status: 409,
          code: 'FACT_REVIEW_REQUIRED',
          reason: 'CHANNEL_SOURCE_REVOKED',
          error: '가게 공식 채널 정보가 변경/철회되어 발행할 수 없어요. 글을 다시 작성해 주세요.',
        }
      }
    } catch {
      return {
        ok: false,
        status: 503,
        code: 'FACT_READ_FAILED',
        reason: 'CHANNEL_GATE_FAILED',
        error: '가게 정보 확인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
      }
    }
  }

  return {
    ok: true,
    currentSnapshot,
  }
}
