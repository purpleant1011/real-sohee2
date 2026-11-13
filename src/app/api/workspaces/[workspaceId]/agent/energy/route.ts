export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getWorkspaceAuthoritativeCreditBalance } from '@/features/credits/actual-spend-balance.server';

export async function GET(
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
    const admin = createAdminSupabaseClient();

    const [creditStateRes, authBalance] = await Promise.all([
      (admin as any)
        .from('workspace_credit_states')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      getWorkspaceAuthoritativeCreditBalance(workspaceId, admin),
    ]);

    const { data: creditState, error: creditError } = creditStateRes;

    if (creditError) {
      console.error('[agent/energy] Authoritative credit state fetch error:', creditError);
      return NextResponse.json(
        {
          error: 'CREDIT_STATE_UNAVAILABLE',
          message: '크레딧 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    if (!creditState) {
      console.warn('[agent/energy] Credit state row not found for workspace:', workspaceId);
      return NextResponse.json(
        {
          error: 'CREDIT_STATE_UNAVAILABLE',
          message: '크레딧 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    // Authoritative balance RPC must succeed; never fall back to inflated state rows or invent figures
    if (!authBalance || typeof authBalance.authoritativeAvailableCredits !== 'number') {
      console.error('[agent/energy] Authoritative balance RPC unavailable for workspace:', workspaceId);
      return NextResponse.json(
        {
          error: 'CREDIT_STATE_UNAVAILABLE',
          message: '크레딧 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const balanceSC = Math.max(0, authBalance.authoritativeAvailableCredits);

    const bucketSum =
      (Number(creditState.activation_credits) || 0) +
      (Number(creditState.agent_credits) || 0) +
      (Number(creditState.protected_wow_credits) || 0) +
      (Number(creditState.purchased_credits) || 0);

    // capacity is at least balanceSC (to handle cases where purchased or bonus credits exceed initial bucket sums)
    // Both 0 means capacity is 0.
    const capacity = Math.max(bucketSum, balanceSC);

    // 예약분은 total_available_credits에서 이미 선차감됨
    const reservedSC = 0;

    const usedCredits = Math.max(0, capacity - balanceSC);
    const usagePercentage =
      capacity > 0 ? Math.min(100, Math.round((usedCredits / capacity) * 100)) : 0;

    let budgetAlertStage = 'NORMAL';
    if (capacity === 0 && balanceSC === 0) {
      budgetAlertStage = 'EXHAUSTED';
    } else if (usagePercentage >= 100) {
      budgetAlertStage = 'EXHAUSTED';
    } else if (usagePercentage >= 95) {
      budgetAlertStage = 'STAGE_95_RESTRICT';
    } else if (usagePercentage >= 85) {
      budgetAlertStage = 'STAGE_85_DEFER';
    } else if (usagePercentage >= 70) {
      budgetAlertStage = 'STAGE_70_OPTIMIZE';
    }

    const status =
      budgetAlertStage === 'EXHAUSTED'
        ? 'DEPLETED'
        : budgetAlertStage === 'STAGE_95_RESTRICT'
        ? 'CRITICAL'
        : budgetAlertStage === 'STAGE_85_DEFER'
        ? 'CONSERVE'
        : 'ACTIVE';

    const rawCommercialState = String(creditState.commercial_state || '');
    const planTier = rawCommercialState.startsWith('TRIAL')
      ? 'FREE_TASTE'
      : (rawCommercialState || 'UNKNOWN');

    const responsePayload = {
      workspaceId: creditState.workspace_id,
      planTier,
      // Legacy Energy compatibility mappings for existing consumers (outcome page)
      monthlyTotalEnergy: capacity,
      usedEnergyCurrentMonth: usedCredits,
      reservedEnergyActiveRuns: reservedSC,
      remainingAvailableEnergy: balanceSC,
      burnRatePercentage: usagePercentage,
      budgetAlertStage,
      forecastRunOutDays: null,
      updatedAt: creditState.updated_at,
      // Canonical SC credit fields
      capacity,
      balanceSC,
      reservedSC,
      usedCredits,
      usagePercentage,
      status,
    };

    return NextResponse.json(responsePayload, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err: unknown) {
    console.error('[agent/energy] Unexpected error:', err);
    return NextResponse.json(
      {
        error: 'CREDIT_STATE_UNAVAILABLE',
        message: '크레딧 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
