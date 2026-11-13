import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  decodeWorkspaceCursor,
  getOperatorWorkspace,
  listOperatorWorkspaces,
  type OperatorWorkspaceRpcGateway,
} from './repository'

const workspaceA = '11111111-1111-4111-8111-111111111111'
const createdAt = '2026-08-23T00:00:00.000Z'

function item(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: workspaceA,
    workspace_name: 'Workspace A',
    timezone: 'Asia/Seoul',
    created_at: createdAt,
    updated_at: createdAt,
    workspace_kind: 'production',
    business_name: 'Business A',
    lifecycle_status: 'active',
    agreement_status: 'accepted',
    plan_code: 'growth',
    member_count: 1,
    available_credits: 1800,
    instagram_status: 'unknown',
    threads_status: 'unknown',
    published_this_month: 3,
    failed_this_month: 1,
    last_activity_at: createdAt,
    data_freshness: 'unknown',
    source_timestamps: {
      workspace: createdAt,
      business: createdAt,
      instagram: createdAt,
      threads: createdAt,
      publish: null,
    },
    ...overrides,
  }
}

function gateway(response: unknown = { items: [item()], next_cursor: null }): OperatorWorkspaceRpcGateway {
  return {
    rpc: vi.fn(async () => ({ data: response, error: null })),
  }
}

