import { describe, expect, it, vi } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  disconnectMarketingConnector,
  loadConnectorHubSnapshot,
  type MarketingConnectorGateway,
} from './connection-service';

function createMockGateway(overrides: Partial<MarketingConnectorGateway> = {}): MarketingConnectorGateway {
  return {
    getMarketingConnections: vi.fn().mockResolvedValue({ data: [], error: null }),
    getChannelConnections: vi.fn().mockResolvedValue({ data: [], error: null }),
    getMetaCredentials: vi.fn().mockResolvedValue({ data: [], error: null }),
    disconnectConnectorRpc: vi.fn().mockResolvedValue({
      data: {
        connector_id: 'gmail',
        consent_generation: 2,
        status: 'revoked',
        pending_deletion: true,
      },
      error: null,
    }),
    checkWorkspaceRole: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
    ...overrides,
  };
}

describe('connection-service: loadConnectorHubSnapshot', () => {
  it('returns all 11 catalog connectors with correct workspace scope and storageReady true', async () => {
    const gateway = createMockGateway({
      getMarketingConnections: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: 'ws-test-1',
            connector_id: 'google_calendar',
            status: 'connected',
            last_sync_at: '2026-11-10T09:00:00Z',
            capabilities: ['read_calendar'],
          },
        ],
        error: null,
      }),
    });

    const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);

    expect(snapshot.workspaceId).toBe('ws-test-1');
    expect(snapshot.storageReady).toBe(true);
    expect(snapshot.connections).toHaveLength(11);

    const googleCal = snapshot.connections.find((c) => c.connectorId === 'google_calendar');
    expect(googleCal).toBeDefined();
    expect(googleCal?.status).toBe('connected');
    expect(googleCal?.capabilities).toEqual(['read_calendar']);

    const gmail = snapshot.connections.find((c) => c.connectorId === 'gmail');
    expect(gmail?.status).toBe('disconnected');
    expect(gmail?.capabilities).toEqual([]);
  });

  it('sets storageReady false when new marketing connector table is missing (42P01)', async () => {
    const gateway = createMockGateway({
      getMarketingConnections: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '42P01',
          message: 'relation "marketing_connector_connections" does not exist',
        },
      }),
    });

    const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);

    expect(snapshot.storageReady).toBe(false);
    expect(snapshot.connections).toHaveLength(11);
  });

  it('fails closed and throws on other database errors (not 42P01)', async () => {
    const gateway = createMockGateway({
      getMarketingConnections: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '08006',
          message: 'connection failure',
        },
      }),
    });

    await expect(loadConnectorHubSnapshot('ws-test-1', gateway)).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
    });
  });

  it('proves social capabilities from actual credentials and never claims DM capability without instagram_business_manage_messages', async () => {
    const gateway = createMockGateway({
      getChannelConnections: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'conn-ig-1',
            workspace_id: 'ws-test-1',
            channel: 'instagram',
            status: 'connected',
            updated_at: '2026-11-10T10:00:00Z',
          },
          {
            id: 'conn-th-1',
            workspace_id: 'ws-test-1',
            channel: 'threads',
            status: 'connected',
            updated_at: '2026-11-10T10:05:00Z',
          },
        ],
        error: null,
      }),
      getMetaCredentials: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: 'ws-test-1',
            channel_connection_id: 'conn-ig-1',
            provider: 'instagram',
            status: 'active',
            granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
            token_expires_at: '2026-12-01T00:00:00Z',
          },
          {
            workspace_id: 'ws-test-1',
            channel_connection_id: 'conn-th-1',
            provider: 'threads',
            status: 'active',
            granted_scopes: ['threads_basic', 'threads_content_publish'],
            token_expires_at: '2026-12-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    });

    const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);

    const instagram = snapshot.connections.find((c) => c.connectorId === 'instagram');
    expect(instagram?.status).toBe('connected');

    const threads = snapshot.connections.find((c) => c.connectorId === 'threads');
    expect(threads?.status).toBe('connected');

    const instagramMessages = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');
    // Guardrail: without instagram_business_manage_messages scope, instagram_messages cannot be connected or claim DM capability!
    expect(instagramMessages?.status).not.toBe('connected');
    expect(instagramMessages?.capabilities).not.toContain('direct_messages');
    expect(instagramMessages?.capabilities).not.toContain('instagram_business_manage_messages');
  });

  it('enables instagram_messages as connected when instagram_business_manage_messages scope is present and verified', async () => {
    const gateway = createMockGateway({
      getChannelConnections: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'conn-ig-2',
            workspace_id: 'ws-test-1',
            channel: 'instagram',
            status: 'connected',
            updated_at: '2026-11-10T10:00:00Z',
          },
        ],
        error: null,
      }),
      getMetaCredentials: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: 'ws-test-1',
            channel_connection_id: 'conn-ig-2',
            provider: 'instagram',
            status: 'active',
            granted_scopes: [
              'instagram_business_basic',
              'instagram_business_manage_messages',
            ],
            token_expires_at: '2026-12-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    });

    const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
    const instagramMessages = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

    expect(instagramMessages?.status).toBe('connected');
    expect(instagramMessages?.capabilities).toContain('direct_messages');
  });

  it('rejects cross-tenant credentials if returned from gateway', async () => {
    const gateway = createMockGateway({
      getChannelConnections: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'conn-ig-other',
            workspace_id: 'ws-test-1',
            channel: 'instagram',
            status: 'connected',
            updated_at: '2026-11-10T10:00:00Z',
          },
        ],
        error: null,
      }),
      getMetaCredentials: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: 'ws-other-tenant', // Different workspace!
            channel_connection_id: 'conn-ig-other',
            provider: 'instagram',
            status: 'active',
            granted_scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
            token_expires_at: '2026-12-01T00:00:00Z',
          },
        ],
        error: null,
      }),
    });

    const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
    const instagram = snapshot.connections.find((c) => c.connectorId === 'instagram');
    // Must not use credentials from another workspace
    expect(instagram?.capabilities).toEqual([]);
  });

  it('guarantees DTO excludes tokens, secrets, and credentials fields', async () => {
    const gateway = createMockGateway({
      getMarketingConnections: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: 'ws-test-1',
            connector_id: 'gmail',
            status: 'connected',
            last_sync_at: '2026-11-10T09:00:00Z',
            capabilities: ['read_mail'],
            encrypted_credential_ref: 'vault://ref-123',
            access_token: 'secret-token-do-not-leak',
          },
        ],
        error: null,
      }),
    });

    const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
    const rawDtoJson = JSON.stringify(snapshot);

    expect(rawDtoJson).not.toContain('secret-token-do-not-leak');
    expect(rawDtoJson).not.toContain('vault://ref-123');
    expect(rawDtoJson).not.toContain('encrypted_credential_ref');

    for (const connection of snapshot.connections) {
      const keys = Object.keys(connection);
      expect(keys).toEqual(
        expect.arrayContaining(['connectorId', 'status', 'lastSyncAt', 'capabilities'])
      );
      expect(keys).not.toContain('encrypted_credential_ref');
      expect(keys).not.toContain('access_token');
      expect(keys).not.toContain('token');
    }
  });

  describe('pendingDeletions projection', () => {
    it('projects pendingDeletions for pending/running/failed jobs with deduplication and excludes completed', async () => {
      const gateway = createMockGateway({
        getDeletionJobs: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-test-1',
              connector_id: 'google_calendar',
              consent_generation: 1,
              status: 'pending',
            },
            {
              workspace_id: 'ws-test-1',
              connector_id: 'gmail',
              consent_generation: 1,
              status: 'running',
            },
            {
              workspace_id: 'ws-test-1',
              connector_id: 'outlook_mail',
              consent_generation: 2,
              status: 'failed',
            },
            {
              workspace_id: 'ws-test-1',
              connector_id: 'apple_calendar',
              consent_generation: 1,
              status: 'completed', // Completed must be excluded
            },
            {
              workspace_id: 'ws-test-1',
              connector_id: 'google_calendar', // Duplicate
              consent_generation: 2,
              status: 'pending',
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
      expect(snapshot.pendingDeletions).toBeDefined();
      expect(snapshot.pendingDeletions).toEqual(['google_calendar', 'gmail', 'outlook_mail']);
    });

    it('retains connector in pendingDeletions even if it was reconnected', async () => {
      const gateway = createMockGateway({
        getMarketingConnections: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-test-1',
              connector_id: 'google_calendar',
              status: 'connected',
              capabilities: ['read_calendar'],
            },
          ],
          error: null,
        }),
        getDeletionJobs: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-test-1',
              connector_id: 'google_calendar',
              consent_generation: 1,
              status: 'pending', // Old generation cleanup still pending
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
      expect(snapshot.connections.find((c) => c.connectorId === 'google_calendar')?.status).toBe('connected');
      expect(snapshot.pendingDeletions).toContain('google_calendar');
    });

    it('omits pendingDeletions when storageReady is false or gateway does not implement getDeletionJobs', async () => {
      const legacyGateway = createMockGateway(); // No getDeletionJobs
      delete legacyGateway.getDeletionJobs;

      const snapshotLegacy = await loadConnectorHubSnapshot('ws-test-1', legacyGateway);
      expect(snapshotLegacy.pendingDeletions).toBeUndefined();

      const notReadyGateway = createMockGateway({
        getMarketingConnections: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '42P01', message: 'relation does not exist' },
        }),
        getDeletionJobs: vi.fn(),
      });

      const snapshotNotReady = await loadConnectorHubSnapshot('ws-test-1', notReadyGateway);
      expect(snapshotNotReady.storageReady).toBe(false);
      expect(snapshotNotReady.pendingDeletions).toBeUndefined();
      expect(notReadyGateway.getDeletionJobs).not.toHaveBeenCalled();
    });

    it('fails closed and throws on getDeletionJobs database error', async () => {
      const gateway = createMockGateway({
        getDeletionJobs: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'XX000', message: 'deletion jobs table lock timeout' },
        }),
      });

      await expect(loadConnectorHubSnapshot('ws-test-1', gateway)).rejects.toMatchObject({
        code: 'DATABASE_ERROR',
      });
    });
  });
});

