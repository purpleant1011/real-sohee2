import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BookingRecoveryRepository } from '@/features/booking-recovery/repository';
import { reconcileOutboxItem } from '@/features/booking-recovery/reconcile';
import { createDmReconcileDependencies } from '@/features/booking-recovery/dm-reconcile-dependencies';

vi.mock('server-only', () => ({}));
vi.mock('@/features/booking-recovery/dm-reconcile-dependencies', () => ({
  createDmReconcileDependencies: vi.fn(() => ({ loadAttemptedSend: vi.fn(), readbackFetcher: vi.fn() })),
}));
vi.mock('@/features/booking-recovery/reconcile', () => ({
  reconcileOutboxItem: vi.fn().mockResolvedValue({ status: 'RETRY_SCHEDULED' }),
}));
vi.mock('@/features/booking-recovery/production', () => ({ isRecoveryEnabled: vi.fn(() => true) }));
import { NextRequest } from 'next/server';
import { POST } from './route';
import * as adminSupabase from '@/lib/supabase/admin';

describe('Booking Recovery Internal Run Route', () => {
  const cronSecret = 'test_cron_secret_at_least_20_chars_long';

  const env = { ...process.env };
  afterEach(() => { vi.restoreAllMocks(); process.env = { ...env }; });
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = cronSecret;
    process.env.BOOKING_RECOVERY_ENABLED = 'true';
    vi.spyOn(adminSupabase, 'createAdminSupabaseClient').mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      rpc: vi.fn(),
    } as any);
  });

  it('CRON_SECRET이 일치하지 않으면 401을 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/internal/booking-recovery/run', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong_secret' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('기본 OFF일 때 DB 원장에 접근하지 않는다', async () => {
    delete process.env.BOOKING_RECOVERY_ENABLED;
    const res = await POST(new NextRequest('http://localhost/api/internal/booking-recovery/run', {
      method: 'POST', headers: { authorization: `Bearer ${cronSecret}` },
    }));
    expect(await res.json()).toMatchObject({ ok: false, reason: 'disabled' });
    expect(adminSupabase.createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it('원래 outbox에 결속된 production loader를 대사에 전달한다', async () => {
    const admin: any = adminSupabase.createAdminSupabaseClient();
    vi.mocked(adminSupabase.createAdminSupabaseClient).mockClear();
    const item = { id: '11111111-1111-4111-8111-111111111111',
      workspace_id: '22222222-2222-4222-8222-222222222222', case_id: '33333333-3333-4333-8333-333333333333',
      kind: 'SEND_DM', state: 'UNKNOWN', source_event_key: 'original-operation-key', attempt: 1,
      next_attempt_at: '2026-10-21T10:00:00Z', created_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:00:00Z' };
    admin.from().limit.mockResolvedValue({ data: [item], error: null });
    const claim = vi.spyOn(BookingRecoveryRepository.prototype, 'claimOutbox');
    const res = await POST(new NextRequest('http://localhost/api/internal/booking-recovery/run', {
      method: 'POST', headers: { authorization: `Bearer ${cronSecret}` },
    }));
    expect(res.status).toBe(200);
    expect(createDmReconcileDependencies).toHaveBeenCalledWith(expect.any(BookingRecoveryRepository), admin);
    expect(reconcileOutboxItem).toHaveBeenCalledWith(item, expect.objectContaining({ loadAttemptedSend: expect.any(Function) }));
    expect(claim).not.toHaveBeenCalled();
  });

  it('outbox rows가 배열이 아니거나 조회 오류 시 503 fail-closed를 반환한다', async () => {
    const admin: any = adminSupabase.createAdminSupabaseClient();
    admin.from().limit.mockResolvedValueOnce({ data: null, error: null });
    const req = new NextRequest('http://localhost/api/internal/booking-recovery/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('전송 결과 확인 목록 조회 실패');
  });

  it('올바른 Bearer 토큰 인증 시 200과 처리 건수를 반환한다', async () => {
    const req = new NextRequest('http://localhost/api/internal/booking-recovery/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${cronSecret}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.processed).toBe('number');
  });
});
