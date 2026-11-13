export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { AgentControlPlaneService, DesiredAgentMode } from '@/features/marketing-agent/engine/agent-control-state';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { readRuntimeControl } from '@/features/marketing-agent/engine/runtime-control-read';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const auth = await requireWorkspaceMembership(workspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, message: auth.message },
      { status: auth.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const state = await readRuntimeControl(await createServerSupabaseClient(), workspaceId);
    return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'CONTROL_STATE_UNAVAILABLE', message: '서버 업무 상태를 확인하지 못했어요.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const auth = await requireWorkspaceMembership(workspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, message: auth.message },
      { status: auth.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Privilege Boundary: Agent kill-switch & mode change require owner or admin role
  if (auth.role !== 'owner' && auth.role !== 'admin') {
    return NextResponse.json(
      { error: 'PERMISSION_DENIED', message: '에이전트 제어는 작업공간 소유자 또는 관리자만 변경할 수 있습니다.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { action, desiredMode, killSwitchActive, reason, expectedVersion } = body;
    // user-controlled updatedBy is completely ignored; authenticated identity is strictly enforced
    const serverUpdatedBy = auth.email || auth.userId;

    if (!body || typeof body !== 'object' || (desiredMode && !['OFF', 'PAUSED', 'RUNNING'].includes(desiredMode))) return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

    if (action === 'toggle_kill_switch' || typeof killSwitchActive === 'boolean') {
      await AgentControlPlaneService.toggleKillSwitch(
        workspaceId,
        Boolean(killSwitchActive),
        serverUpdatedBy,
        reason
      );
    } else if (action === 'set_mode' || desiredMode) {
      await AgentControlPlaneService.setDesiredMode(
        workspaceId,
        desiredMode as DesiredAgentMode,
        serverUpdatedBy,
        reason,
        typeof expectedVersion === 'number' ? expectedVersion : undefined
      );
    } else {
      return NextResponse.json(
        { error: 'INVALID_ACTION', message: 'action 또는 desiredMode가 필요합니다.' },
        { status: 400 }
      );
    }

    const confirmed = await readRuntimeControl(await createServerSupabaseClient(), workspaceId);
    return NextResponse.json(confirmed, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    if ((err as any)?.code === 'CONFLICT' || (err as any)?.name === 'RuntimeControlConflictError') {
      return NextResponse.json(
        { error: 'CONFLICT', message: (err as Error).message },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : 'Control state mutation failed';
    return NextResponse.json({ error: 'SERVER_ERROR', message }, { status: 500 });
  }
}
