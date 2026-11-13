import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { getOperatorRevenueData, type RevenueGateway, type RawCreditLedgerEntry } from '@/features/operator-revenue/revenue-repository'
import { listOperatorChannelConnections, type OperatorChannelRpcGateway } from '@/features/operator-channels/repository'

// ANI-1744: 읽기 모델의 workspace 경계 부정 테스트.
// 실제 DB·관리자 키·외부 호출 없이 gateway 만 mock 한다.
// 가정하는 사고: RLS 나 admin 쿼리의 workspace 필터가 빠져 다른 workspace 행이 섞여 들어온다.
// 계약: 요청한 workspace 밖의 행은 결과에 절대 섞이지 않으며, 섞여 오면 빈 목록으로 숨기지 않고 fail-closed 한다.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const ledgerRow = (id: string, workspaceId: string, amount: number, kind = 'grant'): RawCreditLedgerEntry => ({
  id,
  workspace_id: workspaceId,
  kind,
  action: null,
  amount,
  idempotency_key: `key-${id}`,
  occurred_at: '2026-10-23T00:00:00.000Z',
})

describe('매출 읽기 모델 workspace 경계', () => {
  it('gateway 가 workspace 필터를 무시해도 다른 workspace 행은 원장·합계에 들어가지 않는다', async () => {
    const rows = [ledgerRow('a1', A, 1000), ledgerRow('b1', B, 9000), ledgerRow('a2', A, 500, 'consume')]
    const gateway: RevenueGateway = {
      // 필터를 의도적으로 무시한다(RLS 실패·필터 누락 가정).
      fetchRecentLedger: async () => ({ data: rows, error: null }),
      fetchWorkspaces: async (ids) => ({
        data: [
          { id: A, name: '가게 A' },
          { id: B, name: '가게 B' },
        ].filter((w) => ids.includes(w.id)),
        error: null,
      }),
    }

    const result = await getOperatorRevenueData({ gateway, workspaceId: A })
    expect(result.error).toBeNull()
    expect(result.data?.ledger.map((l) => l.id)).toEqual(['a1', 'a2'])
    expect(result.data?.ledger.every((l) => l.workspaceId === A)).toBe(true)
    // 합계도 이 workspace 만 센다(다른 가게 9000 이 섞이면 10000 이 된다).
    expect(result.data?.stats.totalScDistributed).toBe(1000)
    expect(result.data?.stats.totalScSettled).toBe(500)
    expect(result.data?.stats.activeWorkspacesCount).toBe(1)
  })

  it('workspace 이름 조회는 원장에 등장한 workspace 로만 한정한다(전체 스캔 금지)', async () => {
    const asked: string[][] = []
    const gateway: RevenueGateway = {
      fetchRecentLedger: async () => ({ data: [ledgerRow('a1', A, 100)], error: null }),
      fetchWorkspaces: async (ids) => {
        asked.push([...ids])
        return { data: [{ id: A, name: '가게 A' }], error: null }
      },
    }

    await getOperatorRevenueData({ gateway })
    expect(asked).toEqual([[A]])
  })

  it('workspace 를 지정하지 않으면 전체 원장을 그대로 집계한다(필터는 요청이 있을 때만)', async () => {
    const gateway: RevenueGateway = {
      fetchRecentLedger: async () => ({ data: [ledgerRow('a1', A, 100), ledgerRow('b1', B, 100)], error: null }),
      fetchWorkspaces: async (ids) => ({ data: ids.map((id) => ({ id, name: null })), error: null }),
    }
    const unscoped = await getOperatorRevenueData({ gateway })
    expect(unscoped.error).toBeNull()
    expect(unscoped.data?.ledger).toHaveLength(2)
  })

  it('원장 조회 실패는 빈 데이터가 아니라 error 로 온다', async () => {
    const failing: RevenueGateway = {
      fetchRecentLedger: async () => ({ data: null, error: new Error('denied') }),
      fetchWorkspaces: async () => ({ data: [], error: null }),
    }
    const failed = await getOperatorRevenueData({ gateway: failing, workspaceId: A })
    expect(failed.data).toBeNull()
    expect(failed.error).toBe('CREDIT_LEDGER_READ_FAILED')
  })
})

