import { describe, expect, it } from 'vitest'
import {
  aggregateRevenueStats,
  formatLedgerEntries,
  getOperatorRevenueData,
  type RawCreditLedgerEntry,
  type RawWorkspace,
  type RevenueGateway,
} from './revenue-repository'

describe('Revenue Repository Aggregation', () => {
  const sampleEntries: RawCreditLedgerEntry[] = [
    {
      id: 'e1000000-0000-0000-0000-000000000001',
      workspace_id: 'ws-1',
      kind: 'grant',
      action: '주간 정기 충전',
      amount: 1000,
      idempotency_key: 'idem-1',
      occurred_at: '2026-10-05T00:00:00Z',
    },
    {
      id: 'e1000000-0000-0000-0000-000000000002',
      workspace_id: 'ws-1',
      kind: 'consume',
      action: '인스타그램 피드 발행',
      amount: -250,
      idempotency_key: 'idem-2',
      occurred_at: '2026-10-06T00:00:00Z',
    },
    {
      id: 'e1000000-0000-0000-0000-000000000003',
      workspace_id: 'ws-2',
      kind: 'consume',
      action: '네이버 블로그 초안 생성',
      amount: -150,
      idempotency_key: 'idem-3',
      occurred_at: '2026-10-07T00:00:00Z',
    },
  ]

  const sampleWorkspaces: RawWorkspace[] = [
    { id: 'ws-1', name: '바이름 헤어' },
    { id: 'ws-2', name: '소희 뷰티' },
  ]

  it('aggregates distributed and settled credits over the explicit window', () => {
    const stats = aggregateRevenueStats(sampleEntries, 30)

    expect(stats.windowDays).toBe(30)
    expect(stats.windowLabel).toBe('최근 30일')
    expect(stats.totalScDistributed).toBe(1000)
    expect(stats.totalScSettled).toBe(400)
    expect(stats.burnRatePercent).toBe(40) // 400 / 1000 * 100
    expect(stats.activeWorkspacesCount).toBe(2)
  })

  it('reports null burn rate when no credits were distributed', () => {
    const onlyConsumes = sampleEntries.filter((e) => e.kind === 'consume')
    const stats = aggregateRevenueStats(onlyConsumes, 30)

    expect(stats.totalScDistributed).toBe(0)
    expect(stats.totalScSettled).toBe(400)
    expect(stats.burnRatePercent).toBeNull()
  })

  it('counts consumption by kind (stored unsigned) and ignores reserve/release holds', () => {
    const entries: RawCreditLedgerEntry[] = [
      { id: 'a', workspace_id: 'w', kind: 'grant', action: null, amount: 100, idempotency_key: 'k1', occurred_at: '2026-10-07T00:00:00Z' },
      { id: 'b', workspace_id: 'w', kind: 'reserve', action: 'chat_turn', amount: 20, idempotency_key: 'k2', occurred_at: '2026-10-07T00:00:00Z' },
      { id: 'c', workspace_id: 'w', kind: 'consume', action: 'chat_turn', amount: 5, idempotency_key: 'k3', occurred_at: '2026-10-07T00:00:00Z' },
      { id: 'd', workspace_id: 'w', kind: 'release', action: 'chat_turn', amount: 15, idempotency_key: 'k4', occurred_at: '2026-10-07T00:00:00Z' },
    ]
    const stats = aggregateRevenueStats(entries, 30)
    expect(stats.totalScDistributed).toBe(100)
    expect(stats.totalScSettled).toBe(5)
    expect(formatLedgerEntries(entries, [])[2].amountLabel).toBe('-5 SC')
  })

  it('never presents partial totals when the window was truncated', () => {
    const stats = aggregateRevenueStats(sampleEntries, 30, true)
    expect(stats.totalScDistributed).toBeNull()
    expect(stats.totalScSettled).toBeNull()
    expect(stats.burnRatePercent).toBeNull()
    expect(stats.activeWorkspacesCount).toBeNull()
  })

  it('truthfully reports uncomputable metrics (MRR, webhooks) as null', () => {
    const stats = aggregateRevenueStats(sampleEntries, 30)

    expect(stats.mrrKrw).toBeNull()
    expect(stats.mrrGrowth).toBeNull()
    expect(stats.idempotentStatus).toBeNull()
    expect(stats.idempotentIssuesCount).toBeNull()
  })

  it('formats ledger rows with Korean labels and workspace names without fake balance or operator', () => {
    const rows = formatLedgerEntries(sampleEntries, sampleWorkspaces)

    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      id: 'e1000000-0000-0000-0000-000000000001',
      referenceId: 'e1000000',
      workspace: '바이름 헤어',
      workspaceId: 'ws-1',
      typeLabel: '지급',
      amount: 1000,
      amountLabel: '+1,000 SC',
      isPositive: true,
      action: '주간 정기 충전',
      idempotencyKey: 'idem-1',
    })

    // Confirm fake balance and fake SYSTEM operator do not exist
    expect((rows[0] as any).balance).toBeUndefined()
    expect((rows[0] as any).operator).toBeUndefined()

    expect(rows[1]).toMatchObject({
      referenceId: 'e1000000',
      workspace: '바이름 헤어',
      typeLabel: '소모',
      amount: -250,
      amountLabel: '-250 SC',
      isPositive: false,
    })
  })

  it('falls back to truncated workspace ID when workspace name is unknown', () => {
    const rows = formatLedgerEntries(
      [{ ...sampleEntries[0], workspace_id: 'ws-unknown-999' }],
      sampleWorkspaces,
    )
    expect(rows[0].workspace).toBe('ws-unknown-999')
  })

  it('returns data successfully through injected gateway', async () => {
    const fakeGateway: RevenueGateway = {
      fetchRecentLedger: async () => ({ data: sampleEntries, error: null }),
      fetchWorkspaces: async () => ({ data: sampleWorkspaces, error: null }),
    }

    const result = await getOperatorRevenueData({
      gateway: fakeGateway,
      now: () => new Date('2026-10-08T00:00:00Z'),
    })

    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(result.data?.stats.totalScDistributed).toBe(1000)
    expect(result.data?.ledger).toHaveLength(3)
  })

  it('surfaces error honestly when database read fails', async () => {
    const failingGateway: RevenueGateway = {
      fetchRecentLedger: async () => ({ data: null, error: new Error('DB connection failed') }),
      fetchWorkspaces: async () => ({ data: [], error: null }),
    }

    const result = await getOperatorRevenueData({ gateway: failingGateway })

    expect(result.data).toBeNull()
    expect(result.error).toBe('CREDIT_LEDGER_READ_FAILED')
  })

  it('filters revenue data by workspaceId and kind correctly', async () => {
    const fakeGateway: RevenueGateway = {
      fetchRecentLedger: async (_since, _limit, filters) => {
        let rows = sampleEntries
        if (filters?.workspaceId) rows = rows.filter((r) => r.workspace_id === filters.workspaceId)
        if (filters?.kind) rows = rows.filter((r) => r.kind === filters.kind)
        return { data: rows, error: null }
      },
      fetchWorkspaces: async (ids) => ({
        data: sampleWorkspaces.filter((w) => ids.includes(w.id)),
        error: null,
      }),
    }

    // Filter by workspaceId
    const wsResult = await getOperatorRevenueData({
      gateway: fakeGateway,
      workspaceId: 'ws-1',
    })
    expect(wsResult.error).toBeNull()
    expect(wsResult.data?.ledger).toHaveLength(2)
    expect(wsResult.data?.ledger.every((l) => l.workspaceId === 'ws-1')).toBe(true)

    // Filter by kind='consume'
    const consumeResult = await getOperatorRevenueData({
      gateway: fakeGateway,
      kind: 'consume',
    })
    expect(consumeResult.error).toBeNull()
    expect(consumeResult.data?.ledger).toHaveLength(2)
    expect(consumeResult.data?.ledger.every((l) => l.type === 'consume')).toBe(true)

    // Filter by both workspaceId and kind='consume'
    const combinedResult = await getOperatorRevenueData({
      gateway: fakeGateway,
      workspaceId: 'ws-1',
      kind: 'consume',
    })
    expect(combinedResult.error).toBeNull()
    expect(combinedResult.data?.ledger).toHaveLength(1)
    expect(combinedResult.data?.ledger[0].workspaceId).toBe('ws-1')
    expect(combinedResult.data?.ledger[0].type).toBe('consume')
  })
})
