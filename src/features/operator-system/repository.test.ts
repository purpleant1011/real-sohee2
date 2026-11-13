import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireOperator: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperator: mocks.requireOperator,
}))

import { getOperatorSystemObservations } from './repository'

const row = {
  source: 'conversation_jobs' as const,
  state: 'degraded' as const,
  freshness: 'fresh' as const,
  observed_at: '2026-08-23T03:00:00.000Z',
  safe_code: 'NEEDS_ATTENTION',
  metric_value: 2,
}

describe('getOperatorSystemObservations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires global system.read and returns the safe observation projection', async () => {
    const rpc = vi.fn(async () => ({ data: { items: [row], observation_window: '24h' as const }, error: null }))

    const result = await getOperatorSystemObservations({ gateway: { rpc } })

    expect(mocks.requireOperator).toHaveBeenCalledWith('system.read', undefined)
    expect(rpc).toHaveBeenCalledWith('get_operator_system_observations_v2', {})
    expect(result).toEqual({
      data: { items: [{ source: 'conversation_jobs', state: 'degraded', freshness: 'fresh', observedAt: row.observed_at, safeCode: row.safe_code, metricValue: 2, observationWindow: '24h', factKind: 'observed' }], observationWindow: '24h' },
      error: null,
    })
  })

  it('fails closed when the wire contains raw logs, config, or secret fields', async () => {
    const result = await getOperatorSystemObservations({
      gateway: { rpc: async () => ({ data: { items: [{ ...row, raw_log: 'private', secret: 'private' }], observation_window: '24h' }, error: null }) },
    })

    expect(result).toEqual({ data: null, error: 'SYSTEM_OBSERVATION_UNAVAILABLE' })
  })

  it('preserves unknown and empty observation states without inventing metrics', async () => {
    const result = await getOperatorSystemObservations({
      gateway: { rpc: async () => ({ data: { items: [{ source: 'cloudflare', state: 'unknown', freshness: 'unknown', observed_at: null, safe_code: null, metric_value: null }], observation_window: '24h' }, error: null }) },
    })

    expect(result.data?.items[0]).toMatchObject({ source: 'cloudflare', state: 'unknown', freshness: 'unknown', observedAt: null, metricValue: null })
  })
  it('returns authoritative queue rows and honest release evidence', async () => {
    const result = await getOperatorSystemObservations({ gateway: { rpc: async () => ({ data: { items: [], observation_window: '24h', queue: ['waiting', 'running', 'retryable_failure', 'dead_letter'].map((kind) => ({ kind, count: 0, state: 'empty', freshness: 'empty', observed_at: null, safe_code: null, fact_kind: 'observed' })), release: { version_code: null, commit_sha_prefix: null, deployed_at: null, rollback_candidate_code: null, verification_state: 'unknown', source: 'release', fact_kind: 'unknown', freshness: 'unknown' } }, error: null }) } })
    expect(result.data?.queue).toHaveLength(4)
    expect(result.data?.queue?.every((item) => item.factKind === 'observed')).toBe(true)
    expect(result.data?.release?.verificationState).toBe('unknown')
  })

  it('rejects token-shaped safe codes and treats future observations as unknown', async () => {
    const tokenResult = await getOperatorSystemObservations({
      gateway: { rpc: async () => ({ data: { items: [{ ...row, safe_code: 'sk_live_123456789' }], observation_window: '24h' }, error: null }) },
    })
    expect(tokenResult).toEqual({ data: null, error: 'SYSTEM_OBSERVATION_UNAVAILABLE' })

    const futureResult = await getOperatorSystemObservations({
      gateway: { rpc: async () => ({ data: { items: [{ ...row, observed_at: '2999-01-01T00:00:00.000Z' }], observation_window: '24h' }, error: null }) },
    })
    expect(futureResult.data?.items[0].freshness).toBe('unknown')
  })
})
