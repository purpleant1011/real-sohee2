/**
 * @deprecated Legacy wire A preflight module. Routes use `fact-snapshot-gate.ts` (W7 thin gateway).
 * Retained for backward compatibility and integration review.
 */
import {
  loadApprovedFactSnapshot,
  assertFactSnapshotCurrent,
  type ApprovedFactSnapshot,
  type FactSnapshotLoader,
} from '@/features/knowledge/approved-fact-resolver'

export interface FactPreflightSuccess {
  readonly ok: true
  readonly currentSnapshot: ApprovedFactSnapshot
}

export interface FactPreflightFailure {
  readonly ok: false
  readonly status: 409 | 503
  readonly code: 'FACT_SNAPSHOT_STALE' | 'FACT_READ_FAILED'
  readonly error: string
}

export type FactPreflightResult = FactPreflightSuccess | FactPreflightFailure

export type FactReader = {
  from(table: string): any
}

export interface CheckMissionFactSnapshotOptions {
  admin: FactReader
  workspaceId: string
  storedSnapshot: ApprovedFactSnapshot | null | undefined
  loader?: FactSnapshotLoader
  now?: string
}

const CUSTOMER_REVIEW_ERROR_MESSAGE = '가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.'

export async function checkMissionFactSnapshot(
  options: CheckMissionFactSnapshotOptions,
): Promise<FactPreflightResult> {
  const { admin, workspaceId, storedSnapshot, loader = loadApprovedFactSnapshot, now } = options

  // 1. Missing snapshot -> 409 FACT_SNAPSHOT_STALE
  if (!storedSnapshot) {
    return {
      ok: false,
      status: 409,
      code: 'FACT_SNAPSHOT_STALE',
      error: CUSTOMER_REVIEW_ERROR_MESSAGE,
    }
  }

  // 2. Cross-tenant workspace mismatch -> 409 FACT_SNAPSHOT_STALE
  if (storedSnapshot.workspaceId !== workspaceId) {
    return {
      ok: false,
      status: 409,
      code: 'FACT_SNAPSHOT_STALE',
      error: CUSTOMER_REVIEW_ERROR_MESSAGE,
    }
  }

  // 3. Load current ledger as of now -> Fail-closed 503 FACT_READ_FAILED
  let current: ApprovedFactSnapshot
  try {
    current = await loader(admin, workspaceId, now)
  } catch (err) {
    console.error('[fact-snapshot-preflight] fact ledger read error:', err)
    return {
      ok: false,
      status: 503,
      code: 'FACT_READ_FAILED',
      error: CUSTOMER_REVIEW_ERROR_MESSAGE,
    }
  }

  // 4. Assert current snapshot matches stored snapshot -> 409 FACT_SNAPSHOT_STALE
  try {
    assertFactSnapshotCurrent(storedSnapshot, current)
  } catch (err) {
    console.warn('[fact-snapshot-preflight] fact snapshot stale:', err)
    return {
      ok: false,
      status: 409,
      code: 'FACT_SNAPSHOT_STALE',
      error: CUSTOMER_REVIEW_ERROR_MESSAGE,
    }
  }

  return {
    ok: true,
    currentSnapshot: current,
  }
}
