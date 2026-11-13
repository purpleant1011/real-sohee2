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

const mockPickerService = vi.hoisted(() => ({
  verifyAndRegisterDriveFiles: vi.fn(),
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
  '@/features/marketing-connectors/picker/google-picker-service',
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/features/marketing-connectors/picker/google-picker-service')>();
    return {
      ...actual,
      verifyAndRegisterDriveFiles: mockPickerService.verifyAndRegisterDriveFiles,
    };
  }
);

import { POST } from './route';

const VALID_WORKSPACE_ID = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';

interface MockSupabaseOptions {
  user?: { id: string; email?: string } | null;
  userError?: Error | null;
  memberRow?: { role: string; status: string } | null;
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

  const mockAdminClient = {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockImplementation(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { consent_generation: 1 },
              error: null,
            }),
          })),
        })),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      }),
    })),
  };

  mockSupabaseServer.createServerSupabaseClient.mockResolvedValue(mockServerClient);
  mockSupabaseAdmin.createAdminSupabaseClient.mockReturnValue(mockAdminClient);

  return { mockServerClient, mockAdminClient };
}

describe('POST /api/workspaces/[workspaceId]/marketing-connectors/google/drive/files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid workspaceId format', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/workspaces/invalid-id/marketing-connectors/google/drive/files',
      {
        method: 'POST',
        body: JSON.stringify({ fileIds: ['doc-1'] }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: 'invalid-id' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_WORKSPACE_ID');
  });

  it('returns 401 when workspace membership auth fails', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'AUTH_REQUIRED',
      message: '인증이 필요합니다.',
    });

    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: JSON.stringify({ fileIds: ['doc-1'] }),
      }
    );
    const res = await POST(req, {
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
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: JSON.stringify({ fileIds: ['doc-1'] }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
  });

  it('returns 400 when body is invalid JSON', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: VALID_WORKSPACE_ID,
    });
    setupMockSupabase();

    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: 'not-a-valid-json',
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_JSON');
  });

  it('returns 400 when fileIds is missing or empty', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: VALID_WORKSPACE_ID,
    });
    setupMockSupabase();

    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: JSON.stringify({ fileIds: [] }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('FILE_IDS_REQUIRED');
  });

  it('returns 200 with registered files and consent when verification succeeds', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: VALID_WORKSPACE_ID,
    });
    setupMockSupabase();

    const verifiedFiles = [
      {
        id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
        name: '소희 매뉴얼',
        mimeType: 'application/vnd.google-apps.document',
        trashed: false,
      },
      {
        id: '1qpyC0XzvTcKT6EISywvqESX3A0MwQoTL8LesTBUVPXw',
        name: '가격표',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        trashed: false,
      },
    ];

    const consentRecord = {
      workspaceId: VALID_WORKSPACE_ID,
      connectorId: 'google_drive',
      consentGeneration: 1,
      allowedSourceIds: verifiedFiles.map((f) => f.id),
      purpose: 'marketing',
      validUntil: '2026-12-11T00:00:00.000Z',
      aiProcessingApproved: true,
      status: 'active',
      updatedAt: '2026-11-11T00:00:00.000Z',
      updatedBy: 'user-owner',
    };

    mockPickerService.verifyAndRegisterDriveFiles.mockResolvedValueOnce({
      ok: true,
      files: verifiedFiles,
      consent: consentRecord,
    });

    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: JSON.stringify({
          fileIds: verifiedFiles.map((f) => f.id),
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
    expect(body.files).toHaveLength(2);
    expect(body.consent.allowedSourceIds).toHaveLength(2);
    expect(mockPickerService.verifyAndRegisterDriveFiles).toHaveBeenCalledTimes(1);
    expect(mockPickerService.verifyAndRegisterDriveFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: VALID_WORKSPACE_ID,
        actorUserId: 'user-owner',
        fileIds: verifiedFiles.map((f) => f.id),
        aiProcessingApproved: true,
      }),
      expect.anything()
    );
  });

  it('maps GoogleDrivePickerError correctly to HTTP response with status and code', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: VALID_WORKSPACE_ID,
    });
    setupMockSupabase();

    const { GoogleDrivePickerError } = await import(
      '@/features/marketing-connectors/picker/google-picker-service'
    );

    mockPickerService.verifyAndRegisterDriveFiles.mockRejectedValueOnce(
      new GoogleDrivePickerError(
        'UNSUPPORTED_MIME_TYPE',
        '지원되지 않는 파일 형식입니다',
        { status: 400, fileId: 'doc-pdf' }
      )
    );

    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: JSON.stringify({ fileIds: ['doc-pdf'] }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('UNSUPPORTED_MIME_TYPE');
    expect(body.fileId).toBe('doc-pdf');
  });

  it('handles unexpected internal errors with 500 status', async () => {
    mockWorkspaceGuard.requireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'user-owner',
      role: 'owner',
      workspaceId: VALID_WORKSPACE_ID,
    });
    setupMockSupabase();

    mockPickerService.verifyAndRegisterDriveFiles.mockRejectedValueOnce(
      new Error('Unexpected database failure')
    );

    const req = new NextRequest(
      `http://localhost:3000/api/workspaces/${VALID_WORKSPACE_ID}/marketing-connectors/google/drive/files`,
      {
        method: 'POST',
        body: JSON.stringify({ fileIds: ['doc-1'] }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ workspaceId: VALID_WORKSPACE_ID }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('INTERNAL_SERVER_ERROR');
  });
});
