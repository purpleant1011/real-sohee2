import { describe, expect, it } from 'vitest'
import {
  buildNaverQueueTiles,
  buildQueueTiles,
  deriveOverallHealth,
  incidentStatusLabel,
  systemSourceLabel,
  verificationLabel,
} from './system-summary'

describe('buildQueueTiles', () => {
  it('returns null values when the queue read failed or is missing', () => {
    const tiles = buildQueueTiles(null)
    expect(tiles.map((t) => t.label)).toEqual(['대기', '처리 중', '재시도 필요', '실패 보관'])
    expect(tiles.every((t) => t.value === null)).toBe(true)
  })
  it('keeps real zero and flags problem queues', () => {
    const tiles = buildQueueTiles([
      { kind: 'waiting', count: 0, state: 'healthy' },
      { kind: 'running', count: 2, state: 'healthy' },
      { kind: 'retryable_failure', count: 3, state: 'degraded' },
      { kind: 'dead_letter', count: 1, state: 'error' },
    ])
    expect(tiles[0]).toMatchObject({ value: 0, tone: 'default' })
    expect(tiles[2]).toMatchObject({ value: 3, tone: 'warn' })
    expect(tiles[3].value).toBeNull()
  })
})

describe('buildNaverQueueTiles', () => {
  it('returns null values when the summary is null or undefined', () => {
    const tiles = buildNaverQueueTiles(null)
    expect(tiles.map((t) => t.label)).toEqual(['대기', '진행 중', '실패', '환불 대기'])
    expect(tiles.every((t) => t.value === null)).toBe(true)
    expect(tiles.every((t) => t.tone === 'default')).toBe(true)
  })

  it('correctly maps counts and sets warning/bad tones when jobs need attention', () => {
    const tiles = buildNaverQueueTiles({
      pending: 5,
      running: 2,
      failed: 1,
      creditReconcileNeededCount: 3,
    })
    expect(tiles[0]).toMatchObject({ kind: 'pending', value: 5, tone: 'default' })
    expect(tiles[1]).toMatchObject({ kind: 'running', value: 2, tone: 'default' })
    expect(tiles[2]).toMatchObject({ kind: 'failed', value: 1, tone: 'warn' })
    expect(tiles[3]).toMatchObject({ kind: 'credit_reconcile_needed', value: 3, tone: 'bad' })
  })

  it('uses default tone when failures and refunds are zero', () => {
    const tiles = buildNaverQueueTiles({
      pending: 0,
      running: 0,
      failed: 0,
      creditReconcileNeededCount: 0,
    })
    expect(tiles.every((t) => t.tone === 'default')).toBe(true)
    expect(tiles.map((t) => t.value)).toEqual([0, 0, 0, 0])
  })
})

describe('deriveOverallHealth', () => {
  it('is unknown when observations failed or are empty', () => {
    expect(deriveOverallHealth({ observations: null, activeIncidentCount: 0 })).toBe('unknown')
    expect(deriveOverallHealth({ observations: [], activeIncidentCount: 0 })).toBe('unknown')
    expect(deriveOverallHealth({ observations: [{ state: 'unknown' }], activeIncidentCount: 0 })).toBe('unknown')
  })
  it('flags degraded sources and open incidents', () => {
    expect(deriveOverallHealth({ observations: [{ state: 'degraded' }], activeIncidentCount: 0 })).toBe('attention')
    expect(deriveOverallHealth({ observations: [{ state: 'healthy' }], activeIncidentCount: 2 })).toBe('attention')
  })
  it('flags when naverReconcileNeededCount is greater than zero', () => {
    expect(
      deriveOverallHealth({
        observations: [{ state: 'healthy' }],
        activeIncidentCount: 0,
        naverReconcileNeededCount: 1,
      }),
    ).toBe('attention')
  })
  it('is healthy only with observed healthy data', () => {
    expect(deriveOverallHealth({ observations: [{ state: 'healthy' }], activeIncidentCount: 0 })).toBe('healthy')
    expect(deriveOverallHealth({ observations: [{ state: 'healthy' }], activeIncidentCount: null })).toBe('healthy')
    expect(
      deriveOverallHealth({
        observations: [{ state: 'healthy' }],
        activeIncidentCount: 0,
        naverReconcileNeededCount: 0,
      }),
    ).toBe('healthy')
  })
})

describe('labels', () => {
  it('uses Korean labels', () => {
    expect(systemSourceLabel('cloudflare')).toBe('서비스 인프라')
    expect(incidentStatusLabel('open')).toBe('처리 전')
    expect(verificationLabel(null)).toBe('확인할 수 없어요')
  })
})
