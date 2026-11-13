import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AutomationStateMachine } from '@/lib/outcome-os/runtime/automation-state-machine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || (process.env.NODE_ENV === 'test' ? 'test_cron_secret' : undefined);

    // Fail-closed verification: CRON_SECRET is strictly required
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'unauthorized: valid CRON_SECRET is strictly required' },
        { status: 401 }
      );
    }

    const supabase = await createServerSupabaseClient();
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. 실제 DB에서 실행 예정(SCHEDULED) 작업 중 due 상태인 인스턴스 조회 (하드코딩 0개 원칙)
    const { data: dbInstances, error: fetchErr } = await (supabase as any)
      .from('automation_instances')
      .select('*')
      .eq('current_state', 'SCHEDULED')
      .lte('scheduled_at', nowIso)
      .limit(50);

    if (fetchErr) {
      console.warn('[outcome-scheduler] Fetch due automations warning:', fetchErr);
    }

    const instances = (dbInstances || []).map((item: any) => ({
      instanceId: item.instance_id,
      workspaceId: item.workspace_id,
      automationId: item.automation_id,
      versionNo: item.version_no || 1,
      currentState: item.current_state,
      stateHistory: item.state_history || [],
      scheduledAt: item.scheduled_at,
      lastRunAt: item.last_run_at,
      nextRunAt: item.next_run_at,
      retryCount: item.retry_count || 0,
      updatedAt: item.updated_at,
    }));

    // 2. 스케줄 평가
    const dueAutomations = AutomationStateMachine.evaluateScheduleNextRuns(instances, now);

    // 3. 원자적 Claim 및 분산 Lease 획득 (Exactly-Once Execution Guard - ANI-701)
    const claimedAutomations: string[] = [];
    const claimedJobs: Array<{
      instanceId: string;
      runId: string;
      attemptId: string;
      leaseToken: string;
      leaseExpiresAt: string;
    }> = [];

    for (const due of dueAutomations) {
      const runId = crypto.randomUUID();
      const attemptId = crypto.randomUUID();
      const leaseToken = crypto.randomUUID();
      const leaseOwner = `worker_${process.env.CF_PAGES_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'instance'}_${Date.now()}`;
      const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      const { data: claimed, error: claimErr } = await (supabase as any)
        .from('automation_instances')
        .update({
          current_state: 'RUNNING',
          last_run_at: nowIso,
          run_id: runId,
          attempt_id: attemptId,
          lease_owner: leaseOwner,
          lease_token: leaseToken,
          lease_acquired_at: nowIso,
          lease_expires_at: leaseExpiresAt,
          heartbeat_at: nowIso,
          updated_at: nowIso,
        })
        .eq('instance_id', due.instanceId)
        .eq('current_state', 'SCHEDULED')
        .select('instance_id')
        .maybeSingle();

      if (claimed && !claimErr) {
        claimedAutomations.push(claimed.instance_id);
        claimedJobs.push({
          instanceId: claimed.instance_id,
          runId,
          attemptId,
          leaseToken,
          leaseExpiresAt,
        });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: nowIso,
      evaluatedCount: instances.length,
      dueAutomationsCount: dueAutomations.length,
      claimedCount: claimedAutomations.length,
      claimedInstanceIds: claimedAutomations,
      claimedJobs,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
