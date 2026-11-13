export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  reviseFirstPostMissionDraft,
  calculateApprovalFingerprint,
  type FirstPostMissionDraft,
} from '@/features/missions/conversational-first-post'
import { attachFirstPostCtas } from '@/features/missions/first-post-cta'
import { prepareFirstPostCopySave } from '@/features/missions/first-post-copy-save'

/**
 * 저장 후 readback 정합 검증 (ANI-1787).
 *
 * 지문 문자열만 같다고 저장 성공으로 보지 않는다. 본문·CTA·사진·권리·바인딩 버전·채널이
 * 모두 저장본과 일치하고, **저장된 payload 로 지문을 다시 계산한 값**까지 같아야 한다.
 * 하나라도 어긋나면 저장 성공으로 응답하지 않는다.
 */
/**
 * DB 왕복(JSONB)에서 키 순서나 undefined→누락 정규화는 같은 의미다. 값 자체가 다르면 다르다.
 * 문자열(원고)은 정규화하지 않는다 — 공백 변형도 다른 값으로 본다.
 */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = stableValue(source[key])
    }
    return out
  }
  return value
}

function sameMeaning(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

function readbackMatchesSave(stored: any, expected: FirstPostMissionDraft): boolean {
  if (!stored || typeof stored !== 'object') return false
  // 1) 지문 대상 필드: 값이 그대로인지 확인한다(문자열은 정확히 일치해야 한다).
  if (stored.approvalFingerprint !== expected.approvalFingerprint) return false
  if (stored.copies?.instagram?.caption !== expected.copies.instagram.caption) return false
  if (stored.copies?.instagram?.cta !== expected.copies.instagram.cta) return false
  if (stored.copies?.threads?.content !== expected.copies.threads.content) return false
  if (stored.copies?.threads?.cta !== expected.copies.threads.cta) return false
  if (!sameMeaning(stored.selectedImageIds, expected.selectedImageIds)) return false
  if (!sameMeaning(stored.rights, expected.rights)) return false
  if (!sameMeaning(stored.boundVersions, expected.boundVersions)) return false
  if (!sameMeaning(stored.channels, expected.channels)) return false

  // 2) 지문 대상이 아닌 필드: 지문이 같아도 화면이 보는 값이 다르면 저장 성공이 아니다.
  //    mediaPreviews(사진 주소)·knowledgeSnapshot(매장 지식)은 지문 계산에 들어가지 않으므로 별도 비교한다.
  if (!sameMeaning(stored.mediaPreviews, expected.mediaPreviews)) return false
  if (!sameMeaning(stored.knowledgeSnapshot, expected.knowledgeSnapshot)) return false

  // 3) 저장된 payload 로 지문을 다시 계산해 저장 지문과 대조한다(지문 자체 위조 차단).
  const recalculated = calculateApprovalFingerprint({
    workspaceId: expected.workspaceId,
    missionId: expected.missionId,
    channels: stored.channels,
    copies: stored.copies,
    imageIds: stored.selectedImageIds,
    boundVersions: stored.boundVersions,
    rights: stored.rights,
  })
  return recalculated === stored.approvalFingerprint
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const parsedBody: unknown = await req.json().catch(() => ({}))
    // JSON 객체가 아닌 본문(null·원시값·배열)은 필드 검증 전에 닫는다.
    if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json(
        { error: '요청 본문은 JSON 객체여야 합니다.', code: 'INVALID_BODY' },
        { status: 422 }
      )
    }
    const body = parsedBody as Record<string, any>
    const { missionId, revisionType = 'TEXT_ONLY', feedbackUtterance = '' } = body
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

    const workspaceId = resolved.workspaceId

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: '미션 식별자(missionId)가 필요합니다.' }, { status: 422 })
    }

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    const adminClient = createAdminSupabaseClient()
    const client = adminClient as any

    // 1. Load mission from database
    const { data: mission, error: loadErr } = await client
      .from('marketing_missions')
      .select('*')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (loadErr || !mission) {
      return NextResponse.json(
        { error: '수정할 미션을 찾을 수 없습니다.', code: 'MISSION_NOT_FOUND' },
        { status: 404 }
      )
    }

    const currentDraft: FirstPostMissionDraft =
      mission.metadata?.draft || mission.metadata?.payload

    if (!currentDraft) {
      return NextResponse.json(
        { error: '미션 초안 메타데이터가 손상되었습니다.', code: 'DRAFT_METADATA_CORRUPTED' },
        { status: 422 }
      )
    }

    // ANI-1787: body 에 copies 키가 있으면 사용자 직접 문구 수정 저장 분기 (LLM 재생성 우회 차단)
    if ('copies' in body) {
      // 문구 저장 권위: 소유자·관리자만. role 이름은 기존 WorkspaceRole 계약을 그대로 쓴다.
      if (resolved.role !== 'owner' && resolved.role !== 'manager') {
        return NextResponse.json(
          { error: '문구 수정 저장은 작업공간 소유자와 관리자만 할 수 있습니다.', code: 'INSUFFICIENT_ROLE' },
          { status: 403 }
        )
      }

      const { expectedFingerprint, copies } = body
      if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedFingerprint)) {
        return NextResponse.json(
          { error: '유효한 64자리 16진수 승인 지문(expectedFingerprint)이 필요합니다.', code: 'INVALID_FINGERPRINT' },
          { status: 422 }
        )
      }

      // Terminal / non-modifiable state check
      if (mission.status !== 'AWAITING_APPROVAL' && mission.status !== 'DRAFT') {
        return NextResponse.json(
          { error: '현재 상태에서는 문구를 수정할 수 없습니다.', code: 'IMMUTABLE_MISSION_STATUS' },
          { status: 409 }
        )
      }

      if (!mission.updated_at) {
        return NextResponse.json(
          { error: '동시성 제어를 위한 갱신 시각(updated_at)이 없어 저장을 진행할 수 없습니다.', code: 'MISSING_CAS_TIMESTAMP' },
          { status: 409 }
        )
      }

      const savePrep = prepareFirstPostCopySave({
        draft: currentDraft,
        expectedFingerprint,
        copies,
      })

      if (!savePrep.ok) {
        const status = savePrep.code === 'STALE_APPROVAL' ? 409 : 422
        return NextResponse.json(
          { error: savePrep.message, code: savePrep.code },
          { status }
        )
      }

      const { revisedDraft } = savePrep
      const nowIso = new Date().toISOString()

      const updateQuery = client
        .from('marketing_missions')
        .update({
          status: 'AWAITING_APPROVAL',
          metadata: {
            ...mission.metadata,
            draft: revisedDraft,
            draftFingerprint: revisedDraft.approvalFingerprint,
            payload: {
              missionId: revisedDraft.missionId,
              workspaceId,
              channels: revisedDraft.channels,
              copies: revisedDraft.copies,
              imageIds: revisedDraft.selectedImageIds,
              boundVersions: revisedDraft.boundVersions,
              rights: revisedDraft.rights,
            },
            lastDeltaExplanation: '사용자가 직접 원고를 수정했습니다.',
            lastRevisedAt: nowIso,
            priorApprovalInvalidated: true,
          },
          updated_at: nowIso,
        })
        .eq('id', missionId)
        .eq('workspace_id', workspaceId)
        .eq('updated_at', mission.updated_at)

      const { data: updatedRows, error: updateErr } = await updateQuery.select('id, status')

      if (updateErr) {
        return NextResponse.json(
          { error: `수정 미션 저장 실패: ${updateErr.message}` },
          { status: 500 }
        )
      }

      if (!updatedRows || updatedRows.length === 0) {
        return NextResponse.json(
          {
            error: '동시성 충돌: 초안이 다른 작업에 의해 이미 갱신되거나 승인되었습니다. 최신 초안을 다시 불러와 주세요.',
            code: 'CONCURRENT_REVISION_CONFLICT',
          },
          { status: 409 }
        )
      }

      // Readback verification from DB
      const { data: readbackMission, error: readbackErr } = await client
        .from('marketing_missions')
        .select('metadata')
        .eq('id', missionId)
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      const readbackDraft = readbackMission?.metadata?.draft
      // 지문 문자열만 비교하지 않는다 — 지문 대상 필드·비대상 필드(사진/지식)·재계산 지문을 모두 대조한다.
      if (readbackErr || !readbackDraft || !readbackMatchesSave(readbackDraft, revisedDraft)) {
        return NextResponse.json(
          { error: '저장 후 검증에 실패했습니다. 최신 초안을 다시 조회해 주세요.', code: 'READBACK_VERIFICATION_FAILED' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        draft: readbackDraft,
        deltaExplanation: '수정하신 원고가 저장되었습니다.',
        message: '내용이 바뀌어서 다시 확인이 필요해요.',
      })
    }

    // 2. Perform partial revision
    if (!currentDraft.knowledgeSnapshot?.businessName?.trim()) {
      return NextResponse.json(
        {
          error: '확인된 매장 지식 정보(knowledgeSnapshot.businessName)가 없어 수정을 진행할 수 없습니다.',
          code: 'PERSISTED_KNOWLEDGE_SNAPSHOT_REQUIRED',
        },
        { status: 422 }
      )
    }
    const bizName = currentDraft.knowledgeSnapshot.businessName.trim()
    const signatureServices = currentDraft.knowledgeSnapshot.signatureServices
    const primaryService = signatureServices?.[0]

    let newCopies = undefined
    if (revisionType === 'TEXT_ONLY' || revisionType === 'BOTH') {
      const { composeFirstPostWithGemini } = await import('@/features/missions/conversational-first-post')
      const composed = await composeFirstPostWithGemini({
        bizName,
        primaryService,
        feedbackUtterance,
        topic: currentDraft.topic,
      })
      // ANI-1775: 수정본도 같은 규칙으로 CTA 를 다시 판정한다. 근거가 없으면 필드를 만들지 않는다.
      // 초안의 channels 는 미연결 행을 포함할 수 있어, 연결 상태를 다시 읽어 connected 만 근거로 쓴다.
      // 근거를 못 읽으면(오류 포함) CTA 를 만들지 않는다(fail-closed). 문구 수정 자체는 계속 진행한다.
      let connectedStatusChannels = new Set<string>()
      try {
        const { data: connectionRows, error: connectionErr } = await client
          .from('channel_connections')
          .select('channel,status')
          .eq('workspace_id', workspaceId)
          .in('channel', ['instagram', 'threads'])
        if (!connectionErr && Array.isArray(connectionRows)) {
          connectedStatusChannels = new Set(
            connectionRows.filter((row: any) => row.status === 'connected').map((row: any) => row.channel),
          )
        }
      } catch (connectionReadErr) {
        console.warn('[missions/first-post/revise] channel read unavailable, omitting CTA:', connectionReadErr)
      }
      newCopies = attachFirstPostCtas(composed, {
        businessName: bizName,
        signatureServices,
        operatingHours: currentDraft.knowledgeSnapshot?.operatingHours,
        connectedChannels: (currentDraft.channels ?? []).filter((ch) =>
          connectedStatusChannels.has(ch.provider),
        ),
      })
    }

    let newImageIds: string[] | undefined = undefined
    let mediaPreviews: Array<{ id: string; url: string }> | undefined = undefined

    if (revisionType === 'IMAGE_ONLY' || revisionType === 'BOTH') {
      const { createProductionGenerationOrchestrator } = await import(
        '@/features/creative/production-generation-factory'
      )
      const { buildVisualBrief } = await import(
        '@/features/creative/visual-brief-builder'
      )
      const { createHash } = await import('node:crypto')

      const orchestrator = createProductionGenerationOrchestrator({
        supabaseClient: adminClient,
        workspaceId,
        userId: user.id,
      })

      const prompt = feedbackUtterance?.trim() || currentDraft.topic || '첫 게시물 대표 이미지'
      const stylePreset = currentDraft.rights?.consentStatus === 'NOT_APPLICABLE' ? 'flare' : 'sunburst'
      const clientOpKey = (typeof body.operationId === 'string' && body.operationId.trim()) ||
                          (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim())
      const stableKeySuffix = clientOpKey || createHash('sha256')
        .update(`${workspaceId}:${missionId}:${currentDraft.approvalFingerprint}:${revisionType}:${prompt}`)
        .digest('hex').slice(0, 24)

      const idempotencyKey = `img_rev_${workspaceId}_${missionId}_${stableKeySuffix}`
      const requestFingerprint = createHash('sha256')
        .update(`${workspaceId}:${missionId}:${prompt}:${stylePreset}:${stableKeySuffix}`)
        .digest('hex')

      const confirmedKeywords = signatureServices && signatureServices.length > 0 ? signatureServices : undefined
      const confirmedSellingPoints = signatureServices && signatureServices.length > 0 ? signatureServices : undefined

      const visualBrief = buildVisualBrief({
        workspaceId,
        contentVersionId: `onboarding_rev_${missionId}`,
        businessContext: {
          name: bizName,
          keywords: confirmedKeywords,
        },
        productContext: {
          ...(primaryService ? { name: primaryService } : {}),
          sellingPoints: confirmedSellingPoints,
        },
        channel: 'instagram',
        caption: prompt,
      })


      const result = await orchestrator.execute({
        idempotencyKey,
        requestFingerprint,
        sequenceNumber: 1,
        workspaceId,
        userId: user.id,
        contentVersionId: `onboarding_rev_${missionId}`,
        visualBrief,
        size: '1024x1024',
        stylePreset,
      })

      if (result.status !== 'READY' || !result.mediaAsset) {
        return NextResponse.json(
          {
            error: result.error?.message || '이미지 재생성에 실패했습니다.',
            code: 'IMAGE_GENERATION_FAILED',
          },
          { status: 500 }
        )
      }

      const newAssetId = result.mediaAsset.id
      newImageIds = [newAssetId]
      mediaPreviews = [
        {
          id: newAssetId,
          url: `/api/workspaces/${workspaceId}/media/${newAssetId}`,
        },
      ]
    }

    const { revisedDraft, deltaExplanation } = reviseFirstPostMissionDraft({
      draft: currentDraft,
      revisionType,
      feedbackUtterance,
      newCopies,
      newImageIds,
      mediaPreviews,
    })

    // 3. Atomically update DB with CAS on read state and invalidate prior approval to AWAITING_APPROVAL
    let updateQuery = client
      .from('marketing_missions')
      .update({
        status: 'AWAITING_APPROVAL',
        metadata: {
          ...mission.metadata,
          draft: revisedDraft,
          draftFingerprint: revisedDraft.approvalFingerprint,
          payload: {
            missionId: revisedDraft.missionId,
            workspaceId,
            channels: revisedDraft.channels,
            copies: revisedDraft.copies,
            imageIds: revisedDraft.selectedImageIds,
            boundVersions: revisedDraft.boundVersions,
            rights: revisedDraft.rights,
          },
          lastDeltaExplanation: deltaExplanation,
          lastRevisedAt: new Date().toISOString(),
          priorApprovalInvalidated: true,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)

    if (mission.updated_at) {
      updateQuery = updateQuery.eq('updated_at', mission.updated_at)
    }

    const { data: updatedRows, error: updateErr } = await updateQuery.select('id, status')

    if (updateErr) {
      return NextResponse.json(
        { error: `수정 미션 저장 실패: ${updateErr.message}` },
        { status: 500 }
      )
    }

    if (mission.updated_at && (!updatedRows || updatedRows.length === 0)) {
      return NextResponse.json(
        {
          error: '동시성 충돌: 초안이 다른 작업에 의해 이미 갱신되거나 승인되었습니다. 최신 초안을 다시 불러와 주세요.',
          code: 'CONCURRENT_REVISION_CONFLICT',
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      draft: revisedDraft,
      deltaExplanation,
      message: '내용이 바뀌어서 다시 확인이 필요해요.',
    })
  } catch (err: any) {
    console.error('[missions/first-post/revise error]:', err)
    return NextResponse.json(
      { error: err.message || '미션 수정 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
