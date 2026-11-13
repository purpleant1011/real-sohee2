/**
 * V0.9 5차 수정 · Production Dataset Isolation & False-Green Guard (ANI-914)
 * 
 * Enforces canonical dataset separation across all surfaces:
 * - ACTUAL: Production live tenant data directly from verified providers/DB.
 * - SHOWCASE_DEMO: Curated product tour / sales showcase fixtures.
 * - TEST: Automated testing & synthetic verification data.
 * 
 * Fail-Closed Rule:
 * ACTUAL surfaces must never receive, query, or display SHOWCASE_DEMO or TEST rows.
 */

export const DATASET_MODES = ['ACTUAL', 'SHOWCASE_DEMO', 'TEST'] as const
export type DatasetMode = (typeof DATASET_MODES)[number]

export const DEFAULT_DATASET_MODE: DatasetMode = 'ACTUAL'

export function isValidDatasetMode(val: unknown): val is DatasetMode {
  return typeof val === 'string' && DATASET_MODES.includes(val as DatasetMode)
}

export interface CanonicalDatasetTagged<T = unknown> {
  dataset_mode: DatasetMode
  source: string
  measured_at: string
  [key: string]: unknown
}

export interface EmptyActualState<T = unknown> {
  isEmpty: true
  status: 'EMPTY_VERIFIED'
  dataset_mode: 'ACTUAL'
  resource: string
  source: string
  items: T[]
  measured_at: string
}

/**
 * Filters items strictly matching the given dataset mode.
 * Fails closed: non-matching rows are excluded.
 */
export function filterForDatasetMode<T extends CanonicalDatasetTagged<unknown>>(
  rows: T[],
  mode: DatasetMode
): T[] {
  return rows.filter(row => row.dataset_mode === mode)
}

/**
 * Asserts that a given record belongs to ACTUAL dataset.
 * Throws an error if a non-ACTUAL item is provided to an ACTUAL surface.
 */
export function assertActualIsolation<T extends CanonicalDatasetTagged<unknown>>(row: T): void {
  if (row.dataset_mode !== 'ACTUAL') {
    throw new Error(
      `[ANI-914] ACTUAL surface violation: attempted to access non-ACTUAL data (dataset_mode: ${row.dataset_mode}, source: ${row.source}) on an authoritative ACTUAL surface.`
    )
  }
}

/**
 * Creates a verified empty state for an ACTUAL tenant instead of rendering populated fixtures.
 */
export function createEmptyActualState<T = unknown>(
  resource: string,
  source: string = 'provider_source'
): EmptyActualState<T> {
  return {
    isEmpty: true,
    status: 'EMPTY_VERIFIED',
    dataset_mode: 'ACTUAL',
    resource,
    source,
    items: [],
    measured_at: new Date().toISOString()
  }
}
