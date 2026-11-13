import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listOperatorChannelConnections, type OperatorChannelRpcGateway } from './repository'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const row = {
  workspace_id: workspaceId, workspace_name: 'Workspace A', channel: 'instagram', account_label: '@safe-label',
  connection_status: 'connected', delegation_status: 'unknown', technical_permission_status: 'ready',
  token_expires_at: null, webhook_status: 'healthy', last_webhook_at: null, last_provider_event_at: null,
  last_error_code: null, updated_at: '2026-08-23T00:00:00.000Z', freshness: 'fresh',
}
function gateway(data: unknown = { items: [row] }): OperatorChannelRpcGateway {
  return { rpc: vi.fn(async () => ({ data, error: null })) }
}

describe('operator channel read repository', () => {
  it('calls only the scoped safe RPC contract', async () => {
    const read = gateway()
    const result = await listOperatorChannelConnections({ workspaceId }, { gateway: read, now: () => 1_777_000_000_000 })
    expect(result.error).toBeNull()
    expect(read.rpc).toHaveBeenCalledWith('list_operator_channel_connections_v2', {
      p_workspace_id: workspaceId, p_channel: null, p_connection_status: null, p_delegation_status: null, p_risk: null, p_limit: 100,
    })
    expect(result.data?.[0]).toMatchObject({ workspaceId, accountLabel: '@safe-label' })
    expect(result.referenceTime).toBe(1_777_000_000_000)
  })

  it('fails closed when the projection contains forbidden identifiers or unknown channels', async () => {
    const forbidden = gateway({ items: [{ ...row, external_account_id: 'raw-id' }] })
    await expect(listOperatorChannelConnections({}, { gateway: forbidden })).resolves.toEqual({ data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' })
    const unknown = gateway({ items: [{ ...row, channel: 'tiktok' }] })
    await expect(listOperatorChannelConnections({}, { gateway: unknown })).resolves.toEqual({ data: null, sourceState: 'unavailable', error: 'CHANNEL_LIST_UNAVAILABLE' })
  })
  it('preserves explicit empty source state from the versioned wrapper', async () => {
    const result = await listOperatorChannelConnections({}, { gateway: gateway({ source_state: 'empty', items: [] }) })
    expect(result).toMatchObject({ data: [], sourceState: 'empty', error: null })
  })
  it('merges naver_blog browser connections with RPC connections', async () => {
    const read = gateway()
    const browserMock = {
      listBrowserConnections: vi.fn(async () => ({
        data: [{
          id: '22222222-2222-4222-8222-222222222222',
          workspaceId,
          workspaceName: 'Workspace A',
          channel: 'naver_blog',
          accountLabel: 'naver_my_blog',
          status: 'connected',
          lastSeenAt: '2026-10-09T00:00:00.000Z',
          updatedAt: '2026-10-09T00:00:00.000Z',
          clientVersion: '1.2.0',
        }],
        error: null,
      })),
    }

    const result = await listOperatorChannelConnections(
      {},
      { gateway: read, browserGateway: browserMock, now: () => 1_777_000_000_000 },
    )
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(2)
    const naver = result.data?.find((d) => d.channel === 'naver_blog')
    expect(naver).toBeDefined()
    expect(naver).toMatchObject({
      channel: 'naver_blog',
      accountLabel: 'naver_my_blog',
      connectionStatus: 'connected',
      connectorType: 'browser_extension',
      extensionVersion: '1.2.0',
    })
  })
  it('queries only browser connections when channel is naver_blog', async () => {
    const read = gateway()
    const browserMock = {
      listBrowserConnections: vi.fn(async () => ({
        data: [{
          id: '22222222-2222-4222-8222-222222222222',
          workspaceId,
          workspaceName: 'Workspace A',
          channel: 'naver_blog',
          accountLabel: 'naver_my_blog',
          status: 'connected',
          lastSeenAt: '2026-10-09T00:00:00.000Z',
          updatedAt: '2026-10-09T00:00:00.000Z',
          clientVersion: '1.2.0',
        }],
        error: null,
      })),
    }

    const result = await listOperatorChannelConnections(
      { channel: 'naver_blog' },
      { gateway: read, browserGateway: browserMock, now: () => 1_777_000_000_000 },
    )
    expect(result.error).toBeNull()
    expect(read.rpc).not.toHaveBeenCalled()
    expect(browserMock.listBrowserConnections).toHaveBeenCalledWith({
      workspaceId: undefined,
      channel: 'naver_blog',
      limit: 100,
    })
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0].channel).toBe('naver_blog')
  })
})
