import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET as getCases, POST as postCases } from '../cases/route';
import { GET as getCase } from '../cases/[caseId]/route';
import { POST as postCommands } from '../cases/[caseId]/commands/route';
import * as routeAuth from '@/features/quick-start/route-auth';

describe('Booking Recovery API Routes', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const caseId = '22222222-2222-4222-8222-222222222222';

  let mockAdmin: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.BOOKING_RECOVERY_ENABLED = 'true';
    process.env.BOOKING_RECOVERY_WORKSPACE_ALLOWLIST = '*';
    mockAdmin = {
      from: vi.fn(),
      rpc: vi.fn(),
    };
  });

  it('기능 게이트가 OFF이면 403으로 거부된다 (NODE_ENV 우회 없음)', async () => {
    process.env.BOOKING_RECOVERY_ENABLED = 'false';
    vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
      workspaceId,
      userId: '33333333-3333-4333-8333-333333333333',
      role: 'owner',
      admin: mockAdmin,
    } as any);

    const req = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/booking-recovery/cases`);
    const res = await getCases(req, { params: Promise.resolve({ workspaceId }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('비활성화');
  });

  it('권한이 없는 익명/일반 멤버는 403으로 거부된다', async () => {
    vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue(
      NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 }) as any
    );

    const req = new NextRequest(`http://localhost/api/workspaces/${workspaceId}/booking-recovery/cases`);
    const res = await getCases(req, { params: Promise.resolve({ workspaceId }) });

    expect(res.status).toBe(403);
  });

  it('클라이언트가 body에 actorId를 주입하면 422 검증 오류를 반환한다', async () => {
    vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
      workspaceId,
      userId: '33333333-3333-4333-8333-333333333333',
      role: 'owner',
      admin: mockAdmin,
    } as any);

    const req = new NextRequest(
      `http://localhost/api/workspaces/${workspaceId}/booking-recovery/cases/${caseId}/commands`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'approve_send',
          expectedVersion: 1,
          fingerprint: 'a'.repeat(64),
          actorId: 'injected-actor-id',
        }),
      }
    );

    const res = await postCommands(req, {
      params: Promise.resolve({ workspaceId, caseId }),
    });

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it('다른 workspace의 case는 404를 반환한다', async () => {
    vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
      workspaceId,
      userId: '33333333-3333-4333-8333-333333333333',
      role: 'owner',
      admin: mockAdmin,
    } as any);

    // mock case lookup returns null
    mockAdmin.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const req = new NextRequest(
      `http://localhost/api/workspaces/${workspaceId}/booking-recovery/cases/${caseId}`
    );
    const res = await getCase(req, {
      params: Promise.resolve({ workspaceId, caseId }),
    });

    expect(res.status).toBe(404);
  });
});
