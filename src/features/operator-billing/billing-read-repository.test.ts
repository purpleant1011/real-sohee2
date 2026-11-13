import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorBillingOverview, listOperatorBillingOverviewForFormalMembers } from './billing-read-repository'

const workspaceId = '90000000-0000-4000-8000-000000000001'
const workspaceId2 = '90000000-0000-4000-8000-000000000002'

const validBillingItem = (id: string, name: string) => ({
  workspace_id: id,
  workspace_name: name,
  entitlement: { state: 'fresh' as const, plan_code: 'growth', policy_version: null, weekly_limit: null, effective_from: null, effective_until: null, source_timestamp: null },
  balance: { state: 'fresh' as const, version: 1, period_start: null, period_end: null, granted: null, adjustments: null, released: null, consumed: null, reserved: null, available: 100, source_timestamp: null },
  payment: { state: 'fresh' as const, latest_state: 'provider_succeeded' as const, provider_reference_present: true, updated_at: null },
  usage: { state: 'fresh' as const, usage_event_count: null, computed_credits: null, actual_usage_count: null, estimated_usage_count: null, source_timestamp: null },
  cost: { state: 'unknown' as const, api_cost_krw: null, reason: 'NOT_MEASURED' as const },
  freshness: { state: 'fresh' as const, source_timestamp: null },
})

describe('listOperatorBillingOverview', () => {
  it('calls only the operator billing read RPC and preserves unknown values', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        items: [{
          workspace_id: workspaceId,
          workspace_name: '테스트 고객사',
          entitlement: { state: 'unknown', plan_code: null, policy_version: null, weekly_limit: null, effective_from: null, effective_until: null, source_timestamp: null },
          balance: { state: 'empty', version: 3, period_start: null, period_end: null, granted: null, adjustments: null, released: null, consumed: null, reserved: null, available: null, source_timestamp: null },
          payment: { state: 'empty', latest_state: null, provider_reference_present: false, updated_at: null },
          usage: { state: 'empty', usage_event_count: null, computed_credits: null, actual_usage_count: null, estimated_usage_count: null, source_timestamp: null },
          cost: { state: 'unknown', api_cost_krw: null, reason: 'NOT_MEASURED' },
          freshness: { state: 'unknown', source_timestamp: null },
        }],
        summary: { state: 'fresh', workspace_count: 1, source_timestamp: '2026-08-23T03:00:00.000Z' },
      }, error: null,
    }))
    const result = await listOperatorBillingOverview({}, { gateway: { rpc } })
    expect(result.error).toBeNull()
    expect(result.data?.items[0].balance.available).toBeNull()
    expect(rpc).toHaveBeenCalledWith('list_operator_billing_overview', { p_workspace_id: null, p_limit: 100 })
  })

  it('rejects malformed wire data and never returns a fake zero balance', async () => {
    const result = await listOperatorBillingOverview({}, { gateway: { rpc: async () => ({ data: { items: [{ workspace_id: workspaceId, balance: { available: 0 } }], summary: {} }, error: null }) } })
    expect(result).toEqual({ data: null, error: 'BILLING_READ_UNAVAILABLE' })
  })
})

describe('listOperatorBillingOverviewForFormalMembers', () => {
  it('fetches formal member ids and merges individual workspace billing results', async () => {
    const adminRpc = vi.fn(async () => ({
      data: [
        { workspace_id: workspaceId, is_formal: true },
        { workspace_id: workspaceId2, is_formal: true },
        { workspace_id: '90000000-0000-4000-8000-000000000003', is_formal: false },
      ],
      error: null,
    }))
    const rpc = vi.fn(async (name: string, args: { p_workspace_id: string | null }) => {
      const id = args.p_workspace_id!
      return {
        data: {
          items: [validBillingItem(id, id === workspaceId ? '고객사 1' : '고객사 2')],
          summary: { state: id === workspaceId ? 'fresh' : 'stale', workspace_count: 1, source_timestamp: '2026-08-23T03:00:00.000Z' },
        },
        error: null,
      }
    })

    const result = await listOperatorBillingOverviewForFormalMembers({
      adminClient: { rpc: adminRpc },
      gateway: { rpc },
    })

    expect(result.error).toBeNull()
    expect(result.data?.items).toHaveLength(2)
    expect(result.data?.items[0].workspace_id).toBe(workspaceId)
    expect(result.data?.items[0].isFormal).toBe(true)
    expect(result.data?.items[1].workspace_id).toBe(workspaceId2)
    expect(result.data?.items[1].isFormal).toBe(true)
    // worst state between 'fresh' and 'stale' is 'stale'
    expect(result.data?.summary.state).toBe('stale')
    expect(result.data?.applicantCount).toBe(1)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('returns an empty list when there are zero formal members', async () => {
    const adminRpc = vi.fn(async () => ({
      data: [
        { workspace_id: workspaceId, is_formal: false },
      ],
      error: null,
    }))
    const rpc = vi.fn()

    const result = await listOperatorBillingOverviewForFormalMembers({
      adminClient: { rpc: adminRpc },
      gateway: { rpc },
    })

    expect(result.error).toBeNull()
    expect(result.data?.items).toHaveLength(0)
    expect(result.data?.summary.state).toBe('empty')
    expect(result.data?.summary.workspaceCount).toBe(0)
    expect(result.data?.applicantCount).toBe(1)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed when any individual workspace billing RPC call fails', async () => {
    const adminRpc = vi.fn(async () => ({
      data: [{ workspace_id: workspaceId, is_formal: true }],
      error: null,
    }))
    const rpc = vi.fn(async () => ({
      data: null,
      error: new Error('MFA_REQUIRED'),
    }))

    const result = await listOperatorBillingOverviewForFormalMembers({
      adminClient: { rpc: adminRpc },
      gateway: { rpc },
    })

    expect(result.data).toBeNull()
    expect(result.error).toBe('MFA_REQUIRED')
  })

  it('fails closed when membership overview call fails', async () => {
    const adminRpc = vi.fn(async () => ({
      data: null,
      error: new Error('PERMISSION_DENIED'),
    }))
    const rpc = vi.fn()

    const result = await listOperatorBillingOverviewForFormalMembers({
      adminClient: { rpc: adminRpc },
      gateway: { rpc },
    })

    expect(result.data).toBeNull()
    expect(result.error).toBe('BILLING_READ_UNAVAILABLE')
    expect(rpc).not.toHaveBeenCalled()
  })
})
