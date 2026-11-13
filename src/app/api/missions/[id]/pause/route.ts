export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { MissionRepository } from '@/lib/mission-os/mission-repository'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/missions/[id]/pause
 * Atomically pauses an in-flight mission:
 * 1. Bumps authoritative control_epoch
 * 2. Sets execution_state and status to PAUSED
 * 3. Immediately blocks any pending worker mutations with older epoch
 * 4. Preserves in-flight readback and financial reconciliation
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: '올바른 업무 식별자가 필요합니다.' }, { status: 400 })
    }

    const preferredId = await readPreferredWorkspaceIdFromCookies()
    const resolution = await resolveCurrentWorkspaceContext(preferredId)

    if (resolution.status === 'expired') {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }
    if (resolution.status === 'forbidden') {
      return NextResponse.json({ error: '해당 워크스페이스에 대한 접근 권한이 없습니다.' }, { status: 403 })
    }
    if (resolution.status === 'missing') {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }
    if (resolution.status === 'error') {
      return NextResponse.json({ error: '워크스페이스 확인 중 일시적인 오류가 발생했습니다.' }, { status: 500 })
    }

    const workspace = resolution.context
    if (workspace.role !== 'owner' && workspace.role !== 'manager') {
      return NextResponse.json({ error: '업무 일시정지 권한이 없습니다 (관리자 권한 필요).' }, { status: 403 })
    }

    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth?.getUser() ?? { data: { user: null } }
    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const expectedSnapshotVersion = body.expectedSnapshotVersion

    if (expectedSnapshotVersion !== undefined && (!Number.isSafeInteger(expectedSnapshotVersion) || expectedSnapshotVersion < 1)) {
      return NextResponse.json(
        { error: '올바른 expectedSnapshotVersion 양의 정수가 필요합니다.' },
        { status: 400 }
      )
    }

    const { data: mission, error: fetchErr } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (fetchErr || !mission) {
      return NextResponse.json({ error: '해당 업무를 찾을 수 없습니다.' }, { status: 404 })
    }

    const currentSnapshotVersion = Number(mission.metadata?.snapshot_version ?? 1)
    if (expectedSnapshotVersion !== undefined && currentSnapshotVersion !== expectedSnapshotVersion) {
      return NextResponse.json(
        {
          error: `동시 수정 충돌: 현재 스냅샷 버전(${currentSnapshotVersion})이 요청된 버전과 다릅니다.`,
          code: 'STALE_SNAPSHOT_VERSION',
          current_snapshot_version: currentSnapshotVersion,
        },
        { status: 409 }
      )
    }

    const adminClient = createAdminSupabaseClient()
    const adminRepo = new MissionRepository(adminClient)

    const updated = await adminRepo.pauseMissionAtomic({
      workspaceId: workspace.workspaceId,
      missionId: id,
      traceId: mission.trace_id,
      expectedSnapshotVersion: currentSnapshotVersion,
      actorType: 'user',
      actorId: user.id,
      reason: typeof body.reason === 'string' ? body.reason : '사용자 업무 일시정지 요청',
    })

    const newControlEpoch = Number(updated.metadata?.control_epoch ?? 1)

    return NextResponse.json({
      success: true,
      mission_id: id,
      status: 'PAUSED',
      control_epoch: newControlEpoch,
      snapshot_version: currentSnapshotVersion + 1,
      message: '업무가 안전하게 일시정지되었습니다. 이미 제출된 외부 요청은 readback으로 계속 확인됩니다.',
    })
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : ''
    if (rawMessage.includes('STALE_SNAPSHOT_VERSION')) {
      return NextResponse.json(
        {
          error: '동시 수정 충돌이 발생했습니다. 최신 미션을 다시 확인해 주세요.',
          code: 'STALE_SNAPSHOT_VERSION',
        },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: '업무 일시정지 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