describe('connection-service: disconnectMarketingConnector', () => {
  it('enforces role guard: allows owner and manager, rejects member with 403', async () => {
    const gatewayMember = createMockGateway({
      checkWorkspaceRole: vi.fn().mockResolvedValue({ ok: true, role: 'member' }),
    });

    await expect(
      disconnectMarketingConnector(
        { workspaceId: 'ws-test-1', connectorId: 'gmail', actorUserId: 'user-member' },
        gatewayMember
      )
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });

    const gatewayOwner = createMockGateway({
      checkWorkspaceRole: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
    });

    const result = await disconnectMarketingConnector(
      { workspaceId: 'ws-test-1', connectorId: 'gmail', actorUserId: 'user-owner' },
      gatewayOwner
    );

    expect(result.success).toBe(true);
    expect(result.pendingDeletion).toBe(true);
  });

  it('rejects unknown connector ID with 400', async () => {
    const gateway = createMockGateway();

    await expect(
      disconnectMarketingConnector(
        {
          workspaceId: 'ws-test-1',
          // @ts-expect-error test unknown connector id
          connectorId: 'unknown_service',
          actorUserId: 'user-owner',
        },
        gateway
      )
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_CONNECTOR_ID',
    });
  });

  it('rejects social connector disconnection and directs to /app/channels', async () => {
    const gateway = createMockGateway();
    const socialIds: readonly ConnectorId[] = ['instagram', 'threads', 'instagram_messages'];

    for (const id of socialIds) {
      await expect(
        disconnectMarketingConnector(
          {
            workspaceId: 'ws-test-1',
            connectorId: id,
            actorUserId: 'user-owner',
          },
          gateway
        )
      ).rejects.toMatchObject({
        status: 400,
        code: 'SOCIAL_CHANNEL_MANAGEMENT_REQUIRED',
      });
    }
  });

  it('performs atomic revoke and consent generation increment via RPC', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: {
        connector_id: 'google_calendar',
        consent_generation: 3,
        status: 'revoked',
        pending_deletion: true,
      },
      error: null,
    });

    const gateway = createMockGateway({
      disconnectConnectorRpc: rpcMock,
    });

    const result = await disconnectMarketingConnector(
      {
        workspaceId: 'ws-test-1',
        connectorId: 'google_calendar',
        actorUserId: 'user-owner',
      },
      gateway
    );

    expect(rpcMock).toHaveBeenCalledWith({
      p_workspace_id: 'ws-test-1',
      p_connector_id: 'google_calendar',
      p_actor_user_id: 'user-owner',
    });
    expect(result.consentGeneration).toBe(3);
    expect(result.pendingDeletion).toBe(true);
  });

  describe('Finding 1: SNS status normalization and table uniqueness', () => {
    it('normalizes saved SNS with reauth_required or token_expired channel status to reauth_required instead of discarding as disconnected', async () => {
      const gateway = createMockGateway({
        getChannelConnections: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'conn-ig-reauth',
              workspace_id: 'ws-test-1',
              channel: 'instagram',
              status: 'reauth_required',
            },
            {
              id: 'conn-th-expired',
              workspace_id: 'ws-test-1',
              channel: 'threads',
              status: 'token_expired',
            },
          ],
          error: null,
        }),
        getMetaCredentials: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-test-1',
              channel_connection_id: 'conn-ig-reauth',
              provider: 'instagram',
              status: 'active',
              granted_scopes: ['instagram_business_basic'],
            },
            {
              workspace_id: 'ws-test-1',
              channel_connection_id: 'conn-th-expired',
              provider: 'threads',
              status: 'active',
              granted_scopes: ['threads_basic'],
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
      const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
      const th = snapshot.connections.find((c) => c.connectorId === 'threads');
      const igDm = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

      expect(ig?.status).toBe('reauth_required');
      expect(ig?.capabilities).toEqual([]);
      expect(th?.status).toBe('reauth_required');
      expect(th?.capabilities).toEqual([]);
      expect(igDm?.status).toBe('reauth_required');
      expect(igDm?.capabilities).toEqual([]);
    });

    it('normalizes connected channel with empty/incomplete scopes to reauth_required and excludes active capabilities', async () => {
      const gateway = createMockGateway({
        getChannelConnections: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'conn-ig-noscopes',
              workspace_id: 'ws-test-1',
              channel: 'instagram',
              status: 'connected',
            },
          ],
          error: null,
        }),
        getMetaCredentials: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-test-1',
              channel_connection_id: 'conn-ig-noscopes',
              provider: 'instagram',
              status: 'active',
              granted_scopes: [], // No valid read/publish/dm scope
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
      const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
      const igDm = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

      expect(ig?.status).toBe('reauth_required');
      expect(ig?.capabilities).toEqual([]);
      expect(igDm?.status).toBe('reauth_required');
      expect(igDm?.capabilities).toEqual([]);
    });

    it('marks disconnected only when channel or credential status is disconnected or revoked', async () => {
      const gateway = createMockGateway({
        getChannelConnections: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'conn-ig-revoked',
              workspace_id: 'ws-test-1',
              channel: 'instagram',
              status: 'revoked',
            },
          ],
          error: null,
        }),
        getMetaCredentials: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot('ws-test-1', gateway);
      const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
      expect(ig?.status).toBe('disconnected');
    });

    it('fails closed on duplicate marketing connector rows in gateway to maintain table uniqueness', async () => {
      const gateway = createMockGateway({
        getMarketingConnections: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-test-1',
              connector_id: 'google_calendar',
              status: 'connected',
              capabilities: ['events_read'],
            },
            {
              workspace_id: 'ws-test-1',
              connector_id: 'google_calendar',
              status: 'connected',
              capabilities: ['events_read'],
            },
          ],
          error: null,
        }),
      });

      await expect(loadConnectorHubSnapshot('ws-test-1', gateway)).rejects.toMatchObject({
        code: 'DUPLICATE_CONNECTOR',
      });
    });
  });
});
