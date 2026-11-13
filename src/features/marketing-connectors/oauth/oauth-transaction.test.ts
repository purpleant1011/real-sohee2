import { describe, it, expect, vi } from 'vitest';
import {
  createMarketingOAuthTransaction,
  consumeMarketingOAuthTransaction,
  generatePkceVerifier,
  computePkceChallenge,
  generateOAuthState,
  hashOAuthState,
  createSupabaseOAuthTransactionGateway,
  OAuthTransactionError,
  type OAuthTransactionRecord,
  type OAuthTransactionGateway,
} from './oauth-transaction';

class InMemoryOAuthTransactionGateway implements OAuthTransactionGateway {
  public records = new Map<string, OAuthTransactionRecord>();

  async saveTransaction(record: OAuthTransactionRecord): Promise<void> {
    this.records.set(record.stateHash, { ...record });
  }

  async findByStateHash(stateHash: string): Promise<OAuthTransactionRecord | null> {
    const item = this.records.get(stateHash);
    return item ? { ...item } : null;
  }

  async consumeAtomic(id: string, stateHash: string, consumedAt: Date): Promise<boolean> {
    const item = this.records.get(stateHash);
    if (!item || item.id !== id) {
      return false;
    }
    if (item.consumedAt !== null) {
      return false;
    }
    if (new Date(item.expiresAt).getTime() <= consumedAt.getTime()) {
      return false;
    }
    item.consumedAt = consumedAt.toISOString();
    this.records.set(stateHash, item);
    return true;
  }
}

