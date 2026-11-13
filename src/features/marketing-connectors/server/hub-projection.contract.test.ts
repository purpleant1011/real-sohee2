import { describe, expect, it, vi } from 'vitest';
import { loadConnectorHubSnapshot, type MarketingConnectorGateway } from './connection-service';

function createGatewayFixture(overrides: Partial<MarketingConnectorGateway> = {}): MarketingConnectorGateway {
  return {
    getMarketingConnections: vi.fn().mockResolvedValue({ data: [], error: null }),
    getChannelConnections: vi.fn().mockResolvedValue({ data: [], error: null }),
    getMetaCredentials: vi.fn().mockResolvedValue({ data: [], error: null }),
    disconnectConnectorRpc: vi.fn().mockResolvedValue({
      data: {
        connector_id: 'gmail',
        consent_generation: 1,
        status: 'revoked',
        pending_deletion: true,
      },
      error: null,
    }),
    checkWorkspaceRole: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
    ...overrides,
  };
}

describe('hub-projection contract tests', () => {
  const TEST_WORKSPACE = 'ws-contract-test-1';

  describe('기존 SNS 상태 유지 (State Persistence Contract)', () => {
    it.each([
      ['reauth_required', 'reauth_required'],
      ['token_expired', 'reauth_required'],
      ['scope_incomplete', 'reauth_required'],
      ['error', 'error'],
    ] as const)(
      'channel status가 %s일 때 instagram/threads/instagram_messages 상태는 %s를 유지하고 capability는 일절 부여하지 않는다',
      async (channelStatus, expectedStatus) => {
        const gateway = createGatewayFixture({
          getChannelConnections: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'conn-ig',
                workspace_id: TEST_WORKSPACE,
                channel: 'instagram',
                status: channelStatus,
              },
              {
                id: 'conn-th',
                workspace_id: TEST_WORKSPACE,
                channel: 'threads',
                status: channelStatus,
              },
            ],
            error: null,
          }),
          getMetaCredentials: vi.fn().mockResolvedValue({
            data: [
              {
                workspace_id: TEST_WORKSPACE,
                channel_connection_id: 'conn-ig',
                provider: 'instagram',
                status: 'active',
                granted_scopes: [
                  'instagram_business_basic',
                  'instagram_business_content_publish',
                  'instagram_business_manage_messages',
                ],
                token_expires_at: '2099-01-01T00:00:00Z',
              },
              {
                workspace_id: TEST_WORKSPACE,
                channel_connection_id: 'conn-th',
                provider: 'threads',
                status: 'active',
                granted_scopes: ['threads_basic', 'threads_content_publish'],
                token_expires_at: '2099-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        });

        const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);

        const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
        const th = snapshot.connections.find((c) => c.connectorId === 'threads');
        const igDm = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

        expect(ig?.status).toBe(expectedStatus);
        expect(ig?.capabilities).toEqual([]);

        expect(th?.status).toBe(expectedStatus);
        expect(th?.capabilities).toEqual([]);

        expect(igDm?.status).toBe(expectedStatus);
        expect(igDm?.capabilities).toEqual([]);
      }
    );

    it.each([
      ['error', 'error'],
      ['token_expired', 'reauth_required'],
      ['scope_incomplete', 'reauth_required'],
      ['refresh_required', 'reauth_required'],
      ['reauth_required', 'reauth_required'],
    ] as const)(
      'channel status가 connected여도 credential status가 %s이면 %s로 강등되고 capability는 비어 있어야 한다',
      async (credStatus, expectedStatus) => {
        const gateway = createGatewayFixture({
          getChannelConnections: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'conn-ig-active',
                workspace_id: TEST_WORKSPACE,
                channel: 'instagram',
                status: 'connected',
              },
            ],
            error: null,
          }),
          getMetaCredentials: vi.fn().mockResolvedValue({
            data: [
              {
                workspace_id: TEST_WORKSPACE,
                channel_connection_id: 'conn-ig-active',
                provider: 'instagram',
                status: credStatus,
                granted_scopes: [
                  'instagram_business_basic',
                  'instagram_business_content_publish',
                  'instagram_business_manage_messages',
                ],
                token_expires_at: '2099-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        });

        const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);
        const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
        const igDm = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

        expect(ig?.status).toBe(expectedStatus);
        expect(ig?.capabilities).toEqual([]);
        expect(igDm?.status).toBe(expectedStatus);
        expect(igDm?.capabilities).toEqual([]);
      }
    );
  });

  describe('Expired / Invalid Credential 안전 경계 (Capability Safety Contract)', () => {
    it('token_expires_at이 과거 시점(만료)이면 reauth_required로 전락하고 capability는 빈 배열이다', async () => {
      const pastExpiry = new Date(Date.now() - 3600 * 1000).toISOString();
      const gateway = createGatewayFixture({
        getChannelConnections: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'conn-ig-expired-token',
              workspace_id: TEST_WORKSPACE,
              channel: 'instagram',
              status: 'connected',
            },
            {
              id: 'conn-th-expired-token',
              workspace_id: TEST_WORKSPACE,
              channel: 'threads',
              status: 'connected',
            },
          ],
          error: null,
        }),
        getMetaCredentials: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: TEST_WORKSPACE,
              channel_connection_id: 'conn-ig-expired-token',
              provider: 'instagram',
              status: 'active',
              granted_scopes: [
                'instagram_business_basic',
                'instagram_business_content_publish',
                'instagram_business_manage_messages',
              ],
              token_expires_at: pastExpiry,
            },
            {
              workspace_id: TEST_WORKSPACE,
              channel_connection_id: 'conn-th-expired-token',
              provider: 'threads',
              status: 'active',
              granted_scopes: ['threads_basic', 'threads_content_publish'],
              token_expires_at: pastExpiry,
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);

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

    it('credential status가 invalid 또는 expired이면 capability를 일절 부여하지 않는다', async () => {
      const gateway = createGatewayFixture({
        getChannelConnections: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'conn-ig-invalid',
              workspace_id: TEST_WORKSPACE,
              channel: 'instagram',
              status: 'connected',
            },
          ],
          error: null,
        }),
        getMetaCredentials: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: TEST_WORKSPACE,
              channel_connection_id: 'conn-ig-invalid',
              provider: 'instagram',
              status: 'invalid',
              granted_scopes: [
                'instagram_business_basic',
                'instagram_business_content_publish',
                'instagram_business_manage_messages',
              ],
              token_expires_at: '2099-01-01T00:00:00Z',
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);
      const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
      const igDm = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

      expect(ig?.status).toBe('reauth_required');
      expect(ig?.capabilities).toEqual([]);
      expect(igDm?.status).toBe('reauth_required');
      expect(igDm?.capabilities).toEqual([]);
    });

    it('credential이 누락된 경우(null 매칭) capability가 없으며 reauth_required로 투영된다', async () => {
      const gateway = createGatewayFixture({
        getChannelConnections: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'conn-ig-nocred',
              workspace_id: TEST_WORKSPACE,
              channel: 'instagram',
              status: 'connected',
            },
          ],
          error: null,
        }),
        getMetaCredentials: vi.fn().mockResolvedValue({
          data: [], // No credentials found
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);
      const ig = snapshot.connections.find((c) => c.connectorId === 'instagram');
      const igDm = snapshot.connections.find((c) => c.connectorId === 'instagram_messages');

      expect(ig?.status).toBe('reauth_required');
      expect(ig?.capabilities).toEqual([]);
      expect(igDm?.status).toBe('reauth_required');
      expect(igDm?.capabilities).toEqual([]);
    });
  });

  describe('pendingDeletions 원장 계약 (Pending Deletions Ledger Contract)', () => {
    it('다른 테넌트(workspace_id 불일치)의 삭제 작업은 pendingDeletions에 절대 투영되지 않는다', async () => {
      const gateway = createGatewayFixture({
        getDeletionJobs: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: 'ws-foreign-workspace-id',
              connector_id: 'gmail',
              consent_generation: 1,
              status: 'pending',
            },
            {
              workspace_id: TEST_WORKSPACE,
              connector_id: 'google_calendar',
              consent_generation: 1,
              status: 'pending',
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);
      expect(snapshot.pendingDeletions).toEqual(['google_calendar']);
      expect(snapshot.pendingDeletions).not.toContain('gmail');
    });

    it('completed 상태의 작업 및 허용되지 않은 invalid status(unknown, cancelled 등)는 pendingDeletions에서 제외된다', async () => {
      const gateway = createGatewayFixture({
        getDeletionJobs: vi.fn().mockResolvedValue({
          data: [
            {
              workspace_id: TEST_WORKSPACE,
              connector_id: 'apple_calendar',
              consent_generation: 1,
              status: 'completed', // completed는 제외
            },
            {
              workspace_id: TEST_WORKSPACE,
              connector_id: 'outlook_mail',
              consent_generation: 1,
              status: 'unknown_status', // invalid status 제외
            },
            {
              workspace_id: TEST_WORKSPACE,
              connector_id: 'outlook_calendar',
              consent_generation: 1,
              status: 'cancelled', // invalid status 제외
            },
            {
              workspace_id: TEST_WORKSPACE,
              connector_id: 'gmail',
              consent_generation: 1,
              status: 'running', // 정상 running 포함
            },
            {
              workspace_id: TEST_WORKSPACE,
              connector_id: 'google_calendar',
              consent_generation: 2,
              status: 'failed', // 정상 failed 포함
            },
          ],
          error: null,
        }),
      });

      const snapshot = await loadConnectorHubSnapshot(TEST_WORKSPACE, gateway);
      expect(snapshot.pendingDeletions).toEqual(['gmail', 'google_calendar']);
      expect(snapshot.pendingDeletions).not.toContain('apple_calendar');
      expect(snapshot.pendingDeletions).not.toContain('outlook_mail');
      expect(snapshot.pendingDeletions).not.toContain('outlook_calendar');
    });

    it.each([
      ['0 (zero)', 0],
      ['-1 (negative)', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['1.5 (fractional)', 1.5],
      ['"1" (string)', '1' as unknown as number],
    ] as const)(
      '동일 workspace known connector의 deletion job이 비정상 consent_generation(%s)을 가지면 침묵 배제하지 않고 reject된다',
      async (_desc, invalidGen) => {
        const gateway = createGatewayFixture({
          getDeletionJobs: vi.fn().mockResolvedValue({
            data: [
              {
                workspace_id: TEST_WORKSPACE,
                connector_id: 'gmail',
                consent_generation: invalidGen,
                status: 'pending',
              },
            ],
            error: null,
          }),
        });

        await expect(loadConnectorHubSnapshot(TEST_WORKSPACE, gateway)).rejects.toThrow();
      }
    );

    it('getDeletionJobs 조회 오류 시 silent fallback 없이 DATABASE_ERROR 예외를 던져 fail-closed 된다', async () => {
      const gateway = createGatewayFixture({
        getDeletionJobs: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: '08006',
            message: 'connection failure during deletion job lookup',
          },
        }),
      });

      await expect(loadConnectorHubSnapshot(TEST_WORKSPACE, gateway)).rejects.toMatchObject({
        name: 'MarketingConnectorError',
        status: 500,
        code: 'DATABASE_ERROR',
      });
    });
  });
});