describe('operator workspace RPC repository', () => {
  it('rejects invalid limits before calling the RPC', async () => {
    const readGateway = gateway()

    const result = await listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 0 }, {
      gateway: readGateway,
    })

    expect(result).toEqual({ data: null, error: 'WORKSPACE_INPUT_INVALID' })
    expect(readGateway.rpc).not.toHaveBeenCalled()
  })

  it('calls only the exact list RPC contract without passing permission scopes or workspace IDs', async () => {
    const readGateway = gateway()

    const result = await listOperatorWorkspaces({ cursor: null, query: '  cafe  ', status: null, limit: 50 }, {
      gateway: readGateway,
    })

    expect(result.error).toBeNull()
    expect(readGateway.rpc).toHaveBeenCalledWith('list_operator_workspaces', {
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_cursor_fingerprint: null,
      p_query: 'cafe',
      p_status: null,
      p_limit: 50,
      p_member_filter: null,
    })
    expect(JSON.stringify(vi.mocked(readGateway.rpc).mock.calls)).not.toContain('permissionScopes')
    expect(JSON.stringify(vi.mocked(readGateway.rpc).mock.calls)).not.toContain('workspaceIds')
    expect(result.data?.items[0]?.workspaceId).toBe(workspaceA)
    expect(result.data?.items[0]?.workspaceKind).toBe('production')
    expect(result.data?.items[0]?.publishedThisMonth).toBe(3)
    expect(result.data?.items[0]?.agreementStatus).toBe('accepted')
    expect(result.data?.items[0]?.memberCount).toBe(1)
    expect(result.data?.items[0]?.availableCredits).toBe(1800)
    expect(result.data?.items[0]?.memberStatus).toBe('APPLICANT')
  })

  it('preserves the RPC next cursor as a client opaque cursor with filter binding', async () => {
    const readGateway = gateway({
      items: [item({ member_status: 'FORMAL' })],
      next_cursor: { created_at: createdAt, id: workspaceA, cursor_fingerprint: 'a'.repeat(64) },
    })

    const result = await listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 2 }, {
      gateway: readGateway,
    })

    expect(result.error).toBeNull()
    expect(result.data?.nextCursor).toEqual(expect.any(String))
    expect(result.data?.items[0]?.memberStatus).toBe('FORMAL')
    expect(decodeWorkspaceCursor(result.data!.nextCursor!)).toEqual({
      created_at: createdAt,
      id: workspaceA,
      cursor_fingerprint: 'a'.repeat(64),
      query: null,
      status: null,
      member: null,
    })
  })

  it('passes member filter to the RPC and binds it to the cursor', async () => {
    const readGateway = gateway({
      items: [item({ member_status: 'FORMAL' })],
      next_cursor: { created_at: createdAt, id: workspaceA, cursor_fingerprint: 'a'.repeat(64) },
    })

    const result = await listOperatorWorkspaces({ cursor: null, query: null, status: null, member: 'formal', limit: 10 }, {
      gateway: readGateway,
    })

    expect(result.error).toBeNull()
    expect(readGateway.rpc).toHaveBeenCalledWith('list_operator_workspaces', expect.objectContaining({
      p_member_filter: 'formal',
      p_limit: 10,
    }))
    expect(decodeWorkspaceCursor(result.data!.nextCursor!)).toEqual(expect.objectContaining({
      member: 'formal',
    }))
  })

  it('rejects a cursor whose query binding does not match before calling the RPC', async () => {
    const readGateway = gateway()
    const cursor = Buffer.from(JSON.stringify({
      created_at: createdAt,
      id: workspaceA,
      cursor_fingerprint: 'a'.repeat(64),
      query: 'other',
      status: null,
    }), 'utf8').toString('base64url')

    const result = await listOperatorWorkspaces({ cursor, query: 'cafe', status: null, limit: 50 }, {
      gateway: readGateway,
    })

    expect(result).toEqual({ data: null, error: 'CURSOR_INVALID' })
    expect(readGateway.rpc).not.toHaveBeenCalled()
  })

  it('normalizes query whitespace once for cursor binding and the RPC', async () => {
    const readGateway = gateway({
      items: [item()],
      next_cursor: { created_at: createdAt, id: workspaceA, cursor_fingerprint: 'a'.repeat(64) },
    })
    const first = await listOperatorWorkspaces({ cursor: null, query: ' cafe ', status: null, limit: 50 }, { gateway: readGateway })
    const second = await listOperatorWorkspaces({ cursor: first.data?.nextCursor ?? null, query: 'cafe', status: null, limit: 50 }, { gateway: readGateway })
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(vi.mocked(readGateway.rpc)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(readGateway.rpc).mock.calls[1]?.[1]).toMatchObject({ p_query: 'cafe' })
  })

  it('rejects an oversized query before the RPC', async () => {
    const readGateway = gateway()
    await expect(listOperatorWorkspaces({ cursor: null, query: 'x'.repeat(121), status: null, limit: 50 }, { gateway: readGateway }))
      .resolves.toEqual({ data: null, error: 'WORKSPACE_INPUT_INVALID' })
    expect(readGateway.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on a malformed or forbidden projection', async () => {
    const readGateway = gateway({
      items: [item({ external_account_id: 'forbidden' })],
      next_cursor: null,
    })

    await expect(listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 50 }, {
      gateway: readGateway,
    })).resolves.toEqual({ data: null, error: 'WORKSPACE_LIST_UNAVAILABLE' })
  })

  it('derives stale and unknown freshness from injected source timestamps', async () => {
    const staleGateway = gateway({ items: [item({ source_timestamps: {
      workspace: '2026-08-20T00:00:00.000Z', business: createdAt, instagram: createdAt, threads: createdAt, publish: null,
    } })], next_cursor: null })
    const stale = await listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 50 }, {
      gateway: staleGateway,
      now: new Date('2026-08-23T12:00:00.000Z'),
    })
    expect(stale.data?.items[0]?.dataFreshness).toBe('stale')

    const futureGateway = gateway({ items: [item({ source_timestamps: {
      workspace: '2026-08-24T00:00:00.000Z', business: createdAt, instagram: createdAt, threads: createdAt, publish: null,
    } })], next_cursor: null })
    const future = await listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 50 }, {
      gateway: futureGateway,
      now: new Date('2026-08-23T12:00:00.000Z'),
    })
    expect(future.data?.items[0]?.dataFreshness).toBe('unknown')
  })

  it('calls the explicit detail RPC and maps its safe snake_case projection', async () => {
    const readGateway: OperatorWorkspaceRpcGateway = {
      rpc: vi.fn(async () => ({
        data: {
          ...item(),
          member_aggregates: [{ role: 'owner', status: 'active', count: 1, created_at: createdAt, updated_at: createdAt }],
          channels: [],
        },
        error: null,
      })),
    }

    const result = await getOperatorWorkspace(workspaceA, { gateway: readGateway })

    expect(readGateway.rpc).toHaveBeenCalledWith('get_operator_workspace_detail', { p_workspace_id: workspaceA })
    expect(result.error).toBeNull()
    expect(result.data?.workspaceId).toBe(workspaceA)
    expect(result.data?.lifecycleStatus).toBe('active')
    expect(result.data?.agreementStatus).toBe('accepted')
    expect(result.data?.memberAggregates).toHaveLength(1)
  })

  it('fails closed when detail root or channel workspace identity differs', async () => {
    const readGateway = gateway()
    const rootMismatch: OperatorWorkspaceRpcGateway = {
      rpc: vi.fn(async () => ({ data: {
        ...item({ workspace_id: '22222222-2222-4222-8222-222222222222' }), member_aggregates: [], channels: [],
      }, error: null })),
    }
    await expect(getOperatorWorkspace(workspaceA, { gateway: rootMismatch })).resolves.toEqual({ data: null, error: 'WORKSPACE_DETAIL_UNAVAILABLE' })
    expect(readGateway.rpc).not.toHaveBeenCalled()

    const channelMismatch: OperatorWorkspaceRpcGateway = {
      rpc: vi.fn(async () => ({ data: {
        ...item(), member_aggregates: [], channels: [{
          workspace_id: '22222222-2222-4222-8222-222222222222', channel: 'instagram', status: 'unknown', webhook_status: 'unknown', token_expires_at: null, last_webhook_at: null, last_provider_event_at: null, last_error_code: null, updated_at: createdAt,
        }],
      }, error: null })),
    }
    await expect(getOperatorWorkspace(workspaceA, { gateway: channelMismatch })).resolves.toEqual({ data: null, error: 'WORKSPACE_DETAIL_UNAVAILABLE' })
  })

  it('maps unexpected RPC failures to the safe list error', async () => {
    const readGateway: OperatorWorkspaceRpcGateway = {
      rpc: vi.fn(async () => ({ data: null, error: new Error('raw database detail') })),
    }

    await expect(listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 50 }, {
      gateway: readGateway,
    })).resolves.toEqual({ data: null, error: 'WORKSPACE_LIST_UNAVAILABLE' })
  })

  it('maps a plain Postgrest-style error object with an exact safe code', async () => {
    const readGateway: OperatorWorkspaceRpcGateway = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'CURSOR_INVALID', details: 'hidden' } })),
    }
    await expect(listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 50 }, { gateway: readGateway }))
      .resolves.toEqual({ data: null, error: 'CURSOR_INVALID' })
  })

  it('passes a validated lifecycle status filter and binds it to the cursor', async () => {
    const readGateway = gateway({ items: [item()], next_cursor: { created_at: createdAt, id: workspaceA, cursor_fingerprint: 'b'.repeat(64) } })
    const first = await listOperatorWorkspaces({ cursor: null, query: null, status: 'active', limit: 50 }, { gateway: readGateway })
    expect(first.error).toBeNull()
    expect(vi.mocked(readGateway.rpc)).toHaveBeenCalledWith('list_operator_workspaces', expect.objectContaining({ p_status: 'active' }))
    expect(decodeWorkspaceCursor(first.data!.nextCursor!)).toMatchObject({ status: 'active' })
  })
})
