import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  saveConnectorCredential,
  loadConnectorCredential,
  type CredentialVaultGateway,
  type StoredCredentialRecord,
  type EncryptedToken,
} from '../credentials/credential-vault';
import type { DeletionJob } from './deletion-job-repository';
import {
  executeConnectorDeletion,
  type DeletionExecutorGateway,
} from './deletion-executor';

const TEST_KEY_BASE64 = 'k7L3yq0Q1f7Z_8P0N4m3vL6R1t9X2w4Z6A8c0E2G4I4';

class InMemoryVaultGateway implements CredentialVaultGateway {
  private store = new Map<string, StoredCredentialRecord>();

  private key(ws: string, id: string) {
    return `${ws}:${id}`;
  }

  async getCredential(ws: string, id: ConnectorId): Promise<StoredCredentialRecord | null> {
    const r = this.store.get(this.key(ws, id));
    return r ? { ...r } : null;
  }

  async saveCredential(record: StoredCredentialRecord): Promise<void> {
    this.store.set(this.key(record.workspaceId, record.connectorId), { ...record });
  }

  async updateCredentialTokens(params: {
    workspaceId: string;
    connectorId: ConnectorId;
    encryptedAccessToken: EncryptedToken;
    encryptedRefreshToken: EncryptedToken | null;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void> {
    const existing = this.store.get(this.key(params.workspaceId, params.connectorId));
    if (existing) {
      this.store.set(this.key(params.workspaceId, params.connectorId), {
        ...existing,
        ...params,
      });
    }
  }

  async deleteCredential(ws: string, id: ConnectorId): Promise<void> {
    this.store.delete(this.key(ws, id));
  }
}

describe('DeletionExecutor (ANI-2153 F06)', () => {
  let vaultGateway: InMemoryVaultGateway;
  let mockRevokeConsent: ReturnType<typeof vi.fn<(params: { workspaceId: string; connectorId: ConnectorId; consentGeneration: number; now: string }) => Promise<void>>>;
  let mockRevokeEvidence: ReturnType<typeof vi.fn<(params: { workspaceId: string; connectorId: ConnectorId; now: string }) => Promise<void>>>;
  let mockUpdateConnectionStatus: ReturnType<typeof vi.fn<(params: { workspaceId: string; connectorId: ConnectorId; status: 'disconnected' | 'revoked'; now: string }) => Promise<void>>>;
  let mockRevokeRemoteToken: ReturnType<typeof vi.fn<(params: { connectorId: ConnectorId; token: string }) => Promise<{ ok: boolean; status?: number; error?: string }>>>;
  let gateway: DeletionExecutorGateway;

  beforeEach(() => {
    process.env.MARKETING_CONNECTOR_TOKEN_KEY = TEST_KEY_BASE64;
    vaultGateway = new InMemoryVaultGateway();
    mockRevokeConsent = vi.fn<(params: { workspaceId: string; connectorId: ConnectorId; consentGeneration: number; now: string }) => Promise<void>>().mockResolvedValue(undefined);
    mockRevokeEvidence = vi.fn<(params: { workspaceId: string; connectorId: ConnectorId; now: string }) => Promise<void>>().mockResolvedValue(undefined);
    mockUpdateConnectionStatus = vi.fn<(params: { workspaceId: string; connectorId: ConnectorId; status: 'disconnected' | 'revoked'; now: string }) => Promise<void>>().mockResolvedValue(undefined);
    mockRevokeRemoteToken = vi.fn<(params: { connectorId: ConnectorId; token: string }) => Promise<{ ok: boolean; status?: number; error?: string }>>().mockResolvedValue({ ok: true, status: 200 });

    gateway = {
      vaultGateway,
      revokeConsent: mockRevokeConsent,
      revokeEvidence: mockRevokeEvidence,
      updateConnectionStatus: mockUpdateConnectionStatus,
      revokeRemoteToken: mockRevokeRemoteToken,
    };
  });

  const createTestJob = (overrides?: Partial<DeletionJob>): DeletionJob => ({
    id: 'job-del-1',
    workspaceId: 'ws-del-1',
    connectorId: 'google_calendar',
    consentGeneration: 1,
    status: 'running',
    attempts: 1,
    maxRetries: 5,
    lockedBy: 'worker-1',
    leaseExpiresAt: '2026-11-11T12:00:00.000Z',
    lastError: null,
    retryAfter: null,
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  });

  describe('1. 성공 시 단계별 삭제 및 무효화', () => {
    it('Google 토큰 원격 revoke, Vault 토큰 삭제, 동의 철회, 근거 무효화, 연결 상태 disconnected 전이를 순차 수행한다', async () => {
      // Setup vault token
      await saveConnectorCredential(
        {
          workspaceId: 'ws-del-1',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          accessToken: 'google-access-token-123',
          refreshToken: 'google-refresh-token-456',
          expiresAt: null,
          grantedScopes: [],
        },
        vaultGateway
      );

      const job = createTestJob();
      const result = await executeConnectorDeletion(job, gateway, {
        now: '2026-11-11T10:30:00.000Z',
      });

      expect(result.ok).toBe(true);
      expect(result.remoteRevoked).toBe(true);
      expect(result.credentialDeleted).toBe(true);
      expect(result.consentRevoked).toBe(true);
      expect(result.evidenceRevoked).toBe(true);
      expect(result.connectionDisconnected).toBe(true);

      // Verify remote revoke was called with refresh token (or access token)
      expect(mockRevokeRemoteToken).toHaveBeenCalledWith({
        connectorId: 'google_calendar',
        token: 'google-refresh-token-456',
      });

      // Verify vault credential is gone
      await expect(
        loadConnectorCredential('ws-del-1', 'google_calendar', 1, vaultGateway)
      ).rejects.toThrowError(expect.objectContaining({ code: 'CREDENTIAL_NOT_FOUND' }));

      // Verify consent revoked
      expect(mockRevokeConsent).toHaveBeenCalledWith({
        workspaceId: 'ws-del-1',
        connectorId: 'google_calendar',
        consentGeneration: 1,
        now: '2026-11-11T10:30:00.000Z',
      });

      // Verify evidence revoked
      expect(mockRevokeEvidence).toHaveBeenCalledWith({
        workspaceId: 'ws-del-1',
        connectorId: 'google_calendar',
        now: '2026-11-11T10:30:00.000Z',
      });

      // Verify connection marked disconnected
      expect(mockUpdateConnectionStatus).toHaveBeenCalledWith({
        workspaceId: 'ws-del-1',
        connectorId: 'google_calendar',
        status: 'disconnected',
        now: '2026-11-11T10:30:00.000Z',
      });
    });

    it('기본 HTTP fetch로 Google revoke 엔드포인트를 호출할 수 있다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-del-http',
          connectorId: 'gmail',
          consentGeneration: 1,
          accessToken: 'gmail-access-token',
          refreshToken: 'gmail-refresh-token',
          expiresAt: null,
          grantedScopes: [],
        },
        vaultGateway
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
      });

      const httpGateway: DeletionExecutorGateway = {
        vaultGateway,
        revokeConsent: mockRevokeConsent,
        revokeEvidence: mockRevokeEvidence,
        updateConnectionStatus: mockUpdateConnectionStatus,
        fetch: mockFetch as any,
      };

      const job = createTestJob({
        workspaceId: 'ws-del-http',
        connectorId: 'gmail',
      });

      const result = await executeConnectorDeletion(job, httpGateway);
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('2. 원격 revoke 에러 및 400 처리', () => {
    it('원격 revoke 응답이 400(토큰 만료/기폐기)인 경우 에러를 던지지 않고 다음 단계로 계속 진행한다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-del-2',
          connectorId: 'google_docs',
          consentGeneration: 1,
          accessToken: 'already-revoked-token',
          expiresAt: null,
          grantedScopes: [],
        },
        vaultGateway
      );

      mockRevokeRemoteToken.mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: 'invalid_token',
      });

      const job = createTestJob({
        workspaceId: 'ws-del-2',
        connectorId: 'google_docs',
      });

      const result = await executeConnectorDeletion(job, gateway);

      expect(result.ok).toBe(true);
      expect(result.credentialDeleted).toBe(true);
      expect(result.consentRevoked).toBe(true);
      expect(result.evidenceRevoked).toBe(true);
      expect(result.connectionDisconnected).toBe(true);
    });

