import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getBusinessVerification } from '@/app/api/auth/business-verification/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

describe('ANI-1442: Carry signup business identity forward + truthful PENDING/VERIFIED/REJECTED UX', () => {
  const mockUserId = 'usr-1111-2222';
  const mockWorkspaceId = 'ws-3333-4444';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Unauthorized') }),
      },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/auth/business-verification');
    const res = await (getBusinessVerification as any)(req);
    expect(res.status).toBe(401);
  });

  it('returns PENDING status with carried-forward business information from business_verifications', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: mockUserId } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ workspace_id: mockWorkspaceId }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'bv-123',
                        workspace_id: mockWorkspaceId,
                        business_number: '1234567890',
                        company_name: '바이름 헤어살롱',
                        representative_name: '홍길동',
                        status: 'PENDING',
                        verified_at: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
        };
      }),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any);

    const req = new NextRequest('http://localhost:3000/api/auth/business-verification');
    const res = await (getBusinessVerification as any)(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.verification.status).toBe('PENDING');
    expect(json.verification.companyName).toBe('바이름 헤어살롱');
    expect(json.verification.businessNumber).toBe('1234567890');
    expect(json.verification.representativeName).toBe('홍길동');
    expect(json.verification.isVerified).toBe(false);
  });

  it('returns VERIFIED status when business verification has been confirmed', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: mockUserId } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ workspace_id: mockWorkspaceId }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'bv-123',
                        workspace_id: mockWorkspaceId,
                        business_number: '1234567890',
                        company_name: '바이름 헤어살롱',
                        representative_name: '홍길동',
                        status: 'VERIFIED',
                        verified_at: '2026-09-14T12:00:00Z',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
        };
      }),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any);

    const req = new NextRequest('http://localhost:3000/api/auth/business-verification');
    const res = await (getBusinessVerification as any)(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.verification.status).toBe('VERIFIED');
    expect(json.verification.isVerified).toBe(true);
    expect(json.verification.verifiedAt).toBe('2026-09-14T12:00:00Z');
  });

  it('returns REJECTED status with rejection message when validation fails', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: mockUserId } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ workspace_id: mockWorkspaceId }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'business_verifications') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'bv-123',
                        workspace_id: mockWorkspaceId,
                        business_number: '1234567890',
                        company_name: '바이름 헤어살롱',
                        representative_name: '홍길동',
                        status: 'REJECTED',
                        verified_at: null,
                        rejection_reason: '국세청 홈택스 상호명 또는 대표자명 불일치 (MISMATCH)',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
        };
      }),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any);

    const req = new NextRequest('http://localhost:3000/api/auth/business-verification');
    const res = await (getBusinessVerification as any)(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.verification.status).toBe('REJECTED');
    expect(json.verification.isVerified).toBe(false);
    expect(json.verification.rejectionReason).toContain('불일치');
  });
});
