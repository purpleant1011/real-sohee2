export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';
import { SOHEE_WORKER_VERSION } from '@/lib/build-identity';

export async function GET(req: NextRequest) {
  try {
    await requireOperatorAnyScope('dashboard.read');
    const { searchParams } = new URL(req.url);
    const requestedWorkspaceId = searchParams.get('workspaceId');

    const supabase = await createServerSupabaseClient();

    // 1. 전체 워크스페이스 수 (실제 고객사 vs 데모 분리 집계)
    const { data: workspaces, error: wsErr } = await (supabase as any)
      .from('workspaces')
      .select('id, name, created_at');

    const actualWorkspaces = (workspaces || []).filter(
      (w: any) => !w.name?.includes('데모') && !w.name?.includes('Demo') && w.id !== 'ws-demo'
    );
    const demoWorkspaces = (workspaces || []).filter(
      (w: any) => w.name?.includes('데모') || w.name?.includes('Demo') || w.id === 'ws-demo'
    );

    const totalWorkspaces = wsErr ? null : (workspaces?.length ?? 0);

    // 2. 활성 오토메이션 수
    const { count: activeAutomationsCount, error: autoErr } = await (supabase as any)
      .from('automation_instances')
      .select('instance_id', { count: 'exact', head: true })
      .in('current_state', ['SCHEDULED', 'RUNNING', 'ACTIVE']);

    const activeAutomations = autoErr ? null : (activeAutomationsCount ?? 0);

    // 3. 글로벌 킬스위치 상태
    const { data: globalSwitch, error: killErr } = await (supabase as any)
      .from('kill_switches')
      .select('*')
      .eq('scope', 'GLOBAL')
      .eq('is_active', true);

    const killSwitchKnown = !killErr && Array.isArray(globalSwitch);
    const killSwitchState = !killSwitchKnown ? 'UNKNOWN' : globalSwitch.some((entry: any) => entry.is_active !== false) ? 'ACTIVATED' : 'NORMAL';
    const activeGlobalSwitch = killSwitchKnown ? globalSwitch[0] : null;

    // 4. 스케줄러 지연 시간 실측 (가장 오래된 초과 오토메이션 기준)
    const nowIso = new Date().toISOString();
    const { data: overdueAutomations, error: overdueErr } = await (supabase as any)
      .from('automation_instances')
      .select('instance_id, next_run_at')
      .in('current_state', ['SCHEDULED', 'ACTIVE'])
      .lt('next_run_at', nowIso)
      .order('next_run_at', { ascending: true })
      .limit(1);

    let schedulerLagSeconds: number | null = null;
    let schedulerLagStatus: 'OK' | 'UNKNOWN' | 'DEGRADED' = 'OK';
    if (overdueErr) {
      schedulerLagStatus = 'DEGRADED';
    } else if (overdueAutomations && overdueAutomations.length > 0 && overdueAutomations[0].next_run_at) {
      const diffMs = Math.max(0, Date.now() - new Date(overdueAutomations[0].next_run_at).getTime());
      schedulerLagSeconds = Math.round(diffMs / 100) / 10;
    } else {
      schedulerLagSeconds = 0;
    }

    // 5. Lineage Trace 조회 (특정 워크스페이스 또는 첫 번째 실제 워크스페이스)
    const targetWsId = requestedWorkspaceId || actualWorkspaces?.[0]?.id || workspaces?.[0]?.id;
    let traceData = null;

    if (targetWsId) {
      // 제안 및 영수증 조회
      const [proposalRes, receiptRes, harnessRes] = await Promise.all([
        (supabase as any)
          .from('work_proposals')
          .select('*')
          .eq('workspace_id', targetWsId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from('verified_proof_receipts')
          .select('*')
          .eq('workspace_id', targetWsId)
          .order('verified_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from('workspace_knowledge_harnesses')
          .select('*')
          .eq('workspace_id', targetWsId)
          .eq('is_active', true)
          .maybeSingle()
      ]);

      if (proposalRes.data || receiptRes.data || harnessRes.data) {
        traceData = {
          workspaceId: targetWsId,
          goal: proposalRes.data?.title || null,
          harnessVersion: harnessRes.data?.harness_version_id || null,
          proposal: proposalRes.data?.title || null,
          envelope: proposalRes.data?.proposed_envelope?.title || null,
          agentBuild: harnessRes.data?.compiler_metadata?.build_version || SOHEE_WORKER_VERSION || null,
          runId: receiptRes.data?.execution_run_id || null,
          receipt: receiptRes.data?.proof_receipt_id || null,
          outcome: receiptRes.data?.verification_status === 'VERIFIED'
            ? `실측 검증 완료 (${receiptRes.data.target_channel})`
            : receiptRes.data ? '실행 결과 검증 대기 중' : null
        };
      }
    }

    const observedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      fleet: {
        totalWorkspaces: totalWorkspaces ?? 0,
        activeAutomations: activeAutomations ?? 0,
        schedulerLagSeconds: schedulerLagSeconds ?? 0,
        killSwitchState,
      },
      truthEnvelope: {
        totalWorkspaces: {
          value: totalWorkspaces,
          source: 'workspaces',
          source_id: 'table:workspaces',
          observed_at: observedAt,
          status: wsErr ? 'DEGRADED' : 'OK',
          error_code: wsErr?.code || null,
        },
        actualWorkspacesCount: {
          value: wsErr ? null : actualWorkspaces.length,
          source: 'workspaces',
          status: wsErr ? 'DEGRADED' : 'OK',
        },
        demoWorkspacesCount: {
          value: wsErr ? null : demoWorkspaces.length,
          source: 'workspaces',
          status: wsErr ? 'DEGRADED' : 'OK',
        },
        activeAutomations: {
          value: activeAutomations,
          source: 'automation_instances',
          source_id: 'table:automation_instances',
          observed_at: observedAt,
          status: autoErr ? 'DEGRADED' : 'OK',
          error_code: autoErr?.code || null,
        },
        schedulerLagSeconds: {
          value: schedulerLagSeconds,
          source: 'automation_instances.next_run_at',
          source_id: overdueAutomations?.[0]?.instance_id || null,
          observed_at: overdueErr ? null : observedAt,
          status: schedulerLagStatus,
        },
        killSwitch: {
          value: killSwitchState,
          source: 'kill_switches',
          source_id: activeGlobalSwitch?.switch_id || null,
          observed_at: killSwitchKnown ? observedAt : null,
          status: killSwitchKnown ? 'OK' : 'DEGRADED',
          engaged_by: activeGlobalSwitch?.engaged_by || null,
          reason: activeGlobalSwitch?.reason || null,
        },
        observed_at: observedAt,
      },
      workspaces: (workspaces || []).map((w: any) => ({ id: w.id, name: w.name })),
      selectedWorkspaceId: targetWsId || null,
      trace: traceData,
      source: 'Supabase Canonical DB (Same-Truth)',
      asOf: observedAt,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Fleet snapshot 조회 실패' }, { status: 403 });
  }
}
