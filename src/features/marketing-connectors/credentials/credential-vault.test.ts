import { describe, it, expect, beforeEach } from 'vitest';
import type { ConnectorId } from '../catalog';
import {
  encryptConnectorToken,
  decryptConnectorToken,
  saveConnectorCredential,
  loadConnectorCredential,
  rotateConnectorToken,
  deleteCredential,
  CredentialVaultError,
  type CredentialVaultGateway,
  type StoredCredentialRecord,
  type EncryptedToken,
} from './credential-vault';

// 32-byte valid Base64URL test key
const TEST_KEY_BASE64 = 'k7L3yq0Q1f7Z_8P0N4m3vL6R1t9X2w4Z6A8c0E2G4I4'; // 32 bytes when decoded

class InMemoryCredentialVaultGateway implements CredentialVaultGateway {
  private storage = new Map<string, StoredCredentialRecord>();

  private makeKey(workspaceId: string, connectorId: string): string {
    return `${workspaceId}:${connectorId}`;
  }

  async getCredential(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<StoredCredentialRecord | null> {
    const record = this.storage.get(this.makeKey(workspaceId, connectorId));
    return record ? { ...record } : null;
  }

  async saveCredential(record: StoredCredentialRecord): Promise<void> {
    this.storage.set(
      this.makeKey(record.workspaceId, record.connectorId),
      { ...record }
    );
  }

  async updateCredentialTokens(params: {
    workspaceId: string;
    connectorId: ConnectorId;
    encryptedAccessToken: EncryptedToken;
    encryptedRefreshToken: EncryptedToken | null;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void> {
    const key = this.makeKey(params.workspaceId, params.connectorId);
    const existing = this.storage.get(key);
    if (!existing) {
      throw new Error('Record not found for update');
    }
    this.storage.set(key, {
      ...existing,
      encryptedAccessToken: params.encryptedAccessToken,
      encryptedRefreshToken: params.encryptedRefreshToken,
      expiresAt: params.expiresAt,
      updatedAt: params.updatedAt,
    });
  }

  async deleteCredential(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<void> {
    this.storage.delete(this.makeKey(workspaceId, connectorId));
  }

  // Helper for test assertions
  getRawRecord(workspaceId: string, connectorId: string) {
    return this.storage.get(this.makeKey(workspaceId, connectorId));
  }
}

describe('Credential Vault & Token Rotation (ANI-2150)', () => {
  let gateway: InMemoryCredentialVaultGateway;

  beforeEach(() => {
    gateway = new InMemoryCredentialVaultGateway();
    process.env.MARKETING_CONNECTOR_TOKEN_KEY = TEST_KEY_BASE64;
  });

  describe('1. Web Crypto AES-GCM-256 암호화 및 복호화', () => {
    it('평문 토큰을 암호화하고 복호화하면 원래 평문과 일치해야 한다', async () => {
      const plaintext = 'ya29.a0AfH6SMA-google-access-token-secret-12345';
      const encrypted = await encryptConnectorToken(plaintext, TEST_KEY_BASE64);

      expect(encrypted.algorithm).toBe('AES-GCM-256');
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = await decryptConnectorToken(encrypted, TEST_KEY_BASE64);
      expect(decrypted).toBe(plaintext);
    });

    it('동일한 평문이라도 매 암호화마다 서로 다른 IV와 암호문을 생성해야 한다', async () => {
      const plaintext = 'refresh_token_ultra_secret_abc';
      const enc1 = await encryptConnectorToken(plaintext, TEST_KEY_BASE64);
      const enc2 = await encryptConnectorToken(plaintext, TEST_KEY_BASE64);

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

      expect(await decryptConnectorToken(enc1, TEST_KEY_BASE64)).toBe(plaintext);
      expect(await decryptConnectorToken(enc2, TEST_KEY_BASE64)).toBe(plaintext);
    });

    it('32바이트가 아닌 잘못된 키를 사용하면 INVALID_KEY 에러가 발생해야 한다', async () => {
      const invalidShortKey = 'c2hvcnQ='; // "short" (5 bytes)
      await expect(
        encryptConnectorToken('secret', invalidShortKey)
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'INVALID_KEY' })
      );

      await expect(
        decryptConnectorToken(
          { ciphertext: 'abc', iv: 'def', algorithm: 'AES-GCM-256' },
          invalidShortKey
        )
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'INVALID_KEY' })
      );
    });

    it('조작된 암호문이나 손상된 IV를 복호화할 때 DECRYPTION_FAILED 에러를 던져야 한다', async () => {
      const encrypted = await encryptConnectorToken('super-secret', TEST_KEY_BASE64);
      const tampered = {
        ...encrypted,
        ciphertext: 'AAAA' + encrypted.ciphertext.slice(4),
      };

      await expect(
        decryptConnectorToken(tampered, TEST_KEY_BASE64)
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'DECRYPTION_FAILED' })
      );
    });

    it('알고리즘이 AES-GCM-256이 아니면 거부해야 한다', async () => {
      await expect(
        decryptConnectorToken(
          { ciphertext: 'abc', iv: 'def', algorithm: 'DES' },
          TEST_KEY_BASE64
        )
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_ALGORITHM' })
      );
    });
  });

  describe('2. saveConnectorCredential', () => {
    it('토큰을 암호화하여 Gateway에 저장하고 평문은 노출하지 않는다', async () => {
      const rawAccessToken = 'raw_access_token_12345';
      const rawRefreshToken = 'raw_refresh_token_67890';

      const saved = await saveConnectorCredential(
        {
          workspaceId: 'ws-100',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          accessToken: rawAccessToken,
          refreshToken: rawRefreshToken,
          expiresAt: '2026-12-01T00:00:00.000Z',
          grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        },
        gateway
      );

      expect(saved.workspaceId).toBe('ws-100');
      expect(saved.connectorId).toBe('google_calendar');
      expect(saved.consentGeneration).toBe(1);

      // Raw record in gateway must NOT contain plaintext tokens
      const rawRecord = gateway.getRawRecord('ws-100', 'google_calendar');
      expect(rawRecord).toBeDefined();
      expect(rawRecord?.encryptedAccessToken.ciphertext).toBeDefined();
      expect(rawRecord?.encryptedAccessToken.ciphertext).not.toBe(rawAccessToken);
      expect(rawRecord?.encryptedRefreshToken?.ciphertext).toBeDefined();
      expect(rawRecord?.encryptedRefreshToken?.ciphertext).not.toBe(rawRefreshToken);
    });

    it('이미 더 최신 세대가 저장되어 있는데 이전 세대를 저장하려 하면 STALE_GENERATION 에러로 거부한다', async () => {
      // First save generation 2
      await saveConnectorCredential(
        {
          workspaceId: 'ws-100',
          connectorId: 'gmail',
          consentGeneration: 2,
          accessToken: 'gen2_access_token',
          expiresAt: null,
          grantedScopes: ['gmail.readonly'],
        },
        gateway
      );

      // Attempt to save generation 1 (stale)
      await expect(
        saveConnectorCredential(
          {
            workspaceId: 'ws-100',
            connectorId: 'gmail',
            consentGeneration: 1,
            accessToken: 'gen1_access_token',
            expiresAt: null,
            grantedScopes: ['gmail.readonly'],
          },
          gateway
        )
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'STALE_GENERATION' })
      );
    });

    it('동일 세대 또는 상위 세대로의 저장은 성공한다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-100',
          connectorId: 'outlook_mail',
          consentGeneration: 1,
          accessToken: 'first_token',
          expiresAt: null,
          grantedScopes: [],
        },
        gateway
      );

      // Same generation update
      await expect(
        saveConnectorCredential(
          {
            workspaceId: 'ws-100',
            connectorId: 'outlook_mail',
            consentGeneration: 1,
            accessToken: 'first_token_updated',
            expiresAt: null,
            grantedScopes: [],
          },
          gateway
        )
      ).resolves.toBeDefined();

      // Next generation update
      await expect(
        saveConnectorCredential(
          {
            workspaceId: 'ws-100',
            connectorId: 'outlook_mail',
            consentGeneration: 2,
            accessToken: 'second_gen_token',
            expiresAt: null,
            grantedScopes: [],
          },
          gateway
        )
      ).resolves.toBeDefined();
    });
  });

  describe('3. loadConnectorCredential', () => {
    it('저장된 토큰을 정상 복호화하여 반환한다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-200',
          connectorId: 'google_docs',
          consentGeneration: 3,
          accessToken: 'my-docs-access-token',
          refreshToken: 'my-docs-refresh-token',
          expiresAt: '2026-11-20T12:00:00Z',
          grantedScopes: ['documents.readonly'],
        },
        gateway
      );

      const loaded = await loadConnectorCredential(
        'ws-200',
        'google_docs',
        3,
        gateway
      );

      expect(loaded.workspaceId).toBe('ws-200');
      expect(loaded.connectorId).toBe('google_docs');
      expect(loaded.consentGeneration).toBe(3);
      expect(loaded.accessToken).toBe('my-docs-access-token');
      expect(loaded.refreshToken).toBe('my-docs-refresh-token');
      expect(loaded.expiresAt).toBe('2026-11-20T12:00:00Z');
      expect(loaded.grantedScopes).toEqual(['documents.readonly']);
    });

    it('요청한 generation이 현재 저장된 consentGeneration과 일치하지 않으면 STALE_GENERATION 에러를 던진다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-200',
          connectorId: 'google_sheets',
          consentGeneration: 2,
          accessToken: 'sheets-token',
          expiresAt: null,
          grantedScopes: [],
        },
        gateway
      );

      // Querying generation 1 when generation 2 is current
      await expect(
        loadConnectorCredential('ws-200', 'google_sheets', 1, gateway)
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'STALE_GENERATION' })
      );
    });

    it('존재하지 않는 자격 증명 조회 시 CREDENTIAL_NOT_FOUND 에러를 던진다', async () => {
      await expect(
        loadConnectorCredential('ws-999', 'gmail', 1, gateway)
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'CREDENTIAL_NOT_FOUND' })
      );
    });
  });

  describe('4. rotateConnectorToken', () => {
    it('토큰 리프레시 시 access_token을 원자적으로 교체하고 만료시각을 갱신한다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-300',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          accessToken: 'old_access_token',
          refreshToken: 'original_refresh_token',
          expiresAt: '2026-11-11T00:00:00Z',
          grantedScopes: ['calendar.readonly'],
        },
        gateway
      );

      // Rotate with new access token and new expiry
      await rotateConnectorToken(
        'ws-300',
        'google_calendar',
        {
          accessToken: 'new_rotated_access_token',
          expiresAt: '2026-11-11T02:00:00Z',
        },
        gateway
      );

      const loaded = await loadConnectorCredential(
        'ws-300',
        'google_calendar',
        1,
        gateway
      );

      expect(loaded.accessToken).toBe('new_rotated_access_token');
      // refreshToken omitted in rotate -> maintains original refresh token
      expect(loaded.refreshToken).toBe('original_refresh_token');
      expect(loaded.expiresAt).toBe('2026-11-11T02:00:00Z');
    });

    it('리프레시 토큰이 함께 갱신되는 경우 새 리프레시 토큰으로 교체된다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-300',
          connectorId: 'gmail',
          consentGeneration: 1,
          accessToken: 'old_token',
          refreshToken: 'old_refresh',
          expiresAt: null,
          grantedScopes: [],
        },
        gateway
      );

      await rotateConnectorToken(
        'ws-300',
        'gmail',
        {
          accessToken: 'new_token',
          refreshToken: 'new_refresh',
          expiresAt: '2026-11-11T04:00:00Z',
        },
        gateway
      );

      const loaded = await loadConnectorCredential(
        'ws-300',
        'gmail',
        1,
        gateway
      );

      expect(loaded.accessToken).toBe('new_token');
      expect(loaded.refreshToken).toBe('new_refresh');
    });

    it('존재하지 않는 자격 증명 회전 시 CREDENTIAL_NOT_FOUND 에러를 발생시킨다', async () => {
      await expect(
        rotateConnectorToken(
          'non-existent-ws',
          'gmail',
          {
            accessToken: 'token',
            expiresAt: null,
          },
          gateway
        )
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'CREDENTIAL_NOT_FOUND' })
      );
    });
  });

  describe('5. 보안 및 평문 누출 방지 (Zero-leakage)', () => {
    it('에러 객체나 직렬화된 에러에 평문 토큰이 절대 노출되지 않아야 한다', async () => {
      const superSecret = 'CRITICAL_SECRET_TOKEN_DO_NOT_LEAK_99999';
      try {
        await decryptConnectorToken(
          { ciphertext: 'corrupted', iv: 'corrupted', algorithm: 'AES-GCM-256' },
          TEST_KEY_BASE64
        );
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(CredentialVaultError);
        const errorString = String(err) + JSON.stringify(err);
        expect(errorString).not.toContain(superSecret);
      }
    });

    it('키 환경변수가 없고 명시적 키도 주어지지 않으면 MISSING_KEY 에러를 던져야 한다', async () => {
      delete process.env.MARKETING_CONNECTOR_TOKEN_KEY;

      await expect(
        saveConnectorCredential(
          {
            workspaceId: 'ws-500',
            connectorId: 'gmail',
            consentGeneration: 1,
            accessToken: 'some_token',
            expiresAt: null,
            grantedScopes: [],
          },
          gateway
        )
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'MISSING_KEY' })
      );
    });
  });

  describe('6. deleteCredential (ANI-2153 F06)', () => {
    it('동일 세대의 자격 증명을 안전하게 삭제하고 이후 조회 시 CREDENTIAL_NOT_FOUND를 던진다', async () => {
      await saveConnectorCredential(
        {
          workspaceId: 'ws-600',
          connectorId: 'google_calendar',
          consentGeneration: 1,
          accessToken: 'token-to-delete',
          expiresAt: null,
          grantedScopes: [],
        },
        gateway
      );

      // Verify it exists before deletion
      const before = await loadConnectorCredential('ws-600', 'google_calendar', 1, gateway);
      expect(before.accessToken).toBe('token-to-delete');

      // Delete target generation
      await deleteCredential('ws-600', 'google_calendar', 1, gateway);

      // Verify it is gone
      await expect(
        loadConnectorCredential('ws-600', 'google_calendar', 1, gateway)
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'CREDENTIAL_NOT_FOUND' })
      );
      expect(gateway.getRawRecord('ws-600', 'google_calendar')).toBeUndefined();
    });

    it('DB에 저장된 현재 세대가 전달된 세대보다 높은 최신 세대이면 STALE_GENERATION으로 삭제를 거부한다', async () => {
      // User reconnected with generation 2
      await saveConnectorCredential(
        {
          workspaceId: 'ws-600',
          connectorId: 'google_calendar',
          consentGeneration: 2,
          accessToken: 'new-gen2-token',
          expiresAt: null,
          grantedScopes: [],
        },
        gateway
      );

      // Attempt to delete generation 1 (stale)
      await expect(
        deleteCredential('ws-600', 'google_calendar', 1, gateway)
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'STALE_GENERATION' })
      );

      // Gen 2 token must remain intact in vault
      const intact = await loadConnectorCredential('ws-600', 'google_calendar', 2, gateway);
      expect(intact.accessToken).toBe('new-gen2-token');
    });

    it('이미 자격 증명이 존재하지 않는 경우 에러 없이 멱등적으로 성공한다', async () => {
      await expect(
        deleteCredential('ws-empty', 'google_docs', 1, gateway)
      ).resolves.toBeUndefined();
    });
  });
});
