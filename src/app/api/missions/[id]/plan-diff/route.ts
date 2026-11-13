export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import {
  computePlanDiff,
  parseMissionModificationIntent,
  buildAuthoritativePlanDiffContext,
  type PlanDiffContext,
} from '@/lib/mission-os/mission-plan-diff'
import type { MissionContract } from '@/lib/mission-os/mission-contract'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/missions/[id]/plan-diff
 * Returns the current active contract and last plan diff (if any).
 */
export async function GET(_req: Request, { params }: RouteParams) {
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
    const supabase = await createServerSupabaseClient()
    const { data: mission, error } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (error || !mission) {
      return NextResponse.json({ error: '해당 업무를 찾을 수 없습니다.' }, { status: 404 })
    }

    const contract = (mission.metadata?.contract as MissionContract) || null
    const lastPlanDiff = mission.metadata?.last_plan_diff || null
    const snapshotVersion = Number(mission.metadata?.snapshot_version ?? 1)

    return NextResponse.json({
      success: true,
      mission_id: id,
      snapshot_version: snapshotVersion,
      contract,
      last_plan_diff: lastPlanDiff,
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Plan diff 조회 실패' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/missions/[id]/plan-diff
 * Computes PlanDiff from intent text or proposed contract patch without mutating external state.
 *
 * Guarantees:
 * - Ambiguous inputs return is_ambiguous: true with clarification prompt and ZERO writes.
 * - Concurrency conflict check via expectedSnapshotVersion.
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
    const body = await req.json().catch(() => ({}))
    const { intentText, proposedPatch, expectedSnapshotVersion } = body

    const supabase = await createServerSupabaseClient()
    const { data: mission, error } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (error || !mission) {
      return NextResponse.json({ error: '해당 업무를 찾을 수 없습니다.' }, { status: 404 })
    }

    if (expectedSnapshotVersion !== undefined && (!Number.isSafeInteger(expectedSnapshotVersion) || expectedSnapshotVersion < 1)) {
      return NextResponse.json(
        { error: '올바른 expectedSnapshotVersion 양의 정수가 필요합니다.' },
        { status: 400 }
      )
    }

    const currentSnapshotVersion = Number(mission.metadata?.snapshot_version ?? 1)
    if (expectedSnapshotVersion !== undefined && expectedSnapshotVersion !== currentSnapshotVersion) {
      return NextResponse.json(
        {
          error: '동시 수정 충돌이 발생했습니다. 최신 미션 상태를 다시 불러와 확인해 주세요.',
          code: 'STALE_SNAPSHOT_VERSION',
          current_snapshot_version: currentSnapshotVersion,
          expected_snapshot_version: expectedSnapshotVersion,
        },
        { status: 409 }
      )
    }

    const currentContract = (mission.metadata?.contract as MissionContract) || null
    if (!currentContract) {
      return NextResponse.json(
        { error: '미션의 기본 계약(Contract)이 초기화되지 않았습니다.' },
        { status: 400 }
      )
    }

    const diffContext: PlanDiffContext = buildAuthoritativePlanDiffContext(mission, {
      expectedSnapshotVersion: currentSnapshotVersion,
    })

    if (typeof intentText === 'string' && intentText.trim()) {
      const intentResult = parseMissionModificationIntent(intentText, currentContract, diffContext)
      if (intentResult.isPauseIntent) {
        return NextResponse.json({
          success: true,
          is_pause_intent: true,
          plan_diff: null,
          clarification_prompt: intentResult.clarificationPrompt,
        })
      }
      if (intentResult.isAmbiguous || !intentResult.planDiff) {
        return NextResponse.json({
          success: true,
          is_ambiguous: true,
          plan_diff: null,
          clarification_prompt: intentResult.clarificationPrompt,
        })
      }
      return NextResponse.json({
        success: true,
        is_ambiguous: false,
        plan_diff: intentResult.planDiff,
      })
    }

    if (proposedPatch && typeof proposedPatch === 'object') {
      const planDiff = computePlanDiff(currentContract, proposedPatch, diffContext)
      return NextResponse.json({
        success: true,
        is_ambiguous: false,
        plan_diff: planDiff,
      })
    }

    return NextResponse.json(
      { error: 'intentText 또는 proposedPatch가 필요합니다.' },
      { status: 400 }
    )
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Plan diff 계산 오류' },
      { status: 500 }
    )
  }
}
