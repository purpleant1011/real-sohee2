export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  const auth = await requireWorkspaceMembership(workspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, message: auth.message },
      { status: auth.status }
    );
  }

  try {
    const body = await request.json();
    const rawAmount = body.amount ?? body.energyAmount;
    const amount = typeof rawAmount === 'number' ? Math.ceil(rawAmount) : 0;
    const runId = body.runId || body.missionId || `run_${Date.now()}`;
    const actionType = body.actionType || 'MARKETING_ACTION';

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'INVALID_AMOUNT', message: '예약할 에너지 수량은 0보다 커야 합니다.' },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabaseClient();

    // 1. Fetch current ledger
    const { data: ledger, error: fetchError } = await (supabase as any)
      .from('agent_energy_ledgers')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (fetchError || !ledger) {
      return NextResponse.json(
        { error: 'LEDGER_NOT_FOUND', message: '작업공간의 에너지 원장을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const total = ledger.monthly_total_energy;
    const used = ledger.used_energy_current_month;
    const reserved = ledger.reserved_energy_active_runs;
    const available = Math.max(0, total - (used + reserved));

    // 2. Fail-Closed Boundary Check (ANI-705, ANI-722)
    if (available < amount) {
      return NextResponse.json(
        {
          error: 'ENERGY_EXHAUSTED',
          message: `Agent Energy가 부족합니다. (필요: ${amount}, 잔여: ${available})`,
          remainingAvailable: available,
          requiredAmount: amount,
          budgetAlertStage: 'EXHAUSTED',
        },
        { status: 402 }
      );
    }

    // 3. Create Reservation
    const reservationId = `resv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newReserved = reserved + amount;
    const newAvailable = Math.max(0, total - (used + newReserved));
    const burnRatePercentage = Math.min(100, Math.round(((used + newReserved) / total) * 100));

    let budgetAlertStage = 'NORMAL';
    if (burnRatePercentage >= 100) budgetAlertStage = 'EXHAUSTED';
    else if (burnRatePercentage >= 95) budgetAlertStage = 'STAGE_95_RESTRICT';
    else if (burnRatePercentage >= 85) budgetAlertStage = 'STAGE_85_DEFER';
    else if (burnRatePercentage >= 70) budgetAlertStage = 'STAGE_70_OPTIMIZE';

    // Update ledger atomically
    const { error: updateError } = await (supabase as any)
      .from('agent_energy_ledgers')
      .update({
        reserved_energy_active_runs: newReserved,
        remaining_available_energy: newAvailable,
        burn_rate_percentage: burnRatePercentage,
        budget_alert_stage: budgetAlertStage,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    if (updateError) {
      console.error('[agent/energy/reserve] Update error:', updateError);
      return NextResponse.json(
        { error: 'RESERVATION_UPDATE_FAILED', message: '에너지 예약 처리 중 데이터베이스 갱신에 실패했습니다.' },
        { status: 500 }
      );
    }

    // Insert reservation record if table exists
    try {
      await (supabase as any).from('agent_energy_reservations').insert({
        reservation_id: reservationId,
        workspace_id: workspaceId,
        run_id: runId,
        action_type: actionType,
        amount,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
      });
    } catch {
      // Non-blocking if table is optional
    }

    return NextResponse.json({
      success: true,
      reservationId,
      reservedAmount: amount,
      remainingAvailable: newAvailable,
      budgetAlertStage,
      burnRatePercentage,
    }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Reservation failed';
    return NextResponse.json({ error: 'SERVER_ERROR', message }, { status: 500 });
  }
}
