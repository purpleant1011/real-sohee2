import { describe, expect, it, vi, beforeEach } from 'vitest';
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

const mockGoogleSources = vi.hoisted(() => ({
  listGoogleCalendars: vi.fn(),
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

vi.mock(
  '@/features/marketing-connectors/adapters/google-calendar-sources',
  () => ({
    listGoogleCalendars: mockGoogleSources.listGoogleCalendars,
  })
);

import { GET, POST } from './route';

const VALID_WORKSPACE_ID = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';

interface MockSupabaseOptions {
  user?: { id: string; email?: string } | null;
  userError?: Error | null;
  memberRow?: { role: string; status: string } | null;
  connectionRow?: { status: string; consent_generation: number } | null;
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
  const connectionRow =
    options?.connectionRow !== undefined
      ? options.connectionRow
      : { status: 'connected', consent_generation: 1 };

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

  const updatedConnections: any[] = [];
  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'marketing_connector_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: connectionRow,
                  error: null,
                }),
              })),
              maybeSingle: vi.fn().mockResolvedValue({
                data: connectionRow,
                error: null,
              }),
            })),
          }),
          update: vi.fn().mockImplementation((payload: any) => ({
            eq: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(async () => {
                updatedConnections.push(payload);
                return { error: null };
              }),
            })),
          })),
        };
      }
      return {};
    }),
  };

  mockSupabaseServer.createServerSupabaseClient.mockResolvedValue(mockServerClient);
  mockSupabaseAdmin.createAdminSupabaseClient.mockReturnValue(mockAdminClient);

  return { mockServerClient, mockAdminClient, updatedConnections };
}

describe('GET & POST /api/workspaces/[workspaceId]/marketing-connectors/google/calendars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET (Fetch available calendars)', () => {
    it('returns 400 for invalid workspaceId', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/workspaces/invalid-id/marketing-connectors/google/calendars'
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: 'invalid-id' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('INVALID_WORKSPACE_ID');
    });

    it('returns 401 when auth fails', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 when user is not owner or manager', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-staff',
        role: 'staff',
        workspaceId: VALID_WORKSPACE_ID,
      });
      setupMockSupabase({
        user: { id: 'user-staff' },
        memberRow: { role: 'staff', status: 'active' },
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when connector connection is not found', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });
      setupMockSupabase({
        connectionRow: null,
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('CONNECTOR_NOT_FOUND');
    });

    it('returns 200 with calendars list when adapter succeeds', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });
      setupMockSupabase();

      mockGoogleSources.listGoogleCalendars.mockResolvedValueOnce({
        ok: true,
        derivedFromGoogle: true,
        data: [
          {
            id: 'owner@example.com',
            summary: '내 캘린더',
            primary: true,
            timeZone: 'Asia/Seoul',
          },
          {
            id: 'marketing_team@group.calendar.google.com',
            summary: '마케팅 일정',
            primary: false,
            timeZone: 'Asia/Seoul',
          },
        ],
      });

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`
      );
      const res = await GET(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.calendars).toHaveLength(2);
      expect(body.calendars[0].id).toBe('owner@example.com');
      expect(body.calendars[0].primary).toBe(true);
      expect(body.calendars[1].id).toBe('marketing_team@group.calendar.google.com');
      expect(body.calendars[1].primary).toBe(false);
    });
  });

  describe('POST (Save selected calendars with consent grant)', () => {
    it('returns 400 when selectedCalendarIds is missing or empty', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });
      setupMockSupabase();

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`,
        {
          method: 'POST',
          body: JSON.stringify({ selectedCalendarIds: [] }),
        }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('SELECTED_CALENDARS_REQUIRED');
    });

    it('rejects "primary" literal calendar ID to enforce explicit selection', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });
      setupMockSupabase();

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`,
        {
          method: 'POST',
          body: JSON.stringify({ selectedCalendarIds: ['primary'] }),
        }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('EXPLICIT_CHOICE_REQUIRED');
    });

    it('saves consent grant and updates connection generation on valid selection', async () => {
      mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: VALID_WORKSPACE_ID,
      });
      const { updatedConnections } = setupMockSupabase({
        connectionRow: { status: 'connected', consent_generation: 1 },
      });

      const selectedIds = [
        'owner@example.com',
        'c_1234567890@group.calendar.google.com',
      ];

      const req = new NextRequest(
        `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/calendars`,
        {
          method: 'POST',
          body: JSON.stringify({
            selectedCalendarIds: selectedIds,
            aiProcessingApproved: true,
          }),
        }
      );
      const res = await POST(req, {
        params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.consent).toBeDefined();
      expect(body.consent.allowedSourceIds).toEqual(selectedIds);
      expect(body.consent.aiProcessingApproved).toBe(true);
      expect(body.consent.consentGeneration).toBe(2);

      expect(updatedConnections).toHaveLength(1);
      expect(updatedConnections[0].consent_generation).toBe(2);
    });
  });
});
