import { describe, expect, it } from 'vitest'
import { COST_VALUE_ERROR, NOT_AGGREGATED, buildCostValue, computeCostValue } from '../cost-value'

const ws = { workspaceId: 'w1', name: '가게', createdAt: '2026-10-01T00:00:00Z' }

describe('ANI-1565 cost value', () => {
  it('counts only credits consumed up to the first vault save and never invents a cost', () => {
    const [row] = computeCostValue({
      workspaces: [ws],
      firstSaves: [{ workspaceId: 'w1', createdAt: '2026-10-02T00:00:00Z' }, { workspaceId: 'w1', createdAt: '2026-10-03T00:00:00Z' }],
      consumes: [
        { workspaceId: 'w1', amount: 100, occurredAt: '2026-10-01T10:00:00Z' },
        { workspaceId: 'w1', amount: 150, occurredAt: '2026-10-02T00:00:00Z' },
        { workspaceId: 'w1', amount: 250, occurredAt: '2026-10-04T00:00:00Z' },
        { workspaceId: 'other', amount: 999, occurredAt: '2026-10-01T10:00:00Z' },
      ],
      usageEvents: [{ workspaceId: 'w1', computedCredits: 5, occurredAt: '2026-10-01T11:00:00Z' }],
    })
    expect(row.creditsToFirstValue).toBe(250)
    expect(row.reachedFirstValue).toBe(true)
    expect(row.measuredCallCount).toBe(1)
    expect(row.costToFirstValue).toBe(NOT_AGGREGATED)
  })

  it('marks a workspace without a vault save as not reached and keeps zero as a real zero', () => {
    const [row] = computeCostValue({ workspaces: [ws], firstSaves: [], consumes: [], usageEvents: [] })
    expect(row.reachedFirstValue).toBe(false)
    expect(row.firstValueAt).toBeNull()
    expect(row.creditsToFirstValue).toBe(0)
  })

  it('reports source failure as an error, not as an empty result', async () => {
    const result = await buildCostValue({ load: async () => { throw new Error('boom') } })
    expect(result).toEqual({ kind: 'error', message: COST_VALUE_ERROR })
  })

  it('always labels trend and cost as not aggregated', async () => {
    const result = await buildCostValue({ load: async () => ({ workspaces: [], firstSaves: [], consumes: [], usageEvents: [] }) })
    expect(result).toMatchObject({ kind: 'ok', rows: [], transformTrend: NOT_AGGREGATED, costSource: NOT_AGGREGATED })
  })

  it('SupabaseCostValueRepository detects 1000 row truncation as error and does not report false zero', async () => {
    const { SupabaseCostValueRepository } = await import('../repository')
    const fakeDb = {
      from: (table: string) => {
        const q: any = {
          select: () => q,
          order: () => q,
          limit: () => Promise.resolve({ data: [{ id: 'w1', name: '가게', created_at: '2026-10-01T00:00:00Z' }], error: null }),
          in: () => q,
          is: () => q,
          eq: () => q,
          then: (res: any) => {
            if (table === 'vault_items') {
              // 1000 rows truncation
              return Promise.resolve({ data: Array.from({ length: 1000 }, () => ({ workspace_id: 'w1', created_at: '2026-10-02T00:00:00Z' })), error: null }).then(res)
            }
            return Promise.resolve({ data: [], error: null }).then(res)
          },
        }
        return q
      },
    }
    const repo = new SupabaseCostValueRepository(fakeDb as any)
    await expect(repo.load()).rejects.toThrow('COST_SOURCE_TRUNCATED')
    const result = await buildCostValue(repo)
    expect(result.kind).toBe('error')
    expect(result).toEqual({ kind: 'error', message: COST_VALUE_ERROR })
  })
})
