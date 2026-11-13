import { describe, expect, it, vi } from 'vitest';
import { CONNECTOR_CATALOG } from '../catalog';
import {
  projectConnectorOperationalState,
  type OperationalProjectionGateway,
} from './connector-operational-projection';

function createMockGateway(overrides: Partial<OperationalProjectionGateway> = {}): OperationalProjectionGateway {
  return {
    getMarketingConnections: vi.fn().mockResolvedValue({
      data: [
        {
          workspace_id: 'ws-test-1',
          connector_id: 'gmail',
          status: 'connected',
          last_sync_at: '2026-11-10T10:00:00Z',
          capabilities: ['marketing_draft'],
        },
        {
          workspace_id: 'ws-test-1',
          connector_id: 'google_calendar',
          status: 'reauth_required',
          last_sync_at: '2026-11-09T08:00:00Z',
          capabilities: [],
        },
      ],
      error: null,
    }),
    getChannelConnections: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'conn-ig',
          workspace_id: 'ws-test-1',
          channel: 'instagram',
          status: 'connected',
          updated_at: '2026-11-10T09:00:00Z',
        },
      ],
      error: null,
    }),
    getMetaCredentials: vi.fn().mockResolvedValue({
      data: [
        {
          workspace_id: 'ws-test-1',
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
      ],
      error: null,
    }),
    getConsents: vi.fn().mockResolvedValue({
      data: [
        {
          connector_id: 'gmail',
          consent_generation: 2,
          status: 'active',
          valid_until: '2026-12-01T00:00:00Z',
        },
        {
          connector_id: 'google_calendar',
          consent_generation: 1,
          status: 'revoked',
          valid_until: '2026-11-01T00:00:00Z',
        },
      ],
      error: null,
    }),
    getSyncJobs: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'sync-1',
          connector_id: 'gmail',
          status: 'completed',
          created_at: '2026-11-10T10:00:00Z',
          updated_at: '2026-11-10T10:05:00Z',
          last_error: null,
        },
        {
          id: 'sync-2',
          connector_id: 'gmail',
          status: 'failed',
          created_at: '2026-11-10T09:00:00Z',
          updated_at: '2026-11-10T09:02:00Z',
          last_error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Gmail API rate limit reached',
            sensitive_internal_trace: 'trace-with-secret-token-xyz',
          },
        },
      ],
      error: null,
    }),
    getDeletionJobs: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'del-1',
          workspace_id: 'ws-test-1',
          connector_id: 'google_docs',
          consent_generation: 1,
          status: 'pending',
          created_at: '2026-11-11T01:00:00Z',
        },
      ],
      error: null,
    }),
    getEvidenceStats: vi.fn().mockResolvedValue({
      data: [
        { connector_id: 'gmail', active_count: 42 },
        { connector_id: 'google_calendar', active_count: 7 },
      ],
      error: null,
    }),
    checkWorkspaceRole: vi.fn().mockResolvedValue({ ok: true, role: 'owner' }),
    disconnectConnectorRpc: vi.fn(),
    ...overrides,
  };
}

