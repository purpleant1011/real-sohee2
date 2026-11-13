import { describe, it, expect } from 'vitest'
import {
  type DatasetMode,
  isValidDatasetMode,
  DEFAULT_DATASET_MODE,
  DATASET_MODES,
  type CanonicalDatasetTagged,
  filterForDatasetMode,
  assertActualIsolation,
  createEmptyActualState
} from '@/lib/dataset/dataset-guard'

describe('ANI-914: Production Dataset Isolation & False-Green Gate', () => {
  it('enforces canonical dataset modes: ACTUAL, SHOWCASE_DEMO, TEST', () => {
    expect(DATASET_MODES).toEqual(['ACTUAL', 'SHOWCASE_DEMO', 'TEST'])
    expect(isValidDatasetMode('ACTUAL')).toBe(true)
    expect(isValidDatasetMode('SHOWCASE_DEMO')).toBe(true)
    expect(isValidDatasetMode('TEST')).toBe(true)
    expect(isValidDatasetMode('MOCK')).toBe(false)
    expect(isValidDatasetMode('SAMPLE')).toBe(false)
    expect(DEFAULT_DATASET_MODE).toBe('ACTUAL')
  })

  it('filters rows strictly by dataset_mode and fails closed on ACTUAL surfaces', () => {
    const mixedRows: CanonicalDatasetTagged<{ id: string; name: string }>[] = [
      { id: '1', name: 'Real Customer Byreum', dataset_mode: 'ACTUAL', source: 'provider_api', measured_at: new Date().toISOString() },
      { id: '2', name: 'Showcase Demo Shop', dataset_mode: 'SHOWCASE_DEMO', source: 'demo_fixture', measured_at: new Date().toISOString() },
      { id: '3', name: 'Automated Test Row', dataset_mode: 'TEST', source: 'unit_test', measured_at: new Date().toISOString() },
    ]

    const actualRows = filterForDatasetMode(mixedRows, 'ACTUAL')
    expect(actualRows).toHaveLength(1)
    expect(actualRows[0].id).toBe('1')
    expect(actualRows[0].dataset_mode).toBe('ACTUAL')

    const demoRows = filterForDatasetMode(mixedRows, 'SHOWCASE_DEMO')
    expect(demoRows).toHaveLength(1)
    expect(demoRows[0].id).toBe('2')

    const testRows = filterForDatasetMode(mixedRows, 'TEST')
    expect(testRows).toHaveLength(1)
    expect(testRows[0].id).toBe('3')
  })

  it('throws error if non-ACTUAL data is asserted on an ACTUAL surface (fail-closed)', () => {
    const invalidRow: CanonicalDatasetTagged<{ metric: number }> = {
      metric: 100,
      dataset_mode: 'SHOWCASE_DEMO',
      source: 'fixture',
      measured_at: new Date().toISOString()
    }

    expect(() => assertActualIsolation(invalidRow)).toThrowError(/ACTUAL surface violation/)
  })

  it('provides verified empty state rather than populated fixtures for empty tenants', () => {
    const emptyState = createEmptyActualState('campaigns', 'provider_ad_account')
    expect(emptyState.isEmpty).toBe(true)
    expect(emptyState.dataset_mode).toBe('ACTUAL')
    expect(emptyState.source).toBe('provider_ad_account')
    expect(emptyState.status).toBe('EMPTY_VERIFIED')
    expect(emptyState.items).toEqual([])
  })
})
