import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockWorkspaceGuard = vi.hoisted(() => ({
  requireWorkspaceMembership: vi.fn(),
}));

const mockConnectionService = vi.hoisted(() => ({
  loadConnectorHubSnapshot: vi.fn(),
  disconnectMarketingConnector: vi.fn(),
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

vi.mock('@/features/marketing-connectors/server/connection-service', () => ({
  loadConnectorHubSnapshot: mockConnectionService.loadConnectorHubSnapshot,
  disconnectMarketingConnector: mockConnectionService.disconnectMarketingConnector,
  MarketingConnectorError: class MarketingConnectorError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { DELETE, GET } from './route';

describe('GET /api/workspaces/[workspaceId]/marketing-connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'AUTH_REQUIRED',
      message: '인증이 필요합니다.',
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when membership is forbidden', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'WORKSPACE_FORBIDDEN',
      message: '접근 권한이 없습니다.',
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(403);
  });

  it('rejects member/staff role with 403 on GET (owner/manager required)', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-member',
      role: 'member',
      workspaceId: 'ws-1',
    });

    mockSupabaseServer.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'member', status: 'active' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(403);
  });

  it('does not allow demo bypass on sensitive marketing connector route', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'test-user',
      email: 'test@example.com',
      role: 'owner',
      workspaceId: 'ws-target',
    });

    // Mock supabase checking actual DB membership
    mockSupabaseServer.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null, // No actual DB membership!
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-target/marketing-connectors');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-target' }) });

    // Must be blocked because showcase demo account has no real DB membership in ws-target
    expect(res.status).toBe(403);
  });

  it('handles unexpected database throws with generic 500 error response', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    mockSupabaseServer.createServerSupabaseClient.mockImplementationOnce(() => {
      throw new Error('UNEXPECTED_DB_SOCKET_FAIL_SECRET_DETAIL');
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).not.toContain('UNEXPECTED_DB_SOCKET_FAIL_SECRET_DETAIL');
  });

  it('returns 200 with noncacheable snapshot DTO when authorized', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-1',
      email: 'user@example.com',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    mockSupabaseServer.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'owner', status: 'active' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const sampleSnapshot = {
      workspaceId: 'ws-1',
      storageReady: true,
      connections: [],
      pendingDeletions: ['google_calendar'],
    };
    mockConnectionService.loadConnectorHubSnapshot.mockResolvedValueOnce(sampleSnapshot);

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const body = await res.json();
    expect(body.workspaceId).toBe('ws-1');
    expect(body.pendingDeletions).toEqual(['google_calendar']);
  });
});

describe('DELETE /api/workspaces/[workspaceId]/marketing-connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests failing CSRF same-origin check', async () => {
    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors', {
      method: 'DELETE',
      headers: {
        origin: 'http://malicious-site.com',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ connectorId: 'gmail' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
    expect(res.status).toBe(403);
  });

  it('rejects non-owner/manager roles with 403', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-member',
      role: 'member',
      workspaceId: 'ws-1',
    });

    mockSupabaseServer.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'member', status: 'active' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors', {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ connectorId: 'gmail' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
    expect(res.status).toBe(403);
  });

  it('rejects social connector deletion and directs to /app/channels', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    mockSupabaseServer.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'owner', status: 'active' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors', {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ connectorId: 'instagram' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('SOCIAL_CHANNEL_MANAGEMENT_REQUIRED');
  });

  it('validates connectorId and calls disconnectMarketingConnector returning pendingDeletion truth', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    mockSupabaseServer.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: 'owner', status: 'active' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });

    mockConnectionService.disconnectMarketingConnector.mockResolvedValueOnce({
      success: true,
      connectorId: 'google_calendar',
      consentGeneration: 2,
      pendingDeletion: true,
    });

    const req = new NextRequest('http://localhost:3000/api/workspaces/ws-1/marketing-connectors', {
      method: 'DELETE',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ connectorId: 'google_calendar' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.connectorId).toBe('google_calendar');
    expect(body.pendingDeletion).toBe(true);
    expect(body.consentGeneration).toBe(2);
  });
});
