export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { BookingRecoveryRepository, recoveryOutboxItemSchema } from '@/features/booking-recovery/repository';
import { reconcileOutboxItem } from '@/features/booking-recovery/reconcile';
import { createDmReconcileDependencies } from '@/features/booking-recovery/dm-reconcile-dependencies';
import { isRecoveryEnabled } from '@/features/booking-recovery/production';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization') || '';
    if (!cronSecret || cronSecret.length < 20 || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: '인증 실패' }, { status: 401, headers: NO_STORE });
    }
    if (process.env.BOOKING_RECOVERY_ENABLED !== 'true') {
      return NextResponse.json({ ok: false, reason: 'disabled' }, { headers: NO_STORE });
    }

    const admin = createAdminSupabaseClient() as any;
    const repository = new BookingRecoveryRepository(admin);
    const nowIso = new Date().toISOString();
    // UNKNOWN is deliberately never executable/claimable. Reconcile it directly using read-only evidence.
    // Do not claim PENDING jobs (including customer acceptance jobs) from this readback-only route.
    const { data: rows, error } = await admin.from('booking_recovery_outbox').select('*')
      .eq('kind', 'SEND_DM')
      .or(`state.eq.UNKNOWN,and(state.eq.CLAIMED,lease_until.lt.${nowIso})`)
      .lte('next_attempt_at', nowIso).limit(50);
    if (error || !Array.isArray(rows)) {
      return NextResponse.json({ error: '전송 결과 확인 목록 조회 실패' }, { status: 503, headers: NO_STORE });
    }

    let processedCount = 0;
    const errors: Array<{ workspaceId: string; error: string }> = [];
    for (const row of rows) {
      const parsed = recoveryOutboxItemSchema.safeParse(row);
      if (!parsed.success) continue;
      let item = parsed.data;
      if (!isRecoveryEnabled(item.workspace_id)) continue;
      try {
        if (item.state === 'CLAIMED') {
          // Expired execution leases are sealed UNKNOWN, never taken over for another send.
          const { data: sealed, error: sealError } = await admin.from('booking_recovery_outbox')
            .update({ state: 'UNKNOWN', updated_at: nowIso })
            .eq('workspace_id', item.workspace_id).eq('id', item.id).eq('state', 'CLAIMED')
            .lt('lease_until', nowIso).select('*').maybeSingle();
          if (sealError) throw new Error('UNKNOWN_SEAL_FAILED');
          if (!sealed) continue;
          item = recoveryOutboxItemSchema.parse(sealed);
        }
        await reconcileOutboxItem(item, createDmReconcileDependencies(repository, admin));
        processedCount++;
      } catch {
        errors.push({ workspaceId: item.workspace_id, error: '전송 결과 확인 필요' });
      }
    }
    return NextResponse.json({ ok: errors.length === 0, processed: processedCount,
      errors: errors.length ? errors : undefined }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: '전송 결과 확인 작업 오류' }, { status: 500, headers: NO_STORE });
  }
}
