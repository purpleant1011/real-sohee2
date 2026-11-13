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
    const { reservationId, actualSpent = 0, runId, receiptId } = body;
    const spentAmount = typeof actualSpent === 'number' ? Math.max(0, Math.ceil(actualSpent)) : 0;

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
    const prevUsed = ledger.used_energy_current_month;
    const prevReserved = ledger.reserved_energy_active_runs;

    // Release reservation amount (at least spentAmount, or whatever was reserved)
    const newReserved = Math.max(0, prevReserved - spentAmount);
    const newUsed = prevUsed + spentAmount;
    const newAvailable = Math.max(0, total - (newUsed + newReserved));
    const burnRatePercentage = Math.min(100, Math.round(((newUsed + newReserved) / total) * 100));

    let budgetAlertStage = 'NORMAL';
    if (burnRatePercentage >= 100) budgetAlertStage = 'EXHAUSTED';
    else if (burnRatePercentage >= 95) budgetAlertStage = 'STAGE_95_RESTRICT';
    else if (burnRatePercentage >= 85) budgetAlertStage = 'STAGE_85_DEFER';
    else if (burnRatePercentage >= 70) budgetAlertStage = 'STAGE_70_OPTIMIZE';

    // 2. Update ledger atomically
    const { error: updateError } = await (supabase as any)
      .from('agent_energy_ledgers')
      .update({
        used_energy_current_month: newUsed,
        reserved_energy_active_runs: newReserved,
        remaining_available_energy: newAvailable,
        burn_rate_percentage: burnRatePercentage,
        budget_alert_stage: budgetAlertStage,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    if (updateError) {
      console.error('[agent/energy/settle] Update error:', updateError);
      return NextResponse.json(
        { error: 'SETTLEMENT_UPDATE_FAILED', message: '에너지 정산 처리 중 데이터베이스 갱신에 실패했습니다.' },
        { status: 500 }
      );
    }

    // 3. Record transaction in agent_energy_transactions
    try {
      await (supabase as any).from('agent_energy_transactions').insert({
        transaction_id: `tx_settle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        workspace_id: workspaceId,
        pack_count: 0,
        paid_amount_krw: 0,
        added_energy: -spentAmount, // negative means consumption
        created_at: new Date().toISOString(),
      });
    } catch {
      // Non-blocking
    }

    return NextResponse.json({
      success: true,
      settledAmount: spentAmount,
      remainingAvailable: newAvailable,
      burnRatePercentage,
      budgetAlertStage,
      reservationId,
      receiptId,
      runId,
    }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Settlement failed';
    return NextResponse.json({ error: 'SERVER_ERROR', message }, { status: 500 });
  }
}
