import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockWorkspaceGuard = vi.hoisted(() => ({
  requireWorkspaceMembership: vi.fn(),
}));

const mockSupabaseServer = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

const mockSupabaseAdmin = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mockWorkspaceGuard.requireWorkspaceMembership,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mockSupabaseServer.createServerSupabaseClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mockSupabaseAdmin.createAdminSupabaseClient,
}));

import { POST } from './route';

const VALID_WORKSPACE_ID = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';

interface MockSupabaseOptions {
  user?: { id: string; email?: string } | null;
  userError?: Error | null;
  memberRow?: { role: string; status: string } | null;
  memberError?: Error | null;
}

function setupMockSupabase(options?: MockSupabaseOptions) {
  const user =
    options?.user !== undefined
      ? options.user
      : { id: 'user-owner', email: 'owner@example.com' };
  const userError = options?.userError || null;
  const memberRow =
    options?.memberRow !== undefined
      ? options.memberRow
      : { role: 'owner', status: 'active' };
  const memberError = options?.memberError || null;

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
                    error: memberError,
                  }),
                })),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: memberRow,
                  error: memberError,
                }),
              })),
              maybeSingle: vi.fn().mockResolvedValue({
                data: memberRow,
                error: memberError,
              }),
            })),
          }),
        };
      }
      return {};
    }),
  };

  const insertedTransactions: any[] = [];
  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'marketing_connector_oauth_transactions') {
        return {
          insert: vi.fn().mockImplementation(async (record: any) => {
            insertedTransactions.push(record);
            return { error: null };
          }),
        };
      }
      return {};
    }),
  };

  mockSupabaseServer.createServerSupabaseClient.mockResolvedValue(mockServerClient);
  mockSupabaseAdmin.createAdminSupabaseClient.mockReturnValue(mockAdminClient);

  return { mockServerClient, mockAdminClient, insertedTransactions };
}

describe('POST /api/workspaces/[workspaceId]/marketing-connectors/google/authorize', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      MARKETING_GOOGLE_CLIENT_ID: 'google-client-id-xyz',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Validation & Authorization Guard (400, 401, 403, 500)', () => {
    it('returns 400 when workspaceId is not a valid UUID', async () => {
      const invalidIds = ['invalid-uuid', '123', 'not-a-uuid'];
      for (const invalidId of invalidIds) {
        const req = new NextRequest(
          `http://localhost:3000/api/workspaces/${invalidId}/marketing-connectors/google/authorize`,
          { method: 'POST' }
        );
        const res = await POST(req, {
          params: Promise.resolve({ workspaceId: invalidId }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('INVALID_WORKSPACE_ID');
      }
    });

    it('returns 401 when workspace membership guard returns AUTH_REQUIRED', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when getUser fails or returns null', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: null,
        userError: new Error('Session invalid'),
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('AUTH_REQUIRED');
    });

    it('returns 403 when session user does not match guard userId', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'imposter-user' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('FORBIDDEN');
    });

    it('returns 403 when user has no active membership row in workspace_members', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'user-owner' },
        memberRow: null,
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('FORBIDDEN');
    });

    it('returns 403 when user role is staff or member (not owner/manager)', async () => {
      for (const role of ['staff', 'member', 'viewer']) {
        mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
          ok: true,
          userId: 'user-staff',
          role,
          workspaceId: VALID_WORKSPACE_ID,
        });

        setupMockSupabase({
          user: { id: 'user-staff' },
          memberRow: { role, status: 'active' },
        });

        const req = new NextRequest(
          `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
          { method: 'POST' }
        );
        const res = await POST(req, {
          params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe('FORBIDDEN');
      }
    });

    it('returns 500 when MARKETING_GOOGLE_CLIENT_ID is not configured', async () => {
      delete process.env.MARKETING_GOOGLE_CLIENT_ID;

      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'user-owner' },
        memberRow: { role: 'owner', status: 'active' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('SERVER_MISCONFIGURED');
    });
  });

  describe('Successful Authorize URL Generation (200 OK)', () => {
    it('returns 200 with authorize URL and state for active owner', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      const { insertedTransactions } = setupMockSupabase({
        user: { id: 'user-owner' },
        memberRow: { role: 'owner', status: 'active' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('no-store');

      const body = await res.json();
      expect(body).toHaveProperty('authorizeUrl');
      expect(body).toHaveProperty('state');

      const parsedUrl = new URL(body.authorizeUrl);
      expect(parsedUrl.origin).toBe('https://accounts.google.com');
      expect(parsedUrl.pathname).toBe('/o/oauth2/v2/auth');
      expect(parsedUrl.searchParams.get('client_id')).toBe('google-client-id-xyz');
      expect(parsedUrl.searchParams.get('response_type')).toBe('code');
      expect(parsedUrl.searchParams.get('access_type')).toBe('offline');
      expect(parsedUrl.searchParams.get('prompt')).toBe('consent');
      expect(parsedUrl.searchParams.get('scope')).toBe(
        'https://www.googleapis.com/auth/calendar.events.readonly'
      );
      expect(parsedUrl.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/marketing-connectors/google/callback'
      );
      expect(parsedUrl.searchParams.get('code_challenge')).toBeTruthy();
      expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsedUrl.searchParams.get('state')).toBe(body.state);

      // Verify OAuth transaction was persisted via gateway
      expect(insertedTransactions).toHaveLength(1);
      expect(insertedTransactions[0].workspace_id).toBe(VALID_WORKSPACE_ID);
      expect(insertedTransactions[0].user_id).toBe('user-owner');
      expect(insertedTransactions[0].provider_id).toBe('google');
      expect(insertedTransactions[0].requested_scopes).toEqual([
        'https://www.googleapis.com/auth/calendar.events.readonly',
      ]);
    });

    it('returns 200 for active manager as well', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-manager',
        role: 'manager',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'user-manager' },
        memberRow: { role: 'manager', status: 'active' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/authorize`,
        { method: 'POST' }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authorizeUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });
  });
});
