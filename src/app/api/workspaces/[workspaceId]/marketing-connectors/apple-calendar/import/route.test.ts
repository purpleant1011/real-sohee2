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

  const insertedEvidence: any[] = [];
  const upsertedConnections: any[] = [];

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
      if (table === 'marketing_connector_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(() => ({
              eq: vi.fn().mockImplementation(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: upsertedConnections[0] ?? null,
                  error: null,
                }),
              })),
            })),
          }),
          upsert: vi.fn().mockImplementation(async (row: any) => {
            upsertedConnections.push(row);
            return { error: null };
          }),
        };
      }
      if (table === 'marketing_connector_evidence') {
        return {
          insert: vi.fn().mockImplementation(async (rows: any[]) => {
            insertedEvidence.push(...rows);
            return { error: null };
          }),
        };
      }
      return {};
    }),
  };

  mockSupabaseServer.createServerSupabaseClient.mockResolvedValue(mockServerClient);

  return {
    mockServerClient,
    insertedEvidence,
    upsertedConnections,
  };
}

describe('POST /api/workspaces/[workspaceId]/marketing-connectors/apple-calendar/import (ANI-2171 / A02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValue({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
    });
    setupMockSupabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createRequest(body: any, workspaceId = VALID_WORKSPACE_ID): NextRequest {
    return new NextRequest(
      `https://app.sohee.ai/api/workspaces/${workspaceId}/marketing-connectors/apple-calendar/import`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }
    );
  }

  const validPayload = {
    events: [
      {
        id: 'evt-1',
        title: '신메뉴 프로모션 미팅',
        startsAt: '2026-11-15T10:00:00.000Z',
        endsAt: '2026-11-15T11:00:00.000Z',
        timeZone: 'Asia/Seoul',
      },
    ],
    timeZone: 'Asia/Seoul',
  };

  it('workspaceId가 유효한 UUID 형식이 아니면 400을 반환한다', async () => {
    const req = createRequest(validPayload, 'not-a-uuid');
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: 'not-a-uuid' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_WORKSPACE_ID');
  });

  it('requireWorkspaceMembership 검증에 실패하면 해당 상태 코드를 반환한다', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: '인증이 필요합니다.',
    });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('Supabase 세션 사용자가 없으면 401을 반환한다', async () => {
    setupMockSupabase({ user: null });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('AUTH_REQUIRED');
  });

  it('세션 사용자와 auth.userId가 불일치하면 403을 반환한다', async () => {
    setupMockSupabase({ user: { id: 'different-user' } });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
  });

  it('workspace_members에 멤버가 없거나 비활성 상태이면 403을 반환한다', async () => {
    setupMockSupabase({ memberRow: null });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
  });

  it('workspace_members 역할이 viewer인 경우 403을 반환한다 (owner/manager만 허용)', async () => {
    setupMockSupabase({ memberRow: { role: 'viewer', status: 'active' } });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
  });

  it('body 형식이 유효한 JSON이 아니면 400 INVALID_PAYLOAD를 반환한다', async () => {
    const req = createRequest('{bad json');
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_PAYLOAD');
  });

  it('선택된 이벤트 검증 실패 시 (예: start > end) 400 및 에러 코드를 반환한다', async () => {
    const invalidEventPayload = {
      events: [
        {
          id: 'evt-1',
          title: '시간 역전 이벤트',
          startsAt: '2026-11-15T15:00:00.000Z',
          endsAt: '2026-11-15T10:00:00.000Z',
        },
      ],
    };

    const req = createRequest(invalidEventPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('START_AFTER_END');
  });

  it('owner 권한으로 정상 요청 시 200 OK와 import 요약을 반환한다', async () => {
    const { insertedEvidence, upsertedConnections } = setupMockSupabase({
      memberRow: { role: 'owner', status: 'active' },
    });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sourceId).toMatch(/^apple_cal_[0-9a-f]{16,64}$/);
    expect(body.consentGeneration).toBe(1);
    expect(body.importedCount).toBe(1);
    expect(body.validUntil).toBeDefined();

    expect(insertedEvidence).toHaveLength(1);
    expect(upsertedConnections).toHaveLength(1);
  });

  it('manager 권한으로 정상 요청 시에도 200 OK와 import 요약을 반환한다', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-manager',
      role: 'manager',
    });
    setupMockSupabase({
      user: { id: 'user-manager' },
      memberRow: { role: 'manager', status: 'active' },
    });

    const req = createRequest(validPayload);
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.importedCount).toBe(1);
  });
});