describe('F02 OAuth Transaction & PKCE Single-Use (ANI-2149)', () => {
  describe('PKCE and State Cryptographic Utilities', () => {
    it('generates an RFC 7636 compliant PKCE code_verifier (43~128 chars, unreserved set)', () => {
      const verifier = generatePkceVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      // RFC 7636 unreserved: [A-Za-z0-9-._~]
      expect(/^[A-Za-z0-9\-._~]+$/.test(verifier)).toBe(true);
    });

    it('computes S256 code_challenge as base64url SHA-256 without padding', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = computePkceChallenge(verifier);
      // Known RFC 7636 Appendix B test vector:
      // code_verifier = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
      // code_challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      expect(challenge).not.toContain('=');
      expect(challenge).not.toContain('+');
      expect(challenge).not.toContain('/');
    });

    it('generates a 32-byte high-entropy state and matching SHA-256 state_hash', () => {
      const { state, stateHash } = generateOAuthState();
      // 32 bytes hex = 64 hex chars
      expect(state).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(state)).toBe(true);
      expect(stateHash).toHaveLength(64);
      expect(hashOAuthState(state)).toBe(stateHash);
    });
  });

  describe('createMarketingOAuthTransaction', () => {
    it('creates a transaction with 10-minute TTL and persists to gateway', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();
      const fixedNow = new Date('2026-11-11T12:00:00.000Z');

      const result = await createMarketingOAuthTransaction(
        {
          workspaceId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          providerId: 'google',
          requestedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
          redirectUri: 'https://app.real-sohee.com/api/connectors/oauth/callback/google',
          now: fixedNow,
        },
        gateway
      );

      expect(result.state).toBeDefined();
      expect(result.codeVerifier).toBeDefined();
      expect(result.codeChallenge).toBeDefined();
      expect(result.expiresAt).toBe('2026-11-11T12:10:00.000Z');

      const expectedHash = hashOAuthState(result.state);
      const saved = await gateway.findByStateHash(expectedHash);
      expect(saved).not.toBeNull();
      expect(saved?.workspaceId).toBe('11111111-1111-4111-8111-111111111111');
      expect(saved?.userId).toBe('22222222-2222-4222-8222-222222222222');
      expect(saved?.providerId).toBe('google');
      expect(saved?.requestedScopes).toEqual([
        'https://www.googleapis.com/auth/calendar.readonly',
      ]);
      expect(saved?.redirectUri).toBe(
        'https://app.real-sohee.com/api/connectors/oauth/callback/google'
      );
      expect(saved?.consumedAt).toBeNull();
    });

    it('rejects invalid parameters (empty workspaceId or userId)', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();

      await expect(
        createMarketingOAuthTransaction(
          {
            workspaceId: '',
            userId: 'user-1',
            providerId: 'google',
            requestedScopes: [],
            redirectUri: 'https://app.example.com/callback',
          },
          gateway
        )
      ).rejects.toThrow(OAuthTransactionError);

      await expect(
        createMarketingOAuthTransaction(
          {
            workspaceId: 'ws-1',
            userId: '',
            providerId: 'google',
            requestedScopes: [],
            redirectUri: 'https://app.example.com/callback',
          },
          gateway
        )
      ).rejects.toThrow(OAuthTransactionError);
    });
  });

  describe('consumeMarketingOAuthTransaction', () => {
    it('successfully consumes transaction and returns PKCE verifier and scopes', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();
      const fixedNow = new Date('2026-11-11T12:00:00.000Z');
      const consumeNow = new Date('2026-11-11T12:03:00.000Z');

      const created = await createMarketingOAuthTransaction(
        {
          workspaceId: 'ws-test-1',
          userId: 'user-test-1',
          providerId: 'google',
          requestedScopes: ['scope-1', 'scope-2'],
          redirectUri: 'https://app.example.com/callback',
          now: fixedNow,
        },
        gateway
      );

      const consumed = await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-test-1', userId: 'user-test-1' },
        gateway,
        consumeNow
      );

      expect(consumed.codeVerifier).toBe(created.codeVerifier);
      expect(consumed.code_verifier).toBe(created.codeVerifier);
      expect(consumed.requestedScopes).toEqual(['scope-1', 'scope-2']);
      expect(consumed.redirectUri).toBe('https://app.example.com/callback');
      expect(consumed.providerId).toBe('google');

      const record = await gateway.findByStateHash(hashOAuthState(created.state));
      expect(record?.consumedAt).toBe('2026-11-11T12:03:00.000Z');
    });

    it('rejects already consumed transaction with ALREADY_CONSUMED', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();
      const fixedNow = new Date('2026-11-11T12:00:00.000Z');

      const created = await createMarketingOAuthTransaction(
        {
          workspaceId: 'ws-test-1',
          userId: 'user-test-1',
          providerId: 'google',
          requestedScopes: ['scope-1'],
          redirectUri: 'https://app.example.com/callback',
          now: fixedNow,
        },
        gateway
      );

      // First consume succeeds
      await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-test-1', userId: 'user-test-1' },
        gateway,
        new Date('2026-11-11T12:01:00.000Z')
      );

      // Second consume must fail with ALREADY_CONSUMED
      const error = await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-test-1', userId: 'user-test-1' },
        gateway,
        new Date('2026-11-11T12:02:00.000Z')
      ).catch((err) => err);

      expect(error).toBeInstanceOf(OAuthTransactionError);
      expect(error.code).toBe('ALREADY_CONSUMED');
    });

    it('rejects expired transaction with EXPIRED_TRANSACTION', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();
      const fixedNow = new Date('2026-11-11T12:00:00.000Z');
      const expiredNow = new Date('2026-11-11T12:10:01.000Z'); // 1 second past 10m TTL

      const created = await createMarketingOAuthTransaction(
        {
          workspaceId: 'ws-test-1',
          userId: 'user-test-1',
          providerId: 'google',
          requestedScopes: ['scope-1'],
          redirectUri: 'https://app.example.com/callback',
          now: fixedNow,
        },
        gateway
      );

      const error = await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-test-1', userId: 'user-test-1' },
        gateway,
        expiredNow
      ).catch((err) => err);

      expect(error).toBeInstanceOf(OAuthTransactionError);
      expect(error.code).toBe('EXPIRED_TRANSACTION');
    });

    it('rejects session workspace mismatch with TENANT_MISMATCH', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();

      const created = await createMarketingOAuthTransaction(
        {
          workspaceId: 'ws-tenant-alpha',
          userId: 'user-1',
          providerId: 'google',
          requestedScopes: [],
          redirectUri: 'https://app.example.com/callback',
        },
        gateway
      );

      const error = await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-tenant-bravo', userId: 'user-1' },
        gateway
      ).catch((err) => err);

      expect(error).toBeInstanceOf(OAuthTransactionError);
      expect(error.code).toBe('TENANT_MISMATCH');
    });

    it('rejects session user mismatch with TENANT_MISMATCH', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();

      const created = await createMarketingOAuthTransaction(
        {
          workspaceId: 'ws-tenant-alpha',
          userId: 'user-1',
          providerId: 'google',
          requestedScopes: [],
          redirectUri: 'https://app.example.com/callback',
        },
        gateway
      );

      const error = await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-tenant-alpha', userId: 'user-2' },
        gateway
      ).catch((err) => err);

      expect(error).toBeInstanceOf(OAuthTransactionError);
      expect(error.code).toBe('TENANT_MISMATCH');
    });

    it('rejects unknown state with TRANSACTION_NOT_FOUND', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();

      const error = await consumeMarketingOAuthTransaction(
        'non-existent-state-string-0123456789abcdef',
        { workspaceId: 'ws-test-1', userId: 'user-1' },
        gateway
      ).catch((err) => err);

      expect(error).toBeInstanceOf(OAuthTransactionError);
      expect(error.code).toBe('TRANSACTION_NOT_FOUND');
    });

    it('defends against atomic concurrency race condition when update affects 0 rows', async () => {
      const gateway = new InMemoryOAuthTransactionGateway();
      const created = await createMarketingOAuthTransaction(
        {
          workspaceId: 'ws-test-1',
          userId: 'user-test-1',
          providerId: 'google',
          requestedScopes: ['scope-1'],
          redirectUri: 'https://app.example.com/callback',
        },
        gateway
      );

      // Simulate a concurrent consumer winning the race between read and atomic update
      vi.spyOn(gateway, 'consumeAtomic').mockResolvedValueOnce(false);

      const error = await consumeMarketingOAuthTransaction(
        created.state,
        { workspaceId: 'ws-test-1', userId: 'user-test-1' },
        gateway
      ).catch((err) => err);

      expect(error).toBeInstanceOf(OAuthTransactionError);
      expect(error.code).toBe('ALREADY_CONSUMED');
    });
  });

  describe('createSupabaseOAuthTransactionGateway', () => {
    it('implements saveTransaction, findByStateHash, and consumeAtomic correctly', async () => {
      let insertedPayload: any = null;
      const fakeRecordRow = {
        id: 'tx-123',
        workspace_id: 'ws-1',
        user_id: 'u-1',
        provider_id: 'google',
        state_hash: 'state-hash-abc',
        code_verifier: 'verifier-abc',
        code_challenge: 'challenge-abc',
        requested_scopes: ['scope-1'],
        redirect_uri: 'https://app.example.com/callback',
        expires_at: '2026-11-11T12:10:00.000Z',
        consumed_at: null,
        created_at: '2026-11-11T12:00:00.000Z',
      };

      const mockSupabase = {
        from: vi.fn((table: string) => {
          expect(table).toBe('marketing_connector_oauth_transactions');
          return {
            insert: vi.fn(async (payload: any) => {
              insertedPayload = payload;
              return { error: null };
            }),
            select: vi.fn(() => ({
              eq: vi.fn((field: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (field === 'state_hash' && val === 'state-hash-abc') {
                    return { data: fakeRecordRow, error: null };
                  }
                  return { data: null, error: null };
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    gt: vi.fn(() => ({
                      select: vi.fn(async () => ({
                        data: [{ id: 'tx-123' }],
                        error: null,
                      })),
                    })),
                  })),
                })),
              })),
            })),
          };
        }),
      };

      const gateway = createSupabaseOAuthTransactionGateway(mockSupabase);

      // 1. saveTransaction
      await gateway.saveTransaction({
        id: 'tx-123',
        workspaceId: 'ws-1',
        userId: 'u-1',
        providerId: 'google',
        stateHash: 'state-hash-abc',
        codeVerifier: 'verifier-abc',
        codeChallenge: 'challenge-abc',
        requestedScopes: ['scope-1'],
        redirectUri: 'https://app.example.com/callback',
        expiresAt: '2026-11-11T12:10:00.000Z',
        consumedAt: null,
        createdAt: '2026-11-11T12:00:00.000Z',
      });
      expect(insertedPayload.state_hash).toBe('state-hash-abc');

      // 2. findByStateHash
      const found = await gateway.findByStateHash('state-hash-abc');
      expect(found?.workspaceId).toBe('ws-1');
      expect(found?.codeVerifier).toBe('verifier-abc');

      // 3. consumeAtomic
      const success = await gateway.consumeAtomic(
        'tx-123',
        'state-hash-abc',
        new Date('2026-11-11T12:05:00.000Z')
      );
      expect(success).toBe(true);
    });
  });
});
