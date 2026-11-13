import { describe, expect, it } from 'vitest'
import { loadConnectorHubSnapshot, disconnectMarketingConnector, type MarketingConnectorGateway } from './connection-service'

const workspaceId = 'workspace-a'
const channel = { id: 'connection-a', workspace_id: workspaceId, channel: 'instagram', status: 'connected', updated_at: '2026-11-10T00:00:00Z' }
const credential = { workspace_id: workspaceId, channel_connection_id: channel.id, provider: 'instagram', status: 'active', granted_scopes: ['instagram_business_basic', 'instagram_business_manage_messages'], token_expires_at: '2099-01-01T00:00:00Z' }
function gateway(overrides: Partial<MarketingConnectorGateway> = {}): MarketingConnectorGateway {
  return {
    getMarketingConnections: async () => ({ data: [], error: null }),
    getChannelConnections: async () => ({ data: [channel], error: null }),
    getMetaCredentials: async () => ({ data: [credential], error: null }),
    checkWorkspaceRole: async () => ({ ok: true, role: 'owner' }),
    disconnectConnectorRpc: async () => ({ data: { connector_id: 'google_calendar', consent_generation: 2, status: 'revoked', pending_deletion: true }, error: null }),
    ...overrides,
  }
}

describe('connection projection runtime truth boundary', () => {
  it('does not turn unrelated database not-found text into a missing connector', async () => {
    await expect(disconnectMarketingConnector({ workspaceId, connectorId: 'google_calendar', actorUserId: 'owner-a' }, gateway({ disconnectConnectorRpc: async () => ({ data: null, error: { code: 'XX000', message: 'Internal relation not found' } }) }))).rejects.toMatchObject({ status: 500 })
  })
  it('accepts a completed deletion receipt without fabricating a pending deletion', async () => {
    const result = await disconnectMarketingConnector({ workspaceId, connectorId: 'google_calendar', actorUserId: 'owner-a' }, gateway({ disconnectConnectorRpc: async () => ({ data: { connector_id: 'google_calendar', consent_generation: 2, status: 'revoked', pending_deletion: false }, error: null }) }))
    expect(result.pendingDeletion).toBe(false)
  })
  it('does not keep active capabilities on a revoked productivity connection', async () => {
    const state = await loadConnectorHubSnapshot(workspaceId, gateway({ getMarketingConnections: async () => ({ data: [{ workspace_id: workspaceId, connector_id: 'google_calendar', status: 'revoked', capabilities: ['calendar_read'] }], error: null }) }))
    expect(state.connections.find(c => c.connectorId === 'google_calendar')?.capabilities).toEqual([])
  })
  it('requires an active credential before showing a saved social account as usable', async () => {
    const state = await loadConnectorHubSnapshot(workspaceId, gateway({ getMetaCredentials: async () => ({ data: [], error: null }) }))
    expect(state.connections.find(c => c.connectorId === 'instagram')?.status).toBe('reauth_required')
  })
  it('does not trust privileged credential metadata without a tenant stamp', async () => {
    const { workspace_id: _ignored, ...unstamped } = credential
    void _ignored
    await expect(loadConnectorHubSnapshot(workspaceId, gateway({ getMetaCredentials: async () => ({ data: [unstamped] as unknown as Awaited<ReturnType<MarketingConnectorGateway['getMetaCredentials']>>['data'], error: null }) }))).rejects.toThrow()
  })
  it('maps a never-connected deletion to not found instead of success or internal error', async () => {
    await expect(disconnectMarketingConnector({ workspaceId, connectorId: 'google_calendar', actorUserId: 'owner-a' }, gateway({ disconnectConnectorRpc: async () => ({ data: null, error: { code: 'P0002', message: 'CONNECTOR_NOT_FOUND' } }) }))).rejects.toMatchObject({ status: 404 })
  })
  it('does not turn a channel database failure into a disconnected account', async () => {
    await expect(loadConnectorHubSnapshot(workspaceId, gateway({ getChannelConnections: async () => ({ data: null, error: { message: 'unavailable' } }) }))).rejects.toThrow()
  })
  it('does not silently ignore a credential query failure', async () => {
    await expect(loadConnectorHubSnapshot(workspaceId, gateway({ getMetaCredentials: async () => ({ data: null, error: { message: 'unavailable' } }) }))).rejects.toThrow()
  })
  it('derives DM capability from the existing Instagram business scope contract', async () => {
    const state = await loadConnectorHubSnapshot(workspaceId, gateway())
    expect(state.connections.find(c => c.connectorId === 'instagram_messages')?.capabilities).toContain('direct_messages')
  })
  it('does not claim a channel update is an information synchronization', async () => {
    const state = await loadConnectorHubSnapshot(workspaceId, gateway())
    expect(state.connections.find(c => c.connectorId === 'instagram')?.lastSyncAt).toBeNull()
  })
  it('does not invent feed read or publish permission when credentials are missing', async () => {
    const state = await loadConnectorHubSnapshot(workspaceId, gateway({ getMetaCredentials: async () => ({ data: [], error: null }) }))
    expect(state.connections.find(c => c.connectorId === 'instagram')?.capabilities).toEqual([])
  })
  it('treats the missing new PostgREST table as storage not ready', async () => {
    const state = await loadConnectorHubSnapshot(workspaceId, gateway({ getMarketingConnections: async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.marketing_connector_connections' in the schema cache" } }) }))
    expect(state.storageReady).toBe(false)
  })
  it('rejects a disconnect receipt for another provider', async () => {
    await expect(disconnectMarketingConnector({ workspaceId, connectorId: 'google_calendar', actorUserId: 'owner-a' }, gateway({ disconnectConnectorRpc: async () => ({ data: { connector_id: 'gmail', consent_generation: 2, status: 'revoked', pending_deletion: true }, error: null }) }))).rejects.toThrow()
  })
  it('does not put raw database details in the user-facing error', async () => {
    try {
      await loadConnectorHubSnapshot(workspaceId, gateway({ getMarketingConnections: async () => ({ data: null, error: { code: 'XX000', message: 'PRIVATE_PROVIDER_VALUE' } }) }))
      throw new Error('Expected query failure')
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE_PROVIDER_VALUE')
    }
  })
})