    it('원격 revoke 중 네트워크 오류나 5xx 발생 시 에러를 던져 재시도 가능하게 한다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-del-3',
          connectorId: 'google_sheets',
          consentGeneration: 1,
          accessToken: 'sheets-token',
          expiresAt: null,
          grantedScopes: [],
        },
        vaultGateway
      );

      mockRevokeRemoteToken.mockRejectedValueOnce(new Error('Network error: ETIMEDOUT'));

      const job = createTestJob({
        workspaceId: 'ws-del-3',
        connectorId: 'google_sheets',
      });

      await expect(
        executeConnectorDeletion(job, gateway)
      ).rejects.toThrow('Network error: ETIMEDOUT');

      // Vault token must NOT be deleted yet so retry can revoke it
      const stillInVault = await loadConnectorCredential('ws-del-3', 'google_sheets', 1, vaultGateway);
      expect(stillInVault.accessToken).toBe('sheets-token');
    });
  });

  describe('3. 세대 보호 및 멱등성 (Zero-overkill)', () => {
    it('Vault에 이미 더 최신 세대의 토큰이 존재하는 경우 새 토큰을 폐기/삭제하지 않고 구세대 데이터만 정리한다', async () => {
      // User reconnected and generated gen 2 tokens
      await saveConnectorCredential(
        {
          workspaceId: 'ws-del-4',
          connectorId: 'google_calendar',
          consentGeneration: 2,
          accessToken: 'new-active-gen2-token',
          expiresAt: null,
          grantedScopes: [],
        },
        vaultGateway
      );

      // Deletion job is for gen 1
      const job = createTestJob({
        workspaceId: 'ws-del-4',
        connectorId: 'google_calendar',
        consentGeneration: 1,
      });

      const result = await executeConnectorDeletion(job, gateway);

      expect(result.ok).toBe(true);
      expect(result.remoteRevoked).toBe(false);
      expect(result.credentialDeleted).toBe(false);

      // Remote revoke must NOT have been called with new token
      expect(mockRevokeRemoteToken).not.toHaveBeenCalled();

      // Gen 2 token must remain completely intact in vault
      const intact = await loadConnectorCredential('ws-del-4', 'google_calendar', 2, vaultGateway);
      expect(intact.accessToken).toBe('new-active-gen2-token');

      // But evidence and consent revocation should have run
      expect(mockRevokeEvidence).toHaveBeenCalled();
    });

    it('Vault에 토큰이 이미 존재하지 않는 경우에도 안전하고 멱등적으로 성공한다', async () => {
      const job = createTestJob({
        workspaceId: 'ws-del-empty',
        connectorId: 'apple_calendar',
      });

      const result = await executeConnectorDeletion(job, gateway);

      expect(result.ok).toBe(true);
      expect(result.remoteRevoked).toBe(false);
      expect(result.credentialDeleted).toBe(true);
      expect(result.consentRevoked).toBe(true);
      expect(result.evidenceRevoked).toBe(true);
      expect(result.connectionDisconnected).toBe(true);
    });

    it('동일한 삭제 실행을 두 번 반복해도 에러 없이 멱등적으로 완료된다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-del-repeat',
          connectorId: 'google_drive',
          consentGeneration: 1,
          accessToken: 'drive-token',
          expiresAt: null,
          grantedScopes: [],
        },
        vaultGateway
      );

      const job = createTestJob({
        workspaceId: 'ws-del-repeat',
        connectorId: 'google_drive',
      });

      const first = await executeConnectorDeletion(job, gateway);
      expect(first.ok).toBe(true);

      const second = await executeConnectorDeletion(job, gateway);
      expect(second.ok).toBe(true);
    });
  });
});
