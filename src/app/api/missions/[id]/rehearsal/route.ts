export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { readPreferredWorkspaceIdFromCookies } from '@/features/auth/active-workspace.server'
import { resolveCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { getWorkspaceAuthoritativeCreditBalance } from '@/features/credits/actual-spend-balance.server'
import { loadApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import {
  runPreviewRehearsal,
  verifyPreLiveInvariants,
  promoteRehearsalToLive,
  type ChannelAuthorizationCheck,
} from '@/lib/mission-os/mission-rehearsal'
import type { MissionContract } from '@/lib/mission-os/mission-contract'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/missions/[id]/rehearsal
 * Runs preview rehearsal for a mission.
 * Guaranteed: live provider writes = 0, operational KPI isolated = true.
 * Uses atomic CAS snapshot RPC to avoid concurrent metadata clobbering.
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
      return NextResponse.json({ error: '리허설 실행 권한이 없습니다 (관리자 권한 필요).' }, { status: 403 })
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

    const { data: mission, error } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (error || !mission) {
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

    const contract = (mission.metadata?.contract as MissionContract) || null
    if (!contract) {
      return NextResponse.json(
        { error: '리허설을 진행할 계약(Contract)이 등록되지 않았습니다.' },
        { status: 400 }
      )
    }

    // Validate and sanitize rehearsal steps (schema allowlist & safe summary template)
    let validatedSteps: any = undefined
    if (Array.isArray(body.steps)) {
      validatedSteps = []
      for (const s of body.steps) {
        if (!s || typeof s !== 'object') continue
        const ch = typeof s.channel === 'string' ? s.channel : ''
        if (!contract.service_scope.map((c) => c.toLowerCase()).includes(ch.toLowerCase())) {
          continue // ignore unknown channels outside contract scope
        }
        const cost =
          typeof s.simulated_cost_minor_units === 'number' &&
          Number.isInteger(s.simulated_cost_minor_units) &&
          s.simulated_cost_minor_units >= 0
            ? s.simulated_cost_minor_units
            : 0
        validatedSteps.push({
          step_id: `step_${validatedSteps.length + 1}_${ch}`,
          channel: ch,
          action_type: 'PUBLISH_PREVIEW',
          summary: `${ch.toUpperCase()} 가상 발행 리허설`,
          simulated_cost_minor_units: cost,
        })
      }
    }

    const rehearsalResult = runPreviewRehearsal({
      workspaceId: workspace.workspaceId,
      missionId: id,
      contract,
      steps: validatedSteps,
    })

    // Store rehearsal artifact atomically via update_mission_snapshot_atomic RPC
    const adminClient = createAdminSupabaseClient()
    const updatedMetadata = {
      ...(mission.metadata || {}),
      last_rehearsal: rehearsalResult,
    }

    const { error: rpcError } = await (adminClient as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspace.workspaceId,
        p_mission_id: id,
        p_expected_snapshot_version: currentSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_status: null,
        p_new_goal: null,
        p_new_receipt_id: null,
        p_actor_type: 'user',
        p_actor_id: user.id,
        p_event_name: 'MISSION_REHEARSAL_RECORDED',
        p_event_payload: {
          rehearsal_run_id: rehearsalResult.rehearsal_run_id,
          total_simulated_cost: rehearsalResult.total_simulated_cost_minor_units,
          receipt_count: rehearsalResult.receipts.length,
        },
        p_receipt_entry: null,
      }
    )

    if (rpcError) {
      return NextResponse.json(
        { error: '리허설 결과 저장 중 동시성 충돌 또는 오류가 발생했습니다.' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      snapshot_version: currentSnapshotVersion + 1,
      rehearsal: {
        rehearsal_run_id: rehearsalResult.rehearsal_run_id,
        is_rehearsal: true,
        live_provider_write_count: 0,
        kpi_isolated: true,
        total_simulated_cost_minor_units: rehearsalResult.total_simulated_cost_minor_units,
        timeline_items: rehearsalResult.timeline_items,
        created_at: rehearsalResult.created_at,
      },
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: '리허설 실행 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/missions/[id]/rehearsal
 * Promotes a rehearsal to live mode after strictly verifying pre-live invariants:
 * - Fresh authoritative facts
 * - Server-verified authoritative channel authorization (fail-closed if unverified)
 * - Authoritative budget verification
 * - Stale rehearsal version prevention
 */
export async function PUT(req: Request, { params }: RouteParams) {
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
      return NextResponse.json({ error: '실서비스 전환 권한이 없습니다 (관리자 권한 필요).' }, { status: 403 })
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

    const { data: mission, error } = await (supabase as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .maybeSingle()

    if (error || !mission) {
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

    const contract = (mission.metadata?.contract as MissionContract) || null
    if (!contract) {
      return NextResponse.json(
        { error: '실서비스로 전환할 계약(Contract)이 없습니다.' },
        { status: 400 }
      )
    }

    // Invariant: PAUSED / STOPPED / CLOSED missions must not be quietly unpaused or promoted
    const currentExecutionState = (mission.metadata?.execution_state || mission.status) as string
    if (
      currentExecutionState === 'PAUSED' ||
      currentExecutionState === 'PAUSING' ||
      currentExecutionState === 'STOPPED' ||
      currentExecutionState === 'CLOSED'
    ) {
      return NextResponse.json(
        {
          error: `일시정지(${currentExecutionState}) 상태의 미션은 먼저 일시정지를 해제해야 실서비스로 전환할 수 있습니다.`,
          code: 'MISSION_PAUSED_CONFLICT',
        },
        { status: 409 }
      )
    }

    // Invariant: Unapproved contracts (DRAFT, NEEDS_DECISION) must not be promoted without explicit approval
    if (
      currentExecutionState === 'DRAFT' ||
      currentExecutionState === 'NEEDS_DECISION' ||
      !contract.approval_fingerprint
    ) {
      return NextResponse.json(
        {
          error: '계약 사전 승인이 완료되지 않은 업무는 실서비스로 전환할 수 없습니다.',
          code: 'UNAPPROVED_CONTRACT',
        },
        { status: 422 }
      )
    }

    const lastRehearsal = mission.metadata?.last_rehearsal
    if (!lastRehearsal) {
      return NextResponse.json(
        { error: '실서비스 전환 전에 먼저 연습 리허설을 완료해야 합니다.' },
        { status: 400 }
      )
    }

    // Authoritative Server-Side Channel Authorization Verification (fail-closed)
    const authoritativeChannelChecks: ChannelAuthorizationCheck[] = []
    for (const channelName of contract.service_scope) {
      const lower = channelName.toLowerCase()
      if (lower === 'instagram' || lower === 'threads') {
        try {
          const cred = await loadChannelCredentialByChannel(workspace.workspaceId, lower)
          const isExpired = cred.expiresAt ? new Date(cred.expiresAt).getTime() <= Date.now() : false
          authoritativeChannelChecks.push({
            channel: channelName,
            is_connected: true,
            is_authorized: !isExpired,
            token_expired: isExpired,
          })
        } catch {
          // Fail-closed: if credential cannot be verified authoritative, mark unauthorized
          authoritativeChannelChecks.push({
            channel: channelName,
            is_connected: false,
            is_authorized: false,
            token_expired: true,
          })
        }
      } else {
        // Unknown or unverified channel: strictly fail-closed
        authoritativeChannelChecks.push({
          channel: channelName,
          is_connected: false,
          is_authorized: false,
          token_expired: true,
        })
      }
    }

    const adminClient = createAdminSupabaseClient()

    // Currency & Budget Ledger Verification (fail-closed)
    // Authoritative credit ledger tracks CREDIT units. If contract currency is not CREDIT,
    // transition must be fail-closed without an authoritative conversion ledger.
    if (contract.budget_caps.currency !== 'CREDIT') {
      return NextResponse.json(
        {
          success: false,
          error: `계약 통화 단위('${contract.budget_caps.currency}')와 워크스페이스 권위 크레딧 원장(CREDIT) 간의 환산 원장이 정의되지 않아 실서비스 전환이 차단되었습니다.`,
          verification_reasons: [
            `통화 단위 불일치: 계약 통화는 '${contract.budget_caps.currency}'이나 워크스페이스 권위 잔액은 'CREDIT' 원장을 사용합니다. (fail-closed)`,
          ],
        },
        { status: 422 }
      )
    }

    // Authoritative workspace budget verification via actual credit ledger SSOT (fail-closed)
    const creditBalance = await getWorkspaceAuthoritativeCreditBalance(workspace.workspaceId, adminClient)
    if (!creditBalance) {
      return NextResponse.json(
        {
          success: false,
          error: '워크스페이스 권위 잔여 예산을 확인할 수 없어 실서비스 전환이 차단되었습니다.',
          verification_reasons: ['워크스페이스 권위 잔여 예산(SSOT) 조회가 불가능합니다. (fail-closed)'],
        },
        { status: 422 }
      )
    }
    const authoritativeAvailableBudget = creditBalance.authoritativeAvailableCredits

    // Authoritative store knowledge fact snapshot lookup (fail-closed)
    let authoritativeFactVersion = ''
    try {
      const factSnapshot = await loadApprovedFactSnapshot(adminClient as any, workspace.workspaceId)
      authoritativeFactVersion = factSnapshot.hash
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: '워크스페이스 기본 사실(Fact) 정보를 검증할 수 없어 실서비스 전환이 차단되었습니다.',
          verification_reasons: ['최신 매장 사실(Fact) 스냅샷 조회가 실패했습니다. (fail-closed)'],
        },
        { status: 422 }
      )
    }

    const verification = verifyPreLiveInvariants({
      workspaceId: workspace.workspaceId,
      missionId: id,
      contract,
      channelAuthorizations: authoritativeChannelChecks,
      currentAvailableBudgetMinorUnits: authoritativeAvailableBudget,
      latestFactVersionRef: authoritativeFactVersion,
    })

    const promotion = promoteRehearsalToLive(lastRehearsal, verification, contract.contract_version)

    if (!promotion.promoted) {
      return NextResponse.json(
        {
          success: false,
          error: promotion.error,
          verification_reasons: verification.reasons,
        },
        { status: 422 }
      )
    }

    // Update snapshot atomically using admin client
    // Note: status in DB chk_marketing_missions_status allows 'APPROVED' or 'EXECUTING'
    // execution_state in metadata tracks fine-grained dual-state engine ('READY')
    const updatedMetadata = {
      ...(mission.metadata || {}),
      execution_mode: 'LIVE',
      execution_state: 'READY',
      promoted_to_live_at: new Date().toISOString(),
    }

    const { error: rpcError } = await (adminClient as any).rpc(
      'update_mission_snapshot_atomic',
      {
        p_workspace_id: workspace.workspaceId,
        p_mission_id: id,
        p_expected_snapshot_version: currentSnapshotVersion,
        p_new_metadata: updatedMetadata,
        p_new_status: 'APPROVED',
        p_new_goal: null,
        p_new_receipt_id: null,
        p_actor_type: 'user',
        p_actor_id: user.id,
        p_event_name: 'MISSION_PROMOTED_TO_LIVE',
        p_event_payload: {
          rehearsal_run_id: lastRehearsal.rehearsal_run_id,
          contract_version: contract.contract_version,
        },
        p_receipt_entry: null,
      }
    )

    if (rpcError) {
      return NextResponse.json(
        { error: '실서비스 전환 저장 중 동시성 충돌 또는 오류가 발생했습니다.' },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      mode: 'LIVE',
      promoted_at: new Date().toISOString(),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: '실서비스 전환 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
