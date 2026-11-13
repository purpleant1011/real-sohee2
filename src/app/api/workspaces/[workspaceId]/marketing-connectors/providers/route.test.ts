import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockWorkspaceGuard = vi.hoisted(() => ({
  requireWorkspaceMembership: vi.fn(),
}));

const mockSupabaseServer = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: mockWorkspaceGuard.requireWorkspaceMembership,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mockSupabaseServer.createServerSupabaseClient,
}));

import { GET } from './route';

const VALID_WORKSPACE_ID = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';
const ANOTHER_WORKSPACE_ID = '7c2e819b-63a5-4f32-8491-0bcde1234567';

interface MockSupabaseOptions {
  user?: { id: string; email?: string } | null;
  userError?: Error | null;
  memberRow?: { role: string; status: string } | null;
  memberError?: Error | null;
  throwOnMemberQuery?: Error;
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

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: userError,
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'workspace_members' && options?.throwOnMemberQuery) {
        throw options.throwOnMemberQuery;
      }
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
    }),
  };

  mockSupabaseServer.createServerSupabaseClient.mockResolvedValue(mockClient);
  return mockClient;
}

describe('GET /api/workspaces/[workspaceId]/marketing-connectors/providers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Validation & Authorization Guard (400, 401, 403, 500)', () => {
    it('returns 400 when workspaceId is not a valid UUID', async () => {
      const invalidWorkspaceIds = [
        'invalid-uuid',
        'ws-12345',
        '123e4567-e89b-12d3-a456-notvaliduuid',
        '../../../etc/passwd',
      ];

      for (const invalidId of invalidWorkspaceIds) {
        const req = new NextRequest(
          `http://localhost:3000/api/workspaces/${invalidId}/marketing-connectors/providers`
        );
        const res = await GET(req, {
          params: Promise.resolve({ workspaceId: invalidId }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body).toHaveProperty('error');
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
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when guard succeeds but auth.getUser returns no user or userError', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: null,
        userError: new Error('Session expired or revoked'),
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 403 when guard succeeds but current auth.getUser user ID mismatches guard user ID', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-guard-id',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'different-session-user-id', email: 'imposter@example.com' },
        memberRow: { role: 'owner', status: 'active' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    it('returns 403 when guard fails with WORKSPACE_FORBIDDEN', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '접근 권한이 없습니다.',
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 when user has no real membership row in workspace_members (different tenant)', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-external',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'user-external' },
        memberRow: null, // No membership in this workspace
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 403 when user is disabled or suspended in workspace_members', async () => {
      const disabledStatuses = ['disabled', 'suspended', 'invited', 'pending'];

      for (const status of disabledStatuses) {
        mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
          ok: true,
          userId: 'user-disabled',
          role: 'owner',
          workspaceId: VALID_WORKSPACE_ID,
        });

        setupMockSupabase({
          user: { id: 'user-disabled' },
          memberRow: { role: 'owner', status },
        });

        const req = new NextRequest(
          `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
        );
        const res = await GET(req, {
          params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
        });

        expect(res.status).toBe(403);
      }
    });

    it('returns 403 when role is not owner or manager (scope role restriction: staff/member)', async () => {
      const forbiddenRoles = ['member', 'staff', 'viewer', 'guest'];

      for (const role of forbiddenRoles) {
        mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
          ok: true,
          userId: 'user-low-role',
          role,
          workspaceId: VALID_WORKSPACE_ID,
        });

        setupMockSupabase({
          user: { id: 'user-low-role' },
          memberRow: { role, status: 'active' },
        });

        const req = new NextRequest(
          `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
        );
        const res = await GET(req, {
          params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
        });

        expect(res.status).toBe(403);
      }
    });

    it('returns 403 when demo account attempts bypass without actual DB membership in target workspace', async () => {
      // Guard might return ok for showcase demo bypass if not carefully configured
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'demo-user',
        email: 'test@example.com',
        role: 'owner',
        workspaceId: ANOTHER_WORKSPACE_ID,
      });

      setupMockSupabase({
        user: { id: 'demo-user', email: 'test@example.com' },
        memberRow: null, // No real membership in ANOTHER_WORKSPACE_ID!
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${ANOTHER_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: ANOTHER_WORKSPACE_ID }),
      });

      expect(res.status).toBe(403);
      expect(mockWorkspaceGuard.requireWorkspaceMembership).toHaveBeenCalledWith(
        ANOTHER_WORKSPACE_ID,
        expect.objectContaining({ allowDemoBypass: false })
      );
    });

    it('returns 500 when database throws unexpected exception and does not leak internal error details', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });

      const SECRET_DB_HOST = 'secret-postgres-primary.internal.local:5432';
      setupMockSupabase({
        user: { id: 'user-owner' },
        throwOnMemberQuery: new Error(`Connection timeout to ${SECRET_DB_HOST}`),
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('INTERNAL_SERVER_ERROR');
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(SECRET_DB_HOST);
    });
  });

  describe('Authorized Access (200 OK) & Provider Behaviors', () => {
    it('returns 200 with Cache-Control no-store and 4 providers for active owner', async () => {
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
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);

      const cacheControl = res.headers.get('Cache-Control');
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain('no-store');

      const body = await res.json();
      expect(body.workspaceId).toBe(VALID_WORKSPACE_ID);
      expect(Array.isArray(body.providers)).toBe(true);
      expect(body.providers).toHaveLength(4);

      // Verify all 4 providers are not connectable (canConnect === false)
      for (const provider of body.providers) {
        expect(provider.canConnect).toBe(false);
      }

      // Behavioral assertions on each provider
      const google = body.providers.find((p: any) => p.providerId === 'google');
      expect(google).toBeDefined();
      expect(google.method).toBe('oauth');
      expect(google.canConnect).toBe(false);

      const microsoft = body.providers.find((p: any) => p.providerId === 'microsoft');
      expect(microsoft).toBeDefined();
      expect(microsoft.method).toBe('oauth');
      expect(microsoft.canConnect).toBe(false);

      const meta = body.providers.find((p: any) => p.providerId === 'meta');
      expect(meta).toBeDefined();
      expect(meta.method).toBe('existing');
      expect(meta.canConnect).toBe(false);
      expect(meta.managementHref).toBe('/app/channels');

      const apple = body.providers.find((p: any) => p.providerId === 'apple');
      expect(apple).toBeDefined();
      expect(apple.method).toBe('import');
      expect(apple.canConnect).toBe(false);
    });

    it('returns 200 with Cache-Control no-store for active manager', async () => {
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
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('no-store');

      const body = await res.json();
      expect(body.workspaceId).toBe(VALID_WORKSPACE_ID);
      expect(body.providers).toHaveLength(4);
    });
  });

  describe('Secret Fixture & Environment Isolation', () => {
    it('does not leak injected env secrets or tokens into response body or messages', async () => {
      const TEST_GOOGLE_SECRET = 'super-secret-google-client-secret-fixture-98765';
      const TEST_MS_SECRET = 'ultra-secret-microsoft-client-secret-fixture-43210';
      const TEST_TOKEN_KEY = 'high-entropy-marketing-token-key-fixture-55555';

      process.env.MARKETING_GOOGLE_CLIENT_SECRET = TEST_GOOGLE_SECRET;
      process.env.MARKETING_MICROSOFT_CLIENT_SECRET = TEST_MS_SECRET;
      process.env.MARKETING_CONNECTOR_TOKEN_KEY = TEST_TOKEN_KEY;

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
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/providers`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const stringifiedBody = JSON.stringify(body);

      expect(stringifiedBody).not.toContain(TEST_GOOGLE_SECRET);
      expect(stringifiedBody).not.toContain(TEST_MS_SECRET);
      expect(stringifiedBody).not.toContain(TEST_TOKEN_KEY);
    });
  });
});
