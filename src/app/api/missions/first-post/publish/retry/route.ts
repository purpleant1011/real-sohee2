export const dynamic = 'force-dynamic'

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  retryFailedChannelPublish,
  type DualPublishChannel,
  type DualPublishChannelReceipt,
  type DualPublishExecutionResult,
} from '@/features/publishing/dual-provider-publish-service'
import { validateApprovalForPublish, type ApprovedFirstPostMission, type ExactApprovalPayload } from '@/features/missions/conversational-first-post'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import {
  revalidateApprovedFactSnapshot,
  getDefaultFactSnapshotResolver,
  createWorkspaceFactReader,
} from '@/features/publishing/fact-snapshot-gate'
import { assertPublishMissionGateAllowed } from '@/lib/mission-os/mission-lineage-guard'
import { fenceMissionSnapshot, nextMissionSnapshotVersion, persistPublishResult } from '@/features/publishing/publish-consumption'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Retries ONE failed channel of an already approved mission.
 * Everything that gets published (approval record, exact payload, previous receipts) is loaded from the
 * server-persisted mission — the client only names the mission and the channel (ANI-1515).
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const missionId = typeof body.missionId === 'string' ? body.missionId : ''
    const targetChannel = body.targetChannel as DualPublishChannel
    if (!UUID.test(missionId) || (targetChannel !== 'instagram' && targetChannel !== 'threads')) {
      return NextResponse.json({ error: '게시물과 대상 채널 정보가 필요합니다.', code: 'INVALID_INPUT' }, { status: 422 })
    }

    const adminClient = createAdminSupabaseClient() as any
    const { data: mission, error: readErr } = await adminClient
      .from('marketing_missions')
      .select('id, workspace_id, status, metadata, updated_at')
      .eq('id', missionId)
      .maybeSingle()
    if (readErr) {
      return NextResponse.json({ error: '게시물을 불러오지 못했어요.', code: 'DB_READ_ERROR' }, { status: 500 })
    }

    // Membership is checked against the mission's own workspace, never "the user's first workspace".
    const { data: member } = mission
      ? await adminClient
          .from('workspace_members')
          .select('workspace_id, role')
          .eq('workspace_id', mission.workspace_id)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle()
      : { data: null }
    if (!mission || !member) {
      return NextResponse.json({ error: '재시도할 게시물을 찾을 수 없어요.', code: 'MISSION_NOT_FOUND' }, { status: 404 })
    }
    if (member.role !== 'owner' && member.role !== 'manager') {
      return NextResponse.json({ error: '이 작업은 매장 대표 또는 관리자만 할 수 있어요' }, { status: 403 })
    }
    const workspaceId = mission.workspace_id as string

    if (!isMetaLiveAllowed(workspaceId)) {
      return NextResponse.json({
        error: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
        code: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      }, { status: 403 })
    }

    if (!['FAILED', 'EXECUTING'].includes(mission.status)) {
      return NextResponse.json({ error: '재시도할 수 있는 상태가 아니에요.', code: 'INVALID_MISSION_STATE' }, { status: 409 })
    }

    const approvedMission = mission.metadata?.approvedMission as ApprovedFirstPostMission | undefined
    const currentPayload = mission.metadata?.payload as ExactApprovalPayload | undefined
    if (!approvedMission || !currentPayload || currentPayload.workspaceId !== workspaceId) {
      return NextResponse.json({ error: '승인 기록이 없어 재시도할 수 없어요.', code: 'CORRUPTED_APPROVAL_METADATA' }, { status: 422 })
    }
    const existingReceipts = (mission.metadata?.executionResult?.receipts || {}) as Record<DualPublishChannel, DualPublishChannelReceipt>
    // Run deterministic guards before claiming: rejected requests must not strand the lock.
    validateApprovalForPublish(approvedMission, currentPayload)
    if (!currentPayload.channels.some((channel) => channel.provider === targetChannel)) {
      return NextResponse.json({ error: '승인되지 않은 채널이에요.', code: 'INVALID_RETRY_CHANNEL' }, { status: 422 })
    }
    if (existingReceipts[targetChannel]?.stage === 'EXTERNALLY_VERIFIED') {
      return NextResponse.json({ error: '이미 발행이 확인된 채널이에요.', code: 'CHANNEL_ALREADY_VERIFIED' }, { status: 422 })
    }
    if (mission.metadata?.retryLock) {
      return NextResponse.json({ error: '이미 재시도 중이거나 처리할 수 없는 상태예요.', code: 'CONCURRENT_RETRY_IN_PROGRESS', reason: 'HUMAN_REVIEW' }, { status: 409 })
    }

    // Invariant 2 (R2): If mission is EXECUTING, but target channel has no receipt or no providerPostId,
    // execution outcome is uncertain / stranded. Automated re-publishing is blocked to prevent double posting.
    if (mission.status === 'EXECUTING') {
      const targetReceipt = existingReceipts[targetChannel]
      const hasProviderId = Boolean(targetReceipt?.providerPostId)
      if (!targetReceipt || !hasProviderId) {
        return NextResponse.json(
          {
            error: '이전 발행 작업의 외부 처리 결과를 확인할 수 없어 수동 확인이 필요해요.',
            code: 'STRANDED_EXECUTION_NEEDS_REVIEW',
            reason: 'HUMAN_REVIEW',
          },
          { status: 409 }
        )
      }
    }

    // Invariant 4 (R4): If previous attempt was RESULT_UNKNOWN without providerPostId, block automated retry
    if (existingReceipts[targetChannel]?.stage === 'RESULT_UNKNOWN' && !existingReceipts[targetChannel]?.providerPostId) {
      return NextResponse.json(
        {
          error: '이전 발행 결과가 불확실하여 자동 재발행이 차단되었어요. 수동 확인이 필요해요.',
          code: 'RESULT_UNKNOWN_RETRY_BLOCKED',
          reason: 'HUMAN_REVIEW',
        },
        { status: 409 }
      )
    }

    // P0: Re-validate approved fact snapshot freshness immediately before retryLock claim & retry provider call
    const factReader = createWorkspaceFactReader(
      workspaceId,
      async (columns, options) => {
        const { data, error, count } = await adminClient
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

    // Claim the persisted mission before any provider call. The JSON predicate prevents
    // two requests that read the same FAILED/EXECUTING snapshot from both publishing.
    const retryLock = randomUUID()
    const lockedAt = new Date().toISOString()
    const claim = adminClient.from('marketing_missions').update({
      status: 'EXECUTING',
      metadata: { ...mission.metadata, retryLock, snapshot_version: nextMissionSnapshotVersion(mission.metadata) },
      updated_at: lockedAt,
    }).eq('id', missionId).eq('workspace_id', workspaceId).is('metadata->>retryLock', null)
    const { data: claimedRows, error: claimError } = await fenceMissionSnapshot(claim, mission).select('id')
    if (claimError) console.error('[publish/retry] claim failed:', claimError)
    if (claimError || !claimedRows?.length) {
      return NextResponse.json({ error: '이미 재시도 중이거나 처리할 수 없는 상태예요.', code: 'CONCURRENT_RETRY_IN_PROGRESS' }, { status: 409 })
    }

    const isContractMission = Boolean(mission.metadata?.contract)
    const workerObservedEpoch = typeof mission.metadata?.control_epoch === 'number'
      ? mission.metadata.control_epoch
      : undefined

    const retryResult: DualPublishExecutionResult = await retryFailedChannelPublish({
      approvedMission,
      currentPayload,
      targetChannel,
      existingReceipts,
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

    const missionDbStatus =
      retryResult.overallStatus === 'ALL_VERIFIED'
        ? 'PUBLISHED_VERIFIED'
        : retryResult.overallStatus === 'PARTIAL_SUCCESS'
          ? 'EXECUTING'
          : 'FAILED'

    const saved = await persistPublishResult(adminClient, {
      missionId, workspaceId, lock: retryLock, result: retryResult, finalStatus: missionDbStatus, claimedMetadata: mission.metadata,
    })
    if (!saved) {
      return NextResponse.json(
        { success: false, error: '재시도 결과를 저장하지 못했어요.', code: 'RECONCILIATION_REQUIRED', executionResult: retryResult },
        { status: 500 },
      )
    }

    await adminClient
      .from('mission_events')
      .insert({
        mission_id: missionId,
        workspace_id: workspaceId,
        trace_id: `trace_${Date.now()}`,
        from_status: mission.status,
        to_status: saved.status,
        actor_type: 'user',
        actor_id: user.id,
        event_name: 'FIRST_POST_CHANNEL_RETRY_PUBLISHED',
        payload: { targetChannel, overallStatus: retryResult.overallStatus, receipts: retryResult.receipts },
      })
      .catch((e: any) => console.warn('[publish/retry] mission_events insert warning:', e?.message || e))

    return NextResponse.json({ success: retryResult.overallStatus === 'ALL_VERIFIED', executionResult: retryResult })
  } catch (err: any) {
    console.error('[missions/first-post/publish/retry error]:', err)
    const statusCode =
      err.message?.includes('CHANNEL_ALREADY_VERIFIED') || err.message?.includes('APPROVAL_FINGERPRINT_TAMPERED')
        ? 422
        : err.message?.includes('RESULT_UNKNOWN_RETRY_BLOCKED') || err.message?.includes('STRANDED_EXECUTION_NEEDS_REVIEW')
          ? 409
          : 500
    const code =
      err.message?.includes('RESULT_UNKNOWN_RETRY_BLOCKED')
        ? 'RESULT_UNKNOWN_RETRY_BLOCKED'
        : err.message?.includes('STRANDED_EXECUTION_NEEDS_REVIEW')
          ? 'STRANDED_EXECUTION_NEEDS_REVIEW'
          : err.message?.includes('CHANNEL_ALREADY_VERIFIED')
            ? 'CHANNEL_ALREADY_VERIFIED'
            : 'RETRY_FAILED'
    const reason =
      code.includes('UNKNOWN') || code.includes('REVIEW') ? 'HUMAN_REVIEW' : undefined
    return NextResponse.json(
      { error: '게시물 재시도 중 오류가 발생했어요.', code, ...(reason ? { reason } : {}) },
      { status: statusCode }
    )
  }
}