describe('connector-operational-projection (MC/F08)', () => {
  const TEST_WORKSPACE = 'ws-test-1';

  it('유효하지 않은 workspaceId에 대해 fail-closed 에러를 던진다', async () => {
    const gateway = createMockGateway();
    await expect(projectConnectorOperationalState('', gateway)).rejects.toThrow();
    await expect(projectConnectorOperationalState(null as unknown as string, gateway)).rejects.toThrow();
  });

  it('11개 카탈로그 커넥터 전수에 대해 레코드를 집계하여 반환한다', async () => {
    const gateway = createMockGateway();
    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);

    expect(result.workspaceId).toBe(TEST_WORKSPACE);
    expect(result.correlationId).toBeDefined();
    expect(typeof result.correlationId).toBe('string');
    expect(result.generatedAt).toBeDefined();

    // 11개 전수 확인
    const catalogIds = CONNECTOR_CATALOG.map((c) => c.id);
    expect(catalogIds).toHaveLength(11);

    for (const id of catalogIds) {
      expect(result.connectors[id]).toBeDefined();
      expect(result.connectors[id].connectorId).toBe(id);
    }
  });

  it('삭제 작업이 pending 또는 running 이면 연결 상태와 무관하게 pending_deletion 으로 투영한다', async () => {
    const gateway = createMockGateway({
      getMarketingConnections: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: TEST_WORKSPACE,
            connector_id: 'google_docs',
            status: 'connected', // 원래 connected 이나
          },
        ],
        error: null,
      }),
      getDeletionJobs: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'del-job-1',
            workspace_id: TEST_WORKSPACE,
            connector_id: 'google_docs',
            consent_generation: 3,
            status: 'running', // running deletion job 존재
          },
        ],
        error: null,
      }),
    });

    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);
    const googleDocs = result.connectors['google_docs'];

    expect(googleDocs.status).toBe('pending_deletion');
    expect(googleDocs.deletionStatus).toBe('running');
    expect(googleDocs.deletionJobId).toBe('del-job-1');
  });

  it('연결 끊김, 인증 만료, 정상 연결 상태를 정확하게 매핑한다', async () => {
    const gateway = createMockGateway();
    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);

    // gmail: connected
    expect(result.connectors['gmail'].status).toBe('connected');

    // google_calendar: reauth_required
    expect(result.connectors['google_calendar'].status).toBe('reauth_required');

    // apple_calendar (데이터 없음): disconnected
    expect(result.connectors['apple_calendar'].status).toBe('disconnected');

    // apple_reminders (카탈로그 unsupported): disconnected
    expect(result.connectors['apple_reminders'].status).toBe('disconnected');
  });

  it('동의 세대 및 활성/철회 상태를 투영한다', async () => {
    const gateway = createMockGateway();
    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);

    expect(result.connectors['gmail'].consentGeneration).toBe(2);
    expect(result.connectors['gmail'].consentStatus).toBe('active');

    expect(result.connectors['google_calendar'].consentGeneration).toBe(1);
    expect(result.connectors['google_calendar'].consentStatus).toBe('revoked');

    expect(result.connectors['apple_calendar'].consentGeneration).toBeNull();
    expect(result.connectors['apple_calendar'].consentStatus).toBe('none');
  });

  it('동기화 성공 및 실패 시각, 정제된 에러 코드를 투영한다', async () => {
    const gateway = createMockGateway();
    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);

    const gmail = result.connectors['gmail'];
    expect(gmail.lastSyncSuccessAt).toBe('2026-11-10T10:05:00Z');
    expect(gmail.lastSyncFailureAt).toBe('2026-11-10T09:02:00Z');
    expect(gmail.lastSyncErrorCode).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('활성 근거 건수를 투영한다', async () => {
    const gateway = createMockGateway();
    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);

    expect(result.connectors['gmail'].activeEvidenceCount).toBe(42);
    expect(result.connectors['google_calendar'].activeEvidenceCount).toBe(7);
    expect(result.connectors['google_drive'].activeEvidenceCount).toBe(0);
  });

  it('보안 격리: 반환 DTO에 토큰, 인증 비밀값, PII, 원문 내용이 절대 노출되지 않는다', async () => {
    const gateway = createMockGateway({
      getMetaCredentials: vi.fn().mockResolvedValue({
        data: [
          {
            workspace_id: TEST_WORKSPACE,
            channel_connection_id: 'conn-ig',
            provider: 'instagram',
            status: 'active',
            granted_scopes: ['instagram_business_basic'],
            token_expires_at: '2099-01-01T00:00:00Z',
            // 아래와 같은 민감 정보가 소스에 존재하더라도
            access_token: 'SECRET_ACCESS_TOKEN_DO_NOT_LEAK',
            client_secret: 'TOP_SECRET_CLIENT_SECRET',
          },
        ],
        error: null,
      }),
      getSyncJobs: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'sync-leak-test',
            connector_id: 'gmail',
            status: 'failed',
            created_at: '2026-11-10T10:00:00Z',
            updated_at: '2026-11-10T10:05:00Z',
            last_error: {
              code: 'AUTH_FAILED',
              message: 'Failed with token: Bearer ya29.a0AfH6SMA... and email user@customer.com',
              raw_response: {
                headers: { authorization: 'Bearer secret_token_123' },
                body: 'Customer personal message body with PII',
              },
            },
          },
        ],
        error: null,
      }),
    });

    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway);
    const serialized = JSON.stringify(result);

    // 민감 문자열/키워드 일체 검출되지 않아야 함
    expect(serialized).not.toContain('SECRET_ACCESS_TOKEN');
    expect(serialized).not.toContain('TOP_SECRET_CLIENT_SECRET');
    expect(serialized).not.toContain('secret_token_123');
    expect(serialized).not.toContain('user@customer.com');
    expect(serialized).not.toContain('Customer personal message body');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('authorization');
  });

  it('명시적 correlationId 전달 시 보존된다', async () => {
    const gateway = createMockGateway();
    const explicitCorrelationId = 'custom-correlation-id-999';
    const result = await projectConnectorOperationalState(TEST_WORKSPACE, gateway, {
      correlationId: explicitCorrelationId,
    });

    expect(result.correlationId).toBe(explicitCorrelationId);
  });
});
