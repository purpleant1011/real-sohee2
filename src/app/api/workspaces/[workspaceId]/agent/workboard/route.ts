export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { buildWorkboardSnapshot } from '@/features/agent-os/build-workboard-snapshot';
import type { WorkboardProof } from '@/features/agent-os/workboard-types';

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

  // 1. Fetch server control state
  const controlState = await AgentControlPlaneService.getControlState(workspaceId);

  // 2. Fetch live proofs and exception status from Supabase if available
  let latestProof: WorkboardProof | null = null;
  let ownerActionRequiredCount = 0;

  try {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const supabase = await createServerSupabaseClient();

    // Check kill switch preflight
    const { checkKillSwitchPreflight } = await import('@/lib/safety/kill-switch-guard');
    const killCheck = await checkKillSwitchPreflight(supabase, { workspaceId });
    if (killCheck.blocked) {
      controlState.killSwitchActive = true;
      controlState.actualMode = 'BLOCKED';
      controlState.statusReason = killCheck.reason || '긴급 킬스위치 활성화';
    }

    // Check latest verified execution proof from actual audit_events table
    const { data: latestAudit } = await (supabase as any)
      .from('audit_events')
      .select('id, event_type, created_at, metadata')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestAudit) {
      latestProof = {
        id: latestAudit.id,
        label: '최근 업무 기록 · 외부 결과는 별도 확인이 필요해요',
        verificationState: 'RESULT_UNKNOWN',
        verifiedAt: null,
        evidenceId: latestAudit.id,
      };
    }

    // No separate action_approvals table exists; safely default to 0 to prevent 404
    ownerActionRequiredCount = 0;
  } catch {
    // Non-blocking in test/isolated environments
  }

  // 3. Build snapshot
  const snapshot = buildWorkboardSnapshot({
    workspaceId,
    controlState,
    rawProof: latestProof,
    ownerActionRequiredCount,
  });

  return NextResponse.json(snapshot, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
