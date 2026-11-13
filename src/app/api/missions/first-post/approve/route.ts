export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  confirmExactApproval,
  calculateApprovalFingerprint,
  type ExactApprovalPayload,
} from '@/features/missions/conversational-first-post'
import {
  revalidateApprovedFactSnapshot,
  getDefaultFactSnapshotResolver,
  createWorkspaceFactReader,
} from '@/features/publishing/fact-snapshot-gate'
import {
  fenceMissionSnapshot,
  nextMissionSnapshotVersion,
} from '@/features/publishing/publish-consumption'
import { validateMissionContract } from '@/lib/mission-os/mission-contract'

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
    const adminClient = createAdminSupabaseClient()
    const missionId = typeof body.missionId === 'string'
      ? body.missionId
      : typeof body.payload?.missionId === 'string'
      ? body.payload.missionId
      : ''

    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : ''
    const isExplicitlyApproved = body.isExplicitlyApproved === true
    const explicitPhrase = typeof body.explicitPhrase === 'string' ? body.explicitPhrase : ''

    if (!missionId) {
      return NextResponse.json(
        { error: 'missionId가 필요합니다.', code: 'MISSION_ID_REQUIRED' },
        { status: 422 }
      )
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId)
    if (!isUuid) {
      return NextResponse.json(
        { error: 'missionId는 유효한 UUID 형식이어야 합니다.', code: 'INVALID_MISSION_UUID' },
        { status: 422 }
      )
    }

    // R2-B3: Load server-persisted DRAFT/AWAITING_APPROVAL mission (DO NOT trust client payload!)
    const { data: mission, error: readError } = await (adminClient as any)
      .from('marketing_missions')
      .select('id, workspace_id, status, metadata, updated_at')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (readError) {
      console.error('[missions/first-post/approve] DB read error:', readError)
      return NextResponse.json(
        { error: '미션 조회 중 오류가 발생했어요.', code: 'DB_READ_ERROR' },
        { status: 500 }
      )
    }

    if (!mission) {
      return NextResponse.json(
        { error: '승인 대상 미션 초안을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' },
        { status: 404 }
      )
    }

    // Must be in AWAITING_APPROVAL or DRAFT state
    const allowedDraftStatuses = ['AWAITING_APPROVAL', 'DRAFT']
    if (!allowedDraftStatuses.includes(mission.status)) {
      return NextResponse.json(
        {
          error: `현재 미션 상태(${mission.status})에서는 승인할 수 없습니다. 미션이 초안(AWAITING_APPROVAL) 상태여야 합니다.`,
          code: 'INVALID_MISSION_STATE',
        },
        { status: 409 }
      )
    }

    // Restore server-persisted draft payload
    const persistedPayload = mission.metadata?.payload as ExactApprovalPayload
    if (!persistedPayload || !persistedPayload.workspaceId) {
      return NextResponse.json(
        { error: '미션 초안 메타데이터가 손상되었습니다.', code: 'CORRUPTED_DRAFT_METADATA' },
        { status: 422 }
      )
    }

    // Cross-tenant check on persisted payload
    if (persistedPayload.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: '타 매장의 미션을 승인할 권한이 없습니다.', code: 'CROSS_TENANT_ACCESS_DENIED' },
        { status: 403 }
      )
    }

    // Recalculate fingerprint strictly from SERVER-persisted payload
    const calculatedFingerprint = calculateApprovalFingerprint(persistedPayload)
    if (calculatedFingerprint !== fingerprint) {
      return NextResponse.json(
        {
          error: `승인 지문과 저장된 초안 지문이 일치하지 않습니다. (제시: ${fingerprint}, 계산: ${calculatedFingerprint})`,
          code: 'FINGERPRINT_MISMATCH_REJECTED',
        },
        { status: 422 }
      )
    }

    // P0: Re-validate approved fact snapshot freshness before approval & CAS
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

    // ANI-1627/1630: service policy + CTA destination gate on the real approval path
    const { evaluateMissionSalesGate } = await import('@/features/sales-actions/route-gate')
    const salesGate = evaluateMissionSalesGate(mission.metadata, { workspaceId, now: new Date().toISOString() })
    if (salesGate.status === 'BLOCK') {
      return NextResponse.json(
        { error: salesGate.ownerMessage, code: salesGate.code, alternative: salesGate.alternative, salesGate: { status: salesGate.status, code: salesGate.code } },
        { status: 422 }
      )
    }

    // ANI-1879: Fencing paused, stopped, or closed missions before approval
    if (
      mission.metadata?.execution_state === 'PAUSED' ||
      mission.metadata?.execution_state === 'STOPPED' ||
      mission.metadata?.execution_state === 'CLOSED'
    ) {
      return NextResponse.json(
        {
          error: '일시정지되거나 이미 완료된 미션은 승인할 수 없어요.',
          code: 'INVALID_EXECUTION_STATE',
        },
        { status: 409 }
      )
    }

    // Confirm exact approval domain invariants
    const approvedMission = confirmExactApproval({
      payload: persistedPayload,
      fingerprint,
      isExplicitlyApproved,
      explicitPhrase,
      approvedByUserId: user.id,
    })

    const nextSnapshotVersion = nextMissionSnapshotVersion(mission.metadata)
    const nextControlEpoch = (mission.metadata?.control_epoch ?? 0) + 1

    // R2-B3: Atomic update-only transition from AWAITING_APPROVAL/DRAFT to APPROVED (CAS)
    let updatedContract: any = undefined
    if (mission.metadata?.contract) {
      const origContract = mission.metadata.contract

      // 이미 승인된 계약의 재요청인 경우 불필요 재연장 금지
      if (origContract.approval_fingerprint) {
        updatedContract = origContract
      } else {
        const approvedAtIso = approvedMission.approvedAt
        const approvedAtTime = Date.parse(approvedAtIso)

        const origEffective = Date.parse(origContract.effective_at)
        const origObsStart = Date.parse(origContract.observation_window?.start_at)
        const origObsEnd = Date.parse(origContract.observation_window?.end_at)
        const origExpires = Date.parse(origContract.expires_at)

        // 계약 필수 시각 필드 및 선후관계 검증 (잘못된 contract failclosed)
        if (
          Number.isNaN(origEffective) ||
          Number.isNaN(origObsStart) ||
          Number.isNaN(origObsEnd) ||
          Number.isNaN(origExpires) ||
          Number.isNaN(approvedAtTime) ||
          origObsEnd <= origObsStart ||
          origExpires <= origEffective ||
          origExpires <= origObsEnd
        ) {
          return NextResponse.json(
            { error: '미션 계약의 관측 기간 또는 만료 시각이 유효하지 않습니다.', code: 'INVALID_MISSION_CONTRACT' },
            { status: 422 }
          )
        }

        const obsWindowDuration = origObsEnd - origObsStart
        const obsStartOffset = Math.max(0, origObsStart - origEffective)
        const expiryDuration = origExpires - origEffective

        const rebasedObsStart = new Date(approvedAtTime + obsStartOffset).toISOString()
        const rebasedObsEnd = new Date(approvedAtTime + obsStartOffset + obsWindowDuration).toISOString()
        const rebasedExpiresAt = new Date(
          Math.max(approvedAtTime + expiryDuration, approvedAtTime + obsStartOffset + obsWindowDuration + 1000)
        ).toISOString()

        const candidateContract = {
          ...origContract,
          approval_fingerprint: approvedMission.approvedFingerprint,
          effective_at: approvedAtIso,
          observation_window: {
            ...origContract.observation_window,
            start_at: rebasedObsStart,
            end_at: rebasedObsEnd,
          },
          expires_at: rebasedExpiresAt,
        }

        try {
          updatedContract = validateMissionContract(candidateContract)
        } catch (validationErr: any) {
          console.error('[missions/first-post/approve] contract validation failed after rebasing:', validationErr)
          return NextResponse.json(
            { error: '승인 계약 규격을 만족하지 못했습니다.', code: 'INVALID_MISSION_CONTRACT' },
            { status: 422 }
          )
        }
      }
    }

    const updatedMetadata = {
      ...mission.metadata,
      approvedFingerprint: approvedMission.approvedFingerprint,
      approvedMission,
      approvedByUserId: user.id,
      approvedAt: approvedMission.approvedAt,
      boundVersions: persistedPayload.boundVersions,
      rights: persistedPayload.rights,
      channels: persistedPayload.channels,
      copies: persistedPayload.copies,
      selectedImageIds: persistedPayload.imageIds,
      snapshot_version: nextSnapshotVersion,
      control_epoch: nextControlEpoch,
      ...(updatedContract
        ? {
            contract: updatedContract,
            execution_state: 'READY',
            approval_fingerprint: approvedMission.approvedFingerprint,
          }
        : {}),
    }

    let approveQuery = (adminClient as any)
      .from('marketing_missions')
      .update({
        status: 'APPROVED',
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)

    approveQuery = fenceMissionSnapshot(approveQuery, mission)

    const { data: updatedRows, error: updateError } = await approveQuery.select('id, status')

    if (updateError) {
      console.error('[missions/first-post/approve] DB update error:', updateError)
      return NextResponse.json(
        {
          error: '승인 결과를 저장하지 못했어요.',
          code: 'PERSISTENCE_ERROR',
        },
        { status: 500 }
      )
    }

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        {
          error: '동시성 충돌 또는 이미 상태가 변경되어 승인에 실패했습니다.',
          code: 'CONCURRENT_APPROVAL_CONFLICT',
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      approved: approvedMission,
      salesGate: { status: salesGate.status, code: salesGate.code, warnings: salesGate.warnings },
      message: '첫 게시물이 정밀 승인되었습니다. (APPROVED_FOR_PUBLISH)',
    })
  } catch (err: any) {
    console.error('[missions/first-post/approve error]:', err)
    const statusCode =
      err.message?.includes('EXPLICIT_APPROVAL_PHRASE_REQUIRED') ||
      err.message?.includes('FINGERPRINT_MISMATCH_REJECTED')
        ? 422
        : err.statusCode || 500

    return NextResponse.json(
      {
        error: '첫 게시물 승인 중 오류가 발생했어요.',
        code: 'INTERNAL_ERROR',
      },
      { status: statusCode }
    )
  }
}
