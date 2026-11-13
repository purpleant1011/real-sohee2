import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireWorkspaceMembership } from '../workspace-guard';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

describe('Workspace Authorization Guard (ANI-721)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (process.env as any).NODE_ENV = 'test';
    delete process.env.NEXT_PUBLIC_APP_ENV;
  });

  it('1. Returns 401 AUTH_REQUIRED when user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('No session') });

    const result = await requireWorkspaceMembership('ws-target');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe('AUTH_REQUIRED');
    }
  });

  it('2. Blocks ws-default dummy workspace in production with 403', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_APP_ENV = 'production';

    const result = await requireWorkspaceMembership('ws-default');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe('PRODUCTION_DEFAULT_WORKSPACE_PROHIBITED');
    }
  });

  it('3. Isolates showcase demo account (test@example.com) to demo workspace only', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-demo', email: 'test@example.com' } },
      error: null,
    });

    const result = await requireWorkspaceMembership('ws-real-customer-123');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe('SHOWCASE_DEMO_ISOLATED');
    }
  });

  it('4. Allows showcase demo account access to demo workspace', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-demo', email: 'test@example.com' } },
      error: null,
    });

    const result = await requireWorkspaceMembership('ws-demo-byreum');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe('ws-demo-byreum');
      expect(result.role).toBe('owner');
    }
  });

  it('5. Denies access (403 WORKSPACE_FORBIDDEN) when user is not a member or owner', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-attacker', email: 'attacker@store.com' } },
      error: null,
    });

    // workspace_members query returns null
    const membersSelectMock = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
    };

    // workspaces owner query returns null
    const workspacesSelectMock = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_members') return { select: () => membersSelectMock };
      if (table === 'workspaces') return { select: () => workspacesSelectMock };
      return { select: () => ({ eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() }) };
    });

    const result = await requireWorkspaceMembership('ws-victim-123');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe('WORKSPACE_FORBIDDEN');
    }
  });

  it('6. Grants access when user is an active member', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-member', email: 'member@store.com' } },
      error: null,
    });

    const membersSelectMock = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValueOnce({
        data: { workspace_id: 'ws-valid', role: 'admin', status: 'active' },
        error: null,
      }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_members') return { select: () => membersSelectMock };
      return { select: () => ({ eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() }) };
    });

    const result = await requireWorkspaceMembership('ws-valid');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe('ws-valid');
      expect(result.role).toBe('admin');
      expect(result.userId).toBe('usr-member');
    }
  });
});