const connectionRow = (workspaceId: string) => ({
  workspace_id: workspaceId,
  workspace_name: '가게',
  channel: 'instagram',
  account_label: '@safe-label',
  connection_status: 'connected',
  delegation_status: 'unknown',
  technical_permission_status: 'ready',
  token_expires_at: null,
  webhook_status: 'healthy',
  last_webhook_at: null,
  last_provider_event_at: null,
  last_error_code: null,
  updated_at: '2026-10-23T00:00:00.000Z',
  freshness: 'fresh',
})

const browserRow = (workspaceId: string, id: string) => ({
  id,
  workspaceId,
  workspaceName: '가게',
  channel: 'naver_blog',
  accountLabel: 'naver_blog_id',
  status: 'connected',
  lastSeenAt: '2026-10-23T00:00:00.000Z',
  updatedAt: '2026-10-23T00:00:00.000Z',
  clientVersion: '1.2.0',
})

describe('채널 읽기 모델 workspace 경계', () => {
  it('브라우저 확장 연결 조회에는 요청한 workspace 가 그대로 전달된다', async () => {
    const rpc: OperatorChannelRpcGateway = { rpc: vi.fn(async () => ({ data: { items: [] }, error: null })) }
    const listBrowserConnections = vi.fn(async () => ({ data: [], error: null }))

    await listOperatorChannelConnections(
      { workspaceId: A, channel: 'naver_blog' },
      { gateway: rpc, browserGateway: { listBrowserConnections }, now: () => 1_777_000_000_000 },
    )

    expect(listBrowserConnections).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: A, channel: 'naver_blog' }))
  })

  it('admin 경로가 다른 workspace 행을 돌려줘도 결과에 섞이지 않는다', async () => {
    const rpc: OperatorChannelRpcGateway = { rpc: vi.fn(async () => ({ data: { items: [] }, error: null })) }
    // admin 키 조회는 RLS 를 지나지 않으므로 필터가 새는 경우를 가정한다.
    const browserGateway = {
      listBrowserConnections: vi.fn(async () => ({
        data: [browserRow(A, 'conn-a'), browserRow(B, 'conn-b')],
        error: null,
      })),
    }

    const result = await listOperatorChannelConnections(
      { workspaceId: A, channel: 'naver_blog' },
      { gateway: rpc, browserGateway, now: () => 1_777_000_000_000 },
    )

    // 경계 위반은 '빈 목록'이 아니라 조회 불가로 끝난다(가짜 empty 금지).
    expect(result.error).toBe('CHANNEL_LIST_UNAVAILABLE')
    expect(result.data).toBeNull()
    expect(result.sourceState).toBe('unavailable')
  })

  it('RPC 결과가 요청 밖 workspace 를 담아 오면 빈 목록으로 숨기지 않고 실패로 끝난다', async () => {
    const rpc: OperatorChannelRpcGateway = {
      rpc: vi.fn(async () => ({ data: { items: [connectionRow(B)] }, error: null })),
    }
    const result = await listOperatorChannelConnections(
      { workspaceId: A },
      { gateway: rpc, browserGateway: { listBrowserConnections: async () => ({ data: [], error: null }) } },
    )

    expect(result.error).toBe('CHANNEL_LIST_UNAVAILABLE')
    expect(result.data).toBeNull()
  })

  it('workspace 를 지정하지 않은 운영자 전체 조회는 여러 workspace 행을 그대로 보여준다', async () => {
    const rpc: OperatorChannelRpcGateway = {
      rpc: vi.fn(async () => ({ data: { items: [connectionRow(A), connectionRow(B)] }, error: null })),
    }
    const result = await listOperatorChannelConnections(
      {},
      { gateway: rpc, browserGateway: { listBrowserConnections: async () => ({ data: [], error: null }) } },
    )

    expect(result.error).toBeNull()
    expect(result.data?.map((c) => c.workspaceId).sort()).toEqual([A, B])
  })
})
