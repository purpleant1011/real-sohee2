export const dynamic = 'force-dynamic'

import { randomUUID } from 'node:crypto'
import { consumePublishApproval, fenceMissionSnapshot, nextMissionSnapshotVersion, persistPublishResult } from '@/features/publishing/publish-consumption'
import { findChannelPublishConflict } from '@/features/publishing/channel-publish-guard'
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  executeDualProviderPublish,
  type DualPublishExecutionResult,
} from '@/features/publishing/dual-provider-publish-service'
import {
  calculateApprovalFingerprint,
  type ApprovedFirstPostMission,
  type ExactApprovalPayload,
} from '@/features/missions/conversational-first-post'
import { requireFirstPostReady } from '@/features/quick-start/first-post-readiness'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import {
  revalidateApprovedFactSnapshot,
  getDefaultFactSnapshotResolver,
  createWorkspaceFactReader,
} from '@/features/publishing/fact-snapshot-gate'
import { assertPublishMissionGateAllowed } from '@/lib/mission-os/mission-lineage-guard'

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const requestedWorkspaceId = req.headers.get('x-workspace-id') || body?.workspaceId

    const { resolveDeterministicWorkspace } = await import('@/features/auth/workspace-context')
    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId,
    })

    if (!resolved.success) {
      return NextResponse.json(
        { error: resolved.statusCode === 404 ? '소속된 매장(Workspace)이 없습니다.' : resolved.message },
        { status: resolved.statusCode }
      )
    }

    if (resolved.role !== 'owner' && resolved.role !== 'manager') {
      return NextResponse.json({ error: '이 작업은 매장 대표 또는 관리자만 할 수 있어요' }, { status: 403 })
    }
    const workspaceId = resolved.workspaceId

    if (!isMetaLiveAllowed(workspaceId)) {
      return NextResponse.json(
        { error: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.', code: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT' },
        { status: 403 }
      )
    }

    const adminClient = createAdminSupabaseClient()
    const missionId = typeof body.missionId === 'string'
      ? body.missionId
      : typeof body.approvedMission?.missionId === 'string'
      ? body.approvedMission.missionId
      : typeof body.currentPayload?.missionId === 'string'
      ? body.currentPayload.missionId
      : ''

    if (!missionId) {
      return NextResponse.json(
        { error: '발행 대상 missionId가 필요합니다.', code: 'MISSION_ID_REQUIRED' },
        { status: 422 }
      )
    }

    // P0-2 / R2-B4: Server-Side Durable Approval Truth (0 Client Fallback)
    // DO NOT trust client-supplied approvedMission or payload!
    // Must reload and verify exclusively from server-side durable marketing_missions ledger.
    const { data: mission, error: missionError } = await (adminClient as any)
      .from('marketing_missions')
      .select('id, workspace_id, status, metadata, updated_at')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (missionError) {
      console.error('[missions/first-post/publish] DB read error:', missionError)
      return NextResponse.json(
        { error: '미션 조회 중 오류가 발생했어요.', code: 'DB_READ_ERROR' },
        { status: 500 }
      )
    }

    if (!mission) {
      return NextResponse.json(
        { error: '승인된 미션을 찾을 수 없습니다. 먼저 정밀 승인을 완료해 주세요.', code: 'MISSION_NOT_FOUND' },
        { status: 404 }
      )
    }

    // P0-4: Durable Idempotency Ledger
    // If already published and verified, replay existing verified outcome (never duplicate-publish)
    if (mission.status === 'PUBLISHED_VERIFIED') {
      return NextResponse.json({
        success: true,
        alreadyPublished: true,
        executionResult: mission.metadata?.executionResult,
        code: 'PUBLISH_APPROVAL_CONSUMED',
        message: '이미 사용된 승인입니다. 저장된 결과를 확인해 주세요.',
      }, { status: 409 })
    }

    // G4: optional Idempotency-Key. Same key on the same mission replays the stored state — never a second publish.
    const rawIdemKey = req.headers.get('idempotency-key')
    const idempotencyKey = rawIdemKey === null ? null : rawIdemKey.trim()
    if (idempotencyKey !== null && (idempotencyKey.length === 0 || idempotencyKey.length > 128)) {
      return NextResponse.json({ error: 'Idempotency-Key 형식이 올바르지 않아요.', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 422 })
    }
    if (idempotencyKey && mission.status !== 'APPROVED' && mission.metadata?.publishIdempotencyKey === idempotencyKey) {
      return NextResponse.json({
        success: false,
        idempotentReplay: true,
        missionStatus: mission.status,
        executionResult: mission.metadata?.executionResult ?? null,
        message: '같은 요청으로 이미 발행이 시작됐어요. 새로 게시하지 않고 현재 상태를 알려드려요.',
      }, { status: 409 })
    }

    if (mission.status !== 'APPROVED') {
      return NextResponse.json(
        {
          error: `현재 미션 상태(${mission.status})에서는 발행할 수 없습니다. 'APPROVED' 상태여야 합니다.`,
          code: 'MISSION_NOT_IN_APPROVED_STATE',
        },
        { status: 422 }
      )
    }

    // Restore server-persisted truth (R2-B4: Zero client fallback)
    const approvedMission = mission.metadata?.approvedMission as ApprovedFirstPostMission | undefined
    const currentPayload = mission.metadata?.payload as ExactApprovalPayload | undefined

    if (!approvedMission || !currentPayload) {
      return NextResponse.json(
        { error: '승인 메타데이터가 손상되었거나 존재하지 않습니다.', code: 'CORRUPTED_APPROVAL_METADATA' },
        { status: 422 }
      )
    }

    // Verify fingerprint integrity against current payload
    const recalculated = calculateApprovalFingerprint(currentPayload)
    if (recalculated !== approvedMission.approvedFingerprint) {
      return NextResponse.json(
        {
          error: '승인 지문과 현재 발행 페이로드가 일치하지 않습니다. (APPROVAL_FINGERPRINT_TAMPERED)',
          code: 'APPROVAL_FINGERPRINT_TAMPERED',
        },
        { status: 422 }
      )
    }

    // P0-3: Execution-time Revalidation (Fail-Closed)
    // ANI-1627/1630: re-check service policy and CTA destination immediately before the external action
    const { evaluateMissionSalesGate } = await import('@/features/sales-actions/route-gate')
    const salesGate = evaluateMissionSalesGate(mission.metadata, { workspaceId, now: new Date().toISOString() })
    if (salesGate.status === 'BLOCK') {
      return NextResponse.json(
        { error: salesGate.ownerMessage, code: salesGate.code, alternative: salesGate.alternative, salesGate: { status: salesGate.status, code: salesGate.code } },
        { status: 422 }
      )
    }

    // 1. Re-validate first-post readiness immediately before external action
    // 2026-10-07 ANI-1524 확정: 첫 게시 조건 = 채널 1개 VERIFIED + 4대 퀵팩
    try {
      await requireFirstPostReady(workspaceId, {
        action: 'PUBLISH_FIRST_POST',
        supabaseClient: supabase,
      })
    } catch (readyErr: any) {
      console.error('[missions/first-post/publish] readiness check failed:', readyErr)
      return NextResponse.json(
        {
          error: readyErr?.code === 'SOHEE_NOT_READY' ? readyErr.message : '발행 준비 상태를 확인하지 못했어요.',
          code: 'SOHEE_NOT_READY',
        },
        { status: 403 }
      )
    }

    // 2. Re-validate Emergency Kill Switch
    const killSwitch = await checkKillSwitchPreflight(supabase, { workspaceId })
    if (killSwitch.blocked) {
      return NextResponse.json(
        {
          error: `긴급 킬스위치가 활성화되어 있어 발행이 전면 차단되었습니다. (${killSwitch.reason})`,
          code: 'KILL_SWITCH_ENGAGED',
        },
        { status: 403 }
      )
    }

    // A channel-wide block is independent of the workspace pause.
    for (const channel of currentPayload.channels || []) {
      const channelSafety = await checkKillSwitchPreflight(supabase, { workspaceId, channel: channel.provider })
      if (channelSafety.blocked) return NextResponse.json({ error: '소희가 잠시 멈췄어요', code: 'KILL_SWITCH_ENGAGED' }, { status: 403 })
    }

    // 3. R2-B5: Re-validate confirmed immutable versions (Knowledge, Text, Image, Policy)
    const bound = currentPayload.boundVersions || {}
    const [currKnowledge, currTextRule, currImageRule, currPolicyRule, currChannels] = await Promise.all([
      (supabase as any)
        .from('workspace_knowledge_harnesses')
        .select('harness_version_id, version_no, is_active')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
      (supabase as any)
        .from('harness_rules')
        .select('id, version, status')
        .eq('workspace_id', workspaceId)
        .eq('rule_type', 'text_generation')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      (supabase as any)
        .from('harness_rules')
        .select('id, version, status')
        .eq('workspace_id', workspaceId)
        .eq('rule_type', 'image_generation')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      (supabase as any)
        .from('harness_rules')
        .select('id, version, status, structured_rule')
        .eq('workspace_id', workspaceId)
        .eq('rule_type', 'approval_policy')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      (supabase as any)
        .from('channel_connections')
        .select('channel, status, account_label')
        .eq('workspace_id', workspaceId)
        .in('channel', ['instagram', 'threads']),
    ])

    // Detect version drift
    const targetKnowledgeVersion = bound.knowledgeVersion ?? (bound as any).knowledge
    const targetTextHarnessVersion = bound.textHarnessVersion ?? (bound as any).textHarness
    const targetImageHarnessVersion = bound.imageHarnessVersion ?? (bound as any).imageHarness
    const targetPolicyVersion = bound.operatingPolicyVersion ?? (bound as any).operatingPolicy

    const knowledgeDrift = targetKnowledgeVersion !== undefined && currKnowledge?.data?.version_no !== targetKnowledgeVersion
    const textDrift = targetTextHarnessVersion !== undefined && currTextRule?.data?.version !== targetTextHarnessVersion
    const imageDrift = targetImageHarnessVersion !== undefined && currImageRule?.data?.version !== targetImageHarnessVersion
    const policyDrift = targetPolicyVersion !== undefined && currPolicyRule?.data?.version !== targetPolicyVersion

    if (knowledgeDrift || textDrift || imageDrift || policyDrift) {
      // Invalidate approval in DB
      const invalidation = (adminClient as any)
        .from('marketing_missions')
        .update({
          status: 'AWAITING_APPROVAL',
          metadata: {
            ...mission.metadata,
            snapshot_version: nextMissionSnapshotVersion(mission.metadata),
            invalidatedReason: 'HARNESS_VERSION_DRIFT_DETECTED',
            driftDetails: { knowledgeDrift, textDrift, imageDrift, policyDrift },
            invalidatedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', missionId)
        .eq('workspace_id', workspaceId)
      await fenceMissionSnapshot(invalidation, mission).select('id')

      return NextResponse.json(
        {
          error: '승인 이후 매장 스타일 기준이 변경되어 기존 승인이 무효화되었습니다. 다시 승인해 주세요.',
          code: 'HARNESS_VERSION_DRIFT_DETECTED',
        },
        { status: 422 }
      )
    }

    // 4. R2-B5: Re-validate target channel connections & credentials
    const targetChannelProviders = (currentPayload.channels || []).map((ch) => ch.provider)
    // An unobservable channel read must never be read as "no active channels": that would
    // report a credentials failure for a store whose credentials may be perfectly valid.
    if (currChannels?.error || !Array.isArray(currChannels?.data)) {
      return NextResponse.json(
        {
          error: '채널 연동 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
          code: 'CHANNEL_READ_UNAVAILABLE',
        },
        { status: 503 }
      )
    }
    const existingActiveChannels = currChannels.data.filter(
      (ch: any) => targetChannelProviders.includes(ch.channel) && ['connected', 'verified'].includes(ch.status)
    )

    if (existingActiveChannels.length < targetChannelProviders.length) {
      return NextResponse.json(
        {
          error: '발행 대상 채널의 연동 또는 검증 자격증명이 유효하지 않습니다.',
          code: 'CHANNEL_CREDENTIALS_INVALID',
        },
        { status: 422 }
      )
    }

    // 5. R2-B5: Re-validate image rights & consent
    const rights = currentPayload.rights
    if (
      !rights ||
      !['OWNED', 'LICENSED', 'USER_CONFIRMED'].includes(rights.rightsStatus) ||
      !['CONFIRMED', 'NOT_APPLICABLE'].includes(rights.consentStatus)
    ) {
      return NextResponse.json(
        {
          error: '이미지 에셋의 저작권 및 초상권 동의가 유효하지 않습니다.',
          code: 'MISSING_RIGHTS_EVIDENCE',
        },
        { status: 422 }
      )
    }

    // P0: Re-validate approved fact snapshot freshness immediately before EXECUTING claim & provider dispatch
    const factReader = createWorkspaceFactReader(
      workspaceId,
      async (columns, options) => {
        const { data, error, count } = await (adminClient as any)
          .from('knowledge_facts')
          .select(columns, options)
          .eq('workspace_id', workspaceId)
        return { data, error, count }
      },
      adminClient
    )

    const factGate = await revalidateApprovedFactSnapshot({
      admin: factReader,
      workspaceId,
      previousSnapshot: mission.metadata?.factSnapshot,
      resolver: getDefaultFactSnapshotResolver(),
      learningDependencies: mission.metadata?.learningDependencies,
      learningEpoch: mission.metadata?.learningEpoch,
    })
    if (!factGate.ok) {
      return NextResponse.json(
        {
          error: factGate.error,
          code: factGate.code,
          reason: factGate.reason,
        },
        { status: factGate.status }
      )
    }

    // G5: workspace+channel guard (R1 quick-post and R2 propose missions are separate rows; per-mission CAS cannot see each other).
    const channelGuard = await findChannelPublishConflict(adminClient as any, {
      workspaceId,
      missionId,
      channels: ((currentPayload.channels ?? []) as Array<{ provider?: string }>).map((c) => String(c.provider)),
    })
    if (channelGuard) return NextResponse.json(channelGuard.body, { status: channelGuard.status })

    // The ledger reservation AND snapshot-fenced EXECUTING claim commit together.
    // There must not be a second application-side CAS after consuming an approval.
    const claimToken = randomUUID()
    const consumed = await consumePublishApproval(adminClient, {
      workspaceId, missionId, fingerprint: approvedMission.approvedFingerprint, payload: currentPayload, claimToken,
      expectedMetadata: mission.metadata, expectedUpdatedAt: mission.updated_at ?? null, idempotencyKey,
    })
    if (consumed) return NextResponse.json(consumed.body, { status: consumed.status })

    const isQuickLane = mission.metadata?.lane === 'QUICK_POST'
    if (isQuickLane) {
      await recordFunnelEvent({ admin: adminClient as any, workspaceId, userId: user.id, event: 'publish_confirmed', properties: { missionId }, dedupeKey: `publish_confirmed:${missionId}` })
    }

    // Execute dual publishing with pre-mutation mission control gate & independent readback
    const isContractMission = Boolean(mission.metadata?.contract)
    const workerObservedEpoch = typeof mission.metadata?.control_epoch === 'number'
      ? mission.metadata.control_epoch
      : undefined

    const executionResult: DualPublishExecutionResult = await executeDualProviderPublish({
      approvedMission,
      currentPayload,
      isContractMission,
      workerObservedEpoch,
      assertMissionGateAllowed: async (gateParams) => {
        await assertPublishMissionGateAllowed({
          supabase: adminClient,
          workspaceId: gateParams.workspaceId,
          missionId: gateParams.missionId,
          workerObservedEpoch: gateParams.workerObservedEpoch,
        })
      },
    })

    const finalStatus =
      executionResult.overallStatus === 'ALL_VERIFIED'
        ? 'PUBLISHED_VERIFIED'
        : executionResult.overallStatus === 'PARTIAL_SUCCESS'
        ? 'EXECUTING'
        : 'FAILED'

    const saved = await persistPublishResult(adminClient, {
      missionId, workspaceId, lock: claimToken, result: executionResult, finalStatus, claimedMetadata: mission.metadata,
    })

    if (!saved) {
      return NextResponse.json(
        {
          success: false,
          error: '발행 결과를 저장하지 못했어요. 사후 확인이 필요해요.',
          code: 'RECONCILIATION_REQUIRED',
          executionResult,
        },
        { status: 500 }
      )
    }

    if (isQuickLane) {
      const outcome = executionResult.overallStatus === 'ALL_VERIFIED' ? 'publish_verified' : 'publish_failed'
      await recordFunnelEvent({ admin: adminClient as any, workspaceId, userId: user.id, event: outcome, properties: { missionId, overallStatus: executionResult.overallStatus }, dedupeKey: `${outcome}:${missionId}` })
    }

    // Record immutable audit event in mission_events
    const { error: eventErr } = await (adminClient as any)
      .from('mission_events')
      .insert({
        mission_id: missionId,
        workspace_id: workspaceId,
        trace_id: `trace_${Date.now()}`,
        from_status: 'EXECUTING',
        to_status: saved.status,
        actor_type: 'user',
        actor_id: user.id,
        event_name: 'FIRST_POST_DUAL_PUBLISHED',
        payload: {
          overallStatus: executionResult.overallStatus,
          receipts: executionResult.receipts,
          fingerprint: executionResult.approvalFingerprint,
        },
      })

    if (eventErr) {
      console.error('[missions/first-post/publish] mission_events insert error:', eventErr)
    }

    return NextResponse.json({
      success: executionResult.overallStatus === 'ALL_VERIFIED',
      executionResult,
    })
  } catch (err: any) {
    console.error('[missions/first-post/publish error]:', err)
    const statusCode = err.message?.includes('APPROVAL_FINGERPRINT_TAMPERED') ? 422 : 500
    return NextResponse.json(
      {
        error: '게시물 발행 중 오류가 발생했어요.',
      },
      { status: statusCode }
    )
  }
}
