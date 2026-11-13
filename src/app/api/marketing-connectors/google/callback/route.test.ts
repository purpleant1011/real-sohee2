import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSupabaseServer = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

const mockSupabaseAdmin = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mockSupabaseServer.createServerSupabaseClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mockSupabaseAdmin.createAdminSupabaseClient,
}));

import { GET } from './route';
import { hashOAuthState } from '@/features/marketing-connectors/oauth/oauth-transaction';

const VALID_WORKSPACE_ID = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';
const VALID_USER_ID = 'user-owner-123';
const VALID_STATE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_CODE = 'google-auth-code-test-123';
const VALID_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-64byteslongsafeverifier';

interface MockCallbackOptions {
  user?: { id: string; email?: string } | null;
  userError?: Error | null;
  memberRow?: { role: string; status: string } | null;
  transactionRow?: any;
  connRow?: any;
}

function setupMockClients(options?: MockCallbackOptions) {
  const user =
    options?.user !== undefined
      ? options.user
      : { id: VALID_USER_ID, email: 'owner@example.com' };
  const userError = options?.userError || null;
  const memberRow =
    options?.memberRow !== undefined
      ? options.memberRow
      : { role: 'owner', status: 'active' };

  const defaultTx = {
    id: 'tx-123',
    workspace_id: VALID_WORKSPACE_ID,
    user_id: VALID_USER_ID,
    provider_id: 'google',
    state_hash: hashOAuthState(VALID_STATE),
    code_verifier: VALID_VERIFIER,
    code_challenge: 'challenge-xyz',
    requested_scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    redirect_uri: 'http://localhost:3000/api/marketing-connectors/google/callback',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    consumed_at: null,
    created_at: new Date().toISOString(),
  };

  const transactionRow =
    options?.transactionRow !== undefined
      ? options.transactionRow
      : defaultTx;

  const mockServerClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: userError,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workspace_members') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                eq: vi.fn().mockImplementation(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: memberRow,
                    error: null,
                  }),
                })),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: memberRow,
                  error: null,
                }),
              })),
              maybeSingle: vi.fn().mockResolvedValue({
                data: memberRow,
                error: null,
              }),
            })),
          }),
        };
      }
      return {};
    }),
  };

  const upsertedConnections: any[] = [];
  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'marketing_connector_oauth_transactions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: transactionRow,
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockImplementation(() => ({
            eq: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                is: vi.fn().mockImplementation(() => ({
                  gt: vi.fn().mockImplementation(() => ({
                    select: vi.fn().mockResolvedValue({
                      data: transactionRow ? [{ id: transactionRow.id }] : [],
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          })),
        };
      }
      if (table === 'marketing_connector_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: options?.connRow !== undefined ? options.connRow : { consent_generation: 1 },
                  error: null,
                }),
              })),
            })),
          }),
          upsert: vi.fn().mockImplementation(async (record: any) => {
            upsertedConnections.push(record);
            return { error: null };
          }),
        };
      }
      return {};
    }),
  };

  mockSupabaseServer.createServerSupabaseClient.mockResolvedValue(mockServerClient);
  mockSupabaseAdmin.createAdminSupabaseClient.mockReturnValue(mockAdminClient);

  return { mockServerClient, mockAdminClient, upsertedConnections };
}

