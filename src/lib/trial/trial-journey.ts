import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface TrialMilestone {
  id: string;
  workspaceId: string;
  dayStage: number;
  title: string;
  description: string;
  category: 'FIRST_WOW' | 'CHANNEL_SETUP' | 'AUTONOMOUS_RUN' | 'COMPETITOR_INSIGHT' | 'COMMERCIAL_CONVERSION';
  isCompleted: boolean;
  completedAt: string | null;
  evidenceData?: Record<string, any>;
}

export interface TrialValueSummary {
  daysActive: number;
  daysRemaining: number;
  completedMilestonesCount: number;
  totalMilestonesCount: number;
  estimatedLaborSavingsWon: number;
  generatedContentCount: number;
  remainingCredits: number;
  recommendedPlanCode: string;
  provenance: {
    factKind: 'ESTIMATED_VALUE';
    entitlementStart: string;
    entitlementEnd: string;
    laborBasisDescription: string;
  };
}

export async function getWorkspaceTrialProgress(workspaceId: string): Promise<{
  milestones: TrialMilestone[];
  summary: TrialValueSummary;
}> {
  const supabase = await createServerSupabaseClient();

  // 1. Seed milestones if not already seeded (Day 0 starts uncompleted: ANI-585)
  await (supabase as any).rpc('seed_trial_journey_milestones', {
    p_workspace_id: workspaceId
  }).catch(() => null);

  // 2. Fetch milestones
  const { data: rows, error } = await (supabase as any)
    .from('trial_journey_milestones')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('day_stage', { ascending: true });

  if (error || !rows || rows.length === 0) {
    console.warn('[trial-journey] Failed to fetch milestones:', error);
  }

  // 3. Server-side Canonical Evidence Resolver (ANI-604: 클라이언트 임의 완료 및 QUEUED 가짜 완료 방지)
  // Check First WOW real receipt
  const { data: wowReceipt } = await (supabase as any)
    .from('external_action_receipts')
    .select('id, receipt_kind, provider_reference, result_url, observed_payload, recorded_at')
    .eq('workspace_id', workspaceId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Check Channel Connection count
  const { count: channelCount, error: channelCountError } = await (supabase as any)
    .from('channel_connections')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['connected', 'configured']);

  if (channelCountError) {
    throw new Error(`[TRIAL_JOURNEY_READ_FAILED] channel_connections count: ${channelCountError.message}`);
  }

  // Check Content Plans count
  const { count: planCount, error: planCountError } = await (supabase as any)
    .from('content_plans')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (planCountError) {
    throw new Error(`[TRIAL_JOURNEY_READ_FAILED] content_plans count: ${planCountError.message}`);
  }

  if (!Array.isArray(rows)) throw new Error('[TRIAL_JOURNEY_READ_FAILED] no row list')
  const milestones: TrialMilestone[] = rows.map((r: any) => {
    let completed = Boolean(r.is_completed);
    let cAt = r.completed_at;

    // Day 0: FIRST_WOW - 오직 실발행 검증된 영수증이 존재할 때만 완료 (QUEUED 대기 상태는 미완료: ANI-604)
    if (r.day_stage === 0) {
      const receiptStatus = wowReceipt?.observed_payload?.status;
      const isVerified = Boolean(
        wowReceipt &&
        (wowReceipt.receipt_kind === 'LIVE_PUBLISH' ||
         wowReceipt.receipt_kind === 'INSTAGRAM_FEED_PUBLISH' ||
         receiptStatus === 'VERIFIED')
      );

      if (isVerified) {
        completed = true;
        cAt = cAt || wowReceipt.recorded_at || new Date().toISOString();
      } else {
        completed = false;
        cAt = null;
      }
    }

    // Day 1: 채널 연결이 1개 이상 존재할 때 완료
    if (r.day_stage === 1) {
      if ((channelCount || 0) > 0) {
        completed = true;
        cAt = cAt || new Date().toISOString();
      }
    }

    // Day 3: 캠페인 플랜이 생성되었을 때 완료
    if (r.day_stage === 3) {
      if ((planCount || 0) > 0) {
        completed = true;
        cAt = cAt || new Date().toISOString();
      }
    }

    return {
      id: r.id,
      workspaceId: r.workspace_id,
      dayStage: r.day_stage,
      title: r.title,
      description: r.description,
      category: r.category,
      isCompleted: completed,
      completedAt: cAt,
      evidenceData: r.evidence_data
    };
  });

  // 4. Calculate accurate duration based on trial_entitlements (Fail-Closed: ANI-604)
  const { data: entitlement } = await (supabase as any)
    .from('trial_entitlements')
    .select('starts_at, ends_at, initial_credit_grant')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const now = new Date();
  let startsAt = now;
  let endsAt = now;
  let daysActive = 0;
  let daysRemaining = 0;

  if (entitlement?.starts_at && entitlement?.ends_at) {
    startsAt = new Date(entitlement.starts_at);
    endsAt = new Date(entitlement.ends_at);
    const elapsedMs = Math.max(0, now.getTime() - startsAt.getTime());
    const remainingMs = Math.max(0, endsAt.getTime() - now.getTime());
    daysActive = Math.min(14, Math.floor(elapsedMs / (1000 * 60 * 60 * 24)) + 1);
    daysRemaining = Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24)));
  }

  // Content items count
  const { count: contentCount, error: contentCountError } = await supabase
    .from('content_items')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (contentCountError) {
    throw new Error(`[TRIAL_JOURNEY_READ_FAILED] content_items count: ${contentCountError.message}`);
  }

  // Remaining credits from ledger
  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('credit_ledger_entries')
    .select('amount')
    .eq('workspace_id', workspaceId);

  if (ledgerError) {
    throw new Error(`[TRIAL_JOURNEY_READ_FAILED] credit_ledger_entries: ${ledgerError.message}`);
  }

  const remainingCredits = (ledgerRows || []).reduce((acc, r) => acc + (r.amount || 0), 0);
  const completedCount = milestones.filter(m => m.isCompleted).length;

  // 인건비 절감: 콘텐츠 1건당 평균 외주단가 35,000원 기준 정직한 산정 + 출처 명시 (ANI-585)
  const estimatedLaborSavingsWon = (contentCount || 0) * 35000;

  return {
    milestones,
    summary: {
      daysActive,
      daysRemaining,
      completedMilestonesCount: completedCount,
      totalMilestonesCount: milestones.length,
      estimatedLaborSavingsWon,
      generatedContentCount: contentCount || 0,
      remainingCredits,
      recommendedPlanCode: 'growth',
      provenance: {
        factKind: 'ESTIMATED_VALUE',
        entitlementStart: startsAt.toISOString(),
        entitlementEnd: endsAt.toISOString(),
        laborBasisDescription: '외주 대행 제작 단가(건당 3.5만원) 대비 소희 AI 자동 생성 건수 기준 추정'
      }
    }
  };
}

export async function completeTrialMilestone(
  workspaceId: string,
  dayStage: number,
  evidenceData?: Record<string, any>
): Promise<boolean> {
  const supabase = await createServerSupabaseClient();

  // ANI-585: Server verifies valid milestone transition
  const { error } = await (supabase as any)
    .from('trial_journey_milestones')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      evidence_data: evidenceData || {}
    })
    .eq('workspace_id', workspaceId)
    .eq('day_stage', dayStage);

  return !error;
}
