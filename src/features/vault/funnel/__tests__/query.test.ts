import { describe, expect, it, vi } from 'vitest'
import { queryVaultFunnel } from '../query'

describe('queryVaultFunnel DB query & error handling', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const period = { from: '2026-10-01T00:00:00Z', to: '2026-10-07T23:59:59Z' }

  it('returns ERROR status when database query fails with error object', async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'relation "funnel_events" does not exist' },
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const result = await queryVaultFunnel({ admin: admin as any }, {
      workspaceId,
      period,
      channel: 'instagram',
    })

    expect(result.status).toBe('ERROR')
    expect(result.error).toBe('보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(result.error).not.toContain('relation "funnel_events" does not exist')
    expect(result.totalEvents).toBe(0)
    expect(result.overallConversionRate).toBeNull()
  })

  it('returns ERROR status when database throws an exception', async () => {
    const admin = {
      from: vi.fn().mockImplementation(() => {
        throw new Error('Connection refused')
      }),
    }

    const result = await queryVaultFunnel({ admin: admin as any }, {
      workspaceId,
      period,
      channel: 'ALL',
    })

    expect(result.status).toBe('ERROR')
    expect(result.error).toBe('보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(result.error).not.toContain('Connection refused')
  })

  it('returns EMPTY status when database query succeeds with 0 rows', async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const result = await queryVaultFunnel({ admin: admin as any }, {
      workspaceId,
      period,
      channel: 'instagram',
    })

    expect(result.status).toBe('EMPTY')
    expect(result.totalEvents).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('returns OK status with computed metrics when database returns rows', async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: '1',
                      workspace_id: workspaceId,
                      user_id: 'user',
                      event: 'preview_opened',
                      occurred_at: '2026-10-05T00:00:00Z',
                      properties: { channel: 'instagram' },
                      dedupe_key: 'p1',
                    },
                    {
                      id: '2',
                      workspace_id: workspaceId,
                      user_id: 'user',
                      event: 'vault_saved',
                      occurred_at: '2026-10-05T01:00:00Z',
                      properties: { channel: 'instagram' },
                      dedupe_key: 's1',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const result = await queryVaultFunnel({ admin: admin as any }, {
      workspaceId,
      period,
      channel: 'instagram',
    })

    expect(result.status).toBe('OK')
    expect(result.totalEvents).toBe(2)
    expect(result.stages.find(s => s.event === 'vault_saved')?.conversionRate).toBe(100.0)
  })

  it('PostgREST 1000행 절단 시 UNKNOWN(절단됨) 상태로 반환하고 위반/성공 0건을 단정하지 않는다', async () => {
    const thousandRows = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      workspace_id: workspaceId,
      user_id: 'user',
      event: 'preview_opened',
      occurred_at: '2026-10-05T00:00:00Z',
      properties: { channel: 'instagram' },
      dedupe_key: `p-${i}`,
    }))

    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: thousandRows,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const result = await queryVaultFunnel({ admin: admin as any }, {
      workspaceId,
      period,
      channel: 'instagram',
    })

    expect(result.status).toBe('UNKNOWN')
    expect(result.stages.every((s) => s.status === 'NOT_VERIFIED')).toBe(true)
  })
})
