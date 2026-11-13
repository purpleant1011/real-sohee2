export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { MissionRepository } from '@/lib/mission-os/mission-repository'
import { computePlanDiff, buildAuthoritativePlanDiffContext, type PlanDiff } from '@/lib/mission-os/mission-plan-diff'
import type { MissionContract } from '@/lib/mission-os/mission-contract'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/missions/[id]/apply-diff
 * Atomically applies a verified PlanDiff to the mission contract.
 *
 * Invariants:
 * 1. Strict RBAC: only owner/manager roles can apply contract mutations (viewers get 403).
 * 2. Server-side diff re-computation: Never blind-trust client planDiff. Server re-computes
 *    diff against authoritative DB contract and verifies payload_hash / version consistency.
 * 3. Idempotency priority: Replays matching idempotency_key + payload_hash before stale check.
 *    Rejects mismatched payload_hash for existing key with 409 Conflict.
 * 4. DB Privilege isolation: Uses verified admin client for update_mission_snapshot_atomic RPC.
 * 5. Safe DTO projection: Never exposes internal PII, secrets, or raw error messages.
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

    // 1. RBAC Guard: Read-only users (viewer) cannot mutate mission contracts
    if (workspace.role !== 'owner' && workspace.role !== 'manager') {
      return NextResponse.json({ error: '마케팅 업무 변경 권한이 없습니다 (관리자 권한 필요).' }, { status: 403 })
    }

    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth?.getUser() ?? { data: { user: null } }
    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '유효한 요청 정보가 필요합니다.' }, { status: 400 })
    }

    const { planDiff, expectedSnapshotVersion } = body as {
      planDiff: PlanDiff
      expectedSnapshotVersion: number
    }

    if (!Number.isSafeInteger(expectedSnapshotVersion) || expectedSnapshotVersion < 1) {
      return NextResponse.json({ error: '올바른 expectedSnapshotVersion 양의 정수가 필요합니다.' }, { status: 400 })
    }

    if (!planDiff || typeof planDiff !== 'object' || Array.isArray(planDiff) || !planDiff.proposed_contract || typeof planDiff.proposed_contract !== 'object') {
      return NextResponse.json({ error: '유효한 planDiff 페이로드가 필요합니다.' }, { status: 400 })
    }

    if (typeof planDiff.idempotency_key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(planDiff.idempotency_key)) {
      return NextResponse.json({ error: '올바른 idempotency_key 형식이 필요합니다.' }, { status: 400 })
    }

    if (typeof planDiff.payload_hash !== 'string' || !/^[a-f0-9]{64}$/.test(planDiff.payload_hash)) {
      return NextResponse.json(
        { error: '올바른 payload_hash 형식이 필요합니다.', code: 'FORGED_PLAN_DIFF_PAYLOAD' },
        { status: 400 }
      )
    }

    // 2. Fetch authoritative current mission
    const { data: currentMission, error: fetchErr } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (fetchErr || !currentMission) {
      return NextResponse.json({ error: '해당 업무를 찾을 수 없습니다.' }, { status: 404 })
    }

    const currentContract = currentMission.metadata?.contract as MissionContract | undefined
    if (!currentContract) {
      return NextResponse.json({ error: '업무 계약 정보가 손상되었습니다.' }, { status: 422 })
    }

    // 3. Idempotency Replay Guard (must precede stale check)
    const existingIdempMap: Record<string, string> =
      currentMission.metadata?.applied_plan_idempotency_map &&
      typeof currentMission.metadata.applied_plan_idempotency_map === 'object'
        ? currentMission.metadata.applied_plan_idempotency_map
        : {}

    if (planDiff.idempotency_key in existingIdempMap) {
      const recordedHash = existingIdempMap[planDiff.idempotency_key]
      if (recordedHash !== planDiff.payload_hash) {
        return NextResponse.json(
          {
            error: '동일한 멱등 요청 키에 서로 다른 변경 내용이 전달되었습니다.',
            code: 'IDEMPOTENCY_CONFLICT',
          },
          { status: 409 }
        )
      }
      // Replay existing result safely without re-execution
      return NextResponse.json({
        success: true,
        mission_id: id,
        new_contract_version: currentContract.contract_version,
        snapshot_version: Number(currentMission.metadata?.snapshot_version ?? 1),
        replayed: true,
      })
    }

    // 4. Concurrency conflict detection (OCC)
    const currentSnapshotVersion = Number(currentMission.metadata?.snapshot_version ?? 1)
    if (currentSnapshotVersion !== expectedSnapshotVersion) {
      return NextResponse.json(
        {
          error: `동시 수정 충돌: 현재 스냅샷 버전(${currentSnapshotVersion})이 요청된 버전(${expectedSnapshotVersion})과 다릅니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.`,
          code: 'STALE_SNAPSHOT_VERSION',
          current_snapshot_version: currentSnapshotVersion,
          expected_snapshot_version: expectedSnapshotVersion,
        },
        { status: 409 }
      )
    }

    // 5. Authoritative Server-Side Diff Re-Computation & Hash Verification
    // Extract intended patch from proposed_contract, prohibiting modification of protected fields
    const proposedPatch: Partial<MissionContract> = {
      goal: planDiff.proposed_contract.goal,
      service_scope: planDiff.proposed_contract.service_scope,
      budget_caps: planDiff.proposed_contract.budget_caps,
      success_criterion: planDiff.proposed_contract.success_criterion,
      observation_window: planDiff.proposed_contract.observation_window,
      allowed_actions: planDiff.proposed_contract.allowed_actions,
    }

    const diffContext = buildAuthoritativePlanDiffContext(currentMission, {
      expectedSnapshotVersion,
      idempotencyKey: planDiff.idempotency_key,
    })

    const serverRecomputedDiff = computePlanDiff(currentContract, proposedPatch, diffContext)

    // Reject forged client diff if hashes diverge
    if (serverRecomputedDiff.payload_hash !== planDiff.payload_hash) {
      return NextResponse.json(
        {
          error: '계획 변경 내용 해시가 서버 계산 결과와 일치하지 않습니다. (변조 방지)',
          code: 'FORGED_PLAN_DIFF_PAYLOAD',
        },
        { status: 400 }
      )
    }

    // 6. Execute atomic mutation via admin client (service_role required for update_mission_snapshot_atomic RPC)
    const adminClient = createAdminSupabaseClient()
    const adminRepo = new MissionRepository(adminClient)

    const result = await adminRepo.applyPlanDiffAtomic({
      workspaceId: workspace.workspaceId,
      missionId: id,
      traceId: currentMission.trace_id,
      expectedSnapshotVersion,
      diff: serverRecomputedDiff,
      actorType: 'user',
      actorId: user.id,
    })

    // 7. Return safe client DTO (no internal tokens or raw contract dump)
    return NextResponse.json({
      success: true,
      mission_id: id,
      new_contract_version: result.diff.new_contract_version,
      snapshot_version: currentSnapshotVersion + 1,
      summary: {
        goal: result.diff.proposed_contract.goal,
        service_scope: result.diff.proposed_contract.service_scope,
        budget_minor_units: result.diff.proposed_contract.budget_caps.max_cost_minor_units,
        changed_fields_count: result.diff.changed_fields.length,
      },
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
    if (rawMessage.includes('IDEMPOTENCY_CONFLICT')) {
      return NextResponse.json(
        {
          error: '동일한 멱등 요청 키에 서로 다른 변경 내용이 전달되었습니다.',
          code: 'IDEMPOTENCY_CONFLICT',
        },
        { status: 409 }
      )
    }
    // Fail-safe sanitized generic error
    return NextResponse.json({ error: '업무 계획 변경 적용 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
