/**
 * Canonical Read Result Type (Doc 05 Section 10, ANI-1038)
 * 
 * Replaces ambiguous empty arrays on error with explicit, typed state transitions:
 * - DATA: Authoritative fresh data loaded successfully
 * - EMPTY: Verified empty state from authoritative source
 * - ERROR: Infrastructure or query failure (must NEVER be masked as empty data)
 * - STALE: Cached data served while live query failed or revalidating
 */

export type ReadResultState = 'DATA' | 'EMPTY' | 'ERROR' | 'STALE';

export type ReadResult<T> =
  | { state: 'DATA'; data: T; observedAt: string }
  | { state: 'EMPTY'; data: T; observedAt: string }
  | { state: 'ERROR'; errorCode: string; message: string; retryable: boolean; observedAt: string }
  | { state: 'STALE'; data: T; lastSuccessfulAt: string; observedAt: string };

export function createDataResult<T>(data: T): ReadResult<T> {
  return {
    state: 'DATA',
    data,
    observedAt: new Date().toISOString(),
  };
}

export function createEmptyResult<T>(emptyData: T): ReadResult<T> {
  return {
    state: 'EMPTY',
    data: emptyData,
    observedAt: new Date().toISOString(),
  };
}

export function createErrorResult<T = never>(
  errorCode: string,
  message: string,
  retryable = true
): ReadResult<T> {
  return {
    state: 'ERROR',
    errorCode,
    message,
    retryable,
    observedAt: new Date().toISOString(),
  };
}

export function createStaleResult<T>(data: T, lastSuccessfulAt: string): ReadResult<T> {
  return {
    state: 'STALE',
    data,
    lastSuccessfulAt,
    observedAt: new Date().toISOString(),
  };
}
