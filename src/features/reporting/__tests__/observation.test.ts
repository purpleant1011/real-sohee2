import { describe, expect, it } from 'vitest'
import {
  UNCONFIRMED_LABEL,
  confirmationOf,
  confirmedValue,
  formatObservation,
  observationSource,
  observationTruth,
  type ReportingObservation,
} from '../observation'

const base: ReportingObservation = { value: null, state: 'NOT_OBSERVED', source: 'test',
  period: { start: '2026-10-08T00:00:00Z', end: '2026-10-15T00:00:00Z' }, observedAt: null, evidenceIds: [] }

describe('observation copy', () => {
  it('distinguishes zero, missing, connection required and error', () => {
    expect(formatObservation({ ...base, state: 'OBSERVED', value: 0 })).toBe('0건')
    expect(formatObservation(base)).toBe('아직 확인할 수 없어요')
    expect(formatObservation({ ...base, state: 'CONNECTION_REQUIRED' })).toBe('연결 필요')
    expect(formatObservation({ ...base, state: 'ERROR' })).toBe('조회 오류')
  })
})

describe('observation confirmation truth', () => {
  const observed: ReportingObservation = { ...base, state: 'OBSERVED', value: 3, source: 'reservations.created_at/current_status' }

  it('does not confirm an observed value when its source is missing or blank', () => {
    expect(observationSource({ ...observed, source: '   ' })).toBeNull()
    expect(confirmationOf({ ...observed, source: '   ' })).toBe('UNCONFIRMED')
    expect(confirmedValue({ ...observed, source: '' })).toBeNull()
    expect(observationTruth({ ...observed, source: '' })).toEqual({
      value: null,
      source: null,
      confirmation: 'UNCONFIRMED',
    })
    expect(UNCONFIRMED_LABEL).toBe('확인 안 됨')
  })

  it('confirms an observed value only when a source is named, including a real zero', () => {
    const zero: ReportingObservation = { ...observed, value: 0 }
    expect(observationSource(zero)).toBe('reservations.created_at/current_status')
    expect(confirmationOf(zero)).toBe('CONFIRMED')
    expect(confirmedValue(zero)).toBe(0)
    expect(observationTruth(zero)).toEqual({
      value: 0,
      source: 'reservations.created_at/current_status',
      confirmation: 'CONFIRMED',
    })
  })

  it('keeps error and connection-required distinct from missing evidence', () => {
    expect(confirmationOf(undefined)).toBe('UNCONFIRMED')
    expect(confirmationOf({ ...base, state: 'ERROR' })).toBe('ERROR')
    expect(confirmationOf({ ...base, state: 'CONNECTION_REQUIRED' })).toBe('CONNECTION_REQUIRED')
    expect(confirmationOf({ ...base, state: 'NOT_OBSERVED' })).toBe('UNCONFIRMED')
    expect(confirmationOf({ ...observed, value: null })).toBe('UNCONFIRMED')
  })

  it('never substitutes zero for an unconfirmed value', () => {
    expect(confirmedValue({ ...observed, source: ' ' })).toBeNull()
    expect(confirmedValue(undefined)).toBeNull()
  })
})