describe('GET /api/marketing-connectors/google/callback', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env = {
      ...originalEnv,
      MARKETING_GOOGLE_CLIENT_ID: 'google-client-id-xyz',
      MARKETING_GOOGLE_CLIENT_SECRET: 'google-client-secret-xyz',
      MARKETING_CONNECTOR_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Error & Query Param Guards', () => {
    it('redirects with error parameter when Google returns OAuth error (e.g. access_denied)', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/marketing-connectors/google/callback?error=access_denied'
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=access_denied');
    });

    it('redirects with INVALID_REQUEST when code or state is missing', async () => {
      const cases = [
        'http://localhost:3000/api/marketing-connectors/google/callback',
        'http://localhost:3000/api/marketing-connectors/google/callback?code=abc',
        'http://localhost:3000/api/marketing-connectors/google/callback?state=xyz',
      ];

      for (const url of cases) {
        const req = new NextRequest(url);
        const res = await GET(req);

        expect(res.status).toBe(307);
        const location = res.headers.get('location');
        expect(location).toContain('/app/connectors?error=INVALID_REQUEST');
      }
    });

    it('redirects with AUTH_REQUIRED when user is not authenticated', async () => {
      setupMockClients({ user: null });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=AUTH_REQUIRED');
    });

    it('redirects with TRANSACTION_NOT_FOUND when state does not match any transaction', async () => {
      setupMockClients({ transactionRow: null });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=TRANSACTION_NOT_FOUND');
    });

    it('redirects with TENANT_MISMATCH when session userId does not match transaction userId', async () => {
      setupMockClients({
        user: { id: 'imposter-user-id' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=TENANT_MISMATCH');
    });

    it('redirects with FORBIDDEN when user has no active manager/owner membership', async () => {
      setupMockClients({
        memberRow: { role: 'staff', status: 'active' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=FORBIDDEN');
    });

    it('redirects with ALREADY_CONSUMED when transaction was already consumed', async () => {
      setupMockClients({
        transactionRow: {
          id: 'tx-123',
          workspace_id: VALID_WORKSPACE_ID,
          user_id: VALID_USER_ID,
          provider_id: 'google',
          state_hash: hashOAuthState(VALID_STATE),
          code_verifier: VALID_VERIFIER,
          code_challenge: 'challenge-xyz',
          requested_scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
          redirect_uri: 'http://localhost:3000/api/marketing-connectors/google/callback',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          consumed_at: new Date().toISOString(), // Already consumed
          created_at: new Date().toISOString(),
        },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=ALREADY_CONSUMED');
    });

    it('redirects with EXPIRED_TRANSACTION when transaction has expired', async () => {
      setupMockClients({
        transactionRow: {
          id: 'tx-123',
          workspace_id: VALID_WORKSPACE_ID,
          user_id: VALID_USER_ID,
          provider_id: 'google',
          state_hash: hashOAuthState(VALID_STATE),
          code_verifier: VALID_VERIFIER,
          code_challenge: 'challenge-xyz',
          requested_scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
          redirect_uri: 'http://localhost:3000/api/marketing-connectors/google/callback',
          expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
          consumed_at: null,
          created_at: new Date().toISOString(),
        },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=EXPIRED_TRANSACTION');
    });

    it('redirects with SERVER_MISCONFIGURED when google credentials are not in env', async () => {
      delete process.env.MARKETING_GOOGLE_CLIENT_SECRET;
      setupMockClients();

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=SERVER_MISCONFIGURED');
    });
  });

  describe('Token Exchange & Connection Upsert', () => {
    it('redirects with TOKEN_EXCHANGE_FAILED when Google token endpoint returns error status', async () => {
      setupMockClients();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=TOKEN_EXCHANGE_FAILED');
    });

    it('redirects with TOKEN_EXCHANGE_FAILED when Google token response has no access_token', async () => {
      setupMockClients();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token_type: 'Bearer' }), // no access_token
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/app/connectors?error=TOKEN_EXCHANGE_FAILED');
    });

    it('successfully exchanges token, encrypts credentials, updates connection, and redirects with connected=google_calendar', async () => {
      const { upsertedConnections } = setupMockClients();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'ya29.sample-google-access-token-12345',
          refresh_token: '1//0sample-google-refresh-token-67890',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
          token_type: 'Bearer',
        }),
      });

      const req = new NextRequest(
        `http://localhost:3000/api/marketing-connectors/google/callback?code=${VALID_CODE}&state=${VALID_STATE}`
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/app/connectors?connected=google_calendar');

      // Verify Google token endpoint was called correctly
      expect(fetchMock).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );
      const fetchBody = fetchMock.mock.calls[0][1].body;
      const params = new URLSearchParams(fetchBody);
      expect(params.get('client_id')).toBe('google-client-id-xyz');
      expect(params.get('client_secret')).toBe('google-client-secret-xyz');
      expect(params.get('code')).toBe(VALID_CODE);
      expect(params.get('code_verifier')).toBe(VALID_VERIFIER);
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('redirect_uri')).toBe(
        'http://localhost:3000/api/marketing-connectors/google/callback'
      );

      // Verify connection ledger upsert
      expect(upsertedConnections).toHaveLength(1);
      const savedConn = upsertedConnections[0];
      expect(savedConn.workspace_id).toBe(VALID_WORKSPACE_ID);
      expect(savedConn.connector_id).toBe('google_calendar');
      expect(savedConn.status).toBe('connected');
      expect(savedConn.consent_generation).toBe(1);
      expect(savedConn.encrypted_credential_ref).toBe('vault:google_calendar:1');
      expect(savedConn.capabilities).toEqual(['calendar_events_read']);
    });
  });
});
