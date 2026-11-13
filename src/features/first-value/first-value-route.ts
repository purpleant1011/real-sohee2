import { NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readQuickPostApprovalReadiness } from '@/features/quick-start/quick-post-approval-readiness'
import { ensureQuickPostVaultVersions, getQuickPostApprovalOptions, QuickPostVaultError } from '@/features/quick-start/quick-post-vault-contract'
import { evaluateGate } from '@/features/readiness'
import * as quickPostRuntime from '@/features/quick-start/quick-post-service'
import { createQuickDraft, listQuickPosts, QuickPostError } from '@/features/quick-start/quick-post-service'
import {
  QuickPostCreditFailure,
  reconcileQuickPostOrphan,
  settleQuickPostCredits,
  type QuickPostReservation,
} from '@/features/quick-start/quick-post-credits'
import { recordFunnelEvent } from '@/features/quick-start/funnel-events'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import { resolveFirstValueSourceIds, firstValueSourceCookieName, FirstValueSourceError } from '@/features/media/first-value-source'
import { loadQuickStartPreferences } from '@/features/quick-start/quick-start-service'
import { buildFirstValueView } from './first-value'

function isTerminalMission(mission?: { status?: string | null; metadata?: any } | null): boolean {
  if (!mission) return false
  const status = mission.status
  const meta = mission.metadata || {}
  const execState = meta.execution_state
  const outcomeState = meta.outcome_state

  if (status === 'CANCELLED' || status === 'FAILED') return true
  if (execState === 'STOPPED' || execState === 'CLOSED' || execState === 'CANCELLED') return true
  if (
    outcomeState === 'ACHIEVED_VERIFIED' ||
    outcomeState === 'NOT_ACHIEVED_IN_WINDOW' ||
    outcomeState === 'NOT_OBSERVABLE' ||
    outcomeState === 'WITHDRAWN'
  ) {
    return true
  }
  return false
}

/** Called only server-side; existing quick-start creates the actual profile/rules. */
export async function handleFirstValue(request?: Request): Promise<NextResponse> {
  const auth = await authorizeQuickRequest(request?.headers.get('x-workspace-id'), { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  try {
    const readiness = await readQuickPostApprovalReadiness(auth.admin, auth.workspaceId)
    const gate = evaluateGate(readiness, 'CREATE')
    if (!gate.allowed) {
      // ANI-1599: CREATE 게이트는 4대 퀵팩(PREPARE_ONLY)만 요구하고 채널 연결은 요구하지 않는다.
      // 채널이 없다는 이유로 CHANNEL_NOT_CONNECTED 를 돌려주면, 채널을 연결해도 풀리지 않는
      // 막다른 길로 사장님을 보낸다. 실제 차단 원인을 그대로 알린다. 상태 코드는 403 fail-closed 유지.
      const code = readiness.prepared ? 'CHANNEL_NOT_CONNECTED' : 'PREPARATION_INCOMPLETE'
      return NextResponse.json({ error: gate.message ?? '가게 정보를 먼저 알려 주세요.', code }, { status: 403 })
    }
    let requestedMissionId: string | null = null
    let textOnlyRequested = false
    let topicParam: string | null = null
    let querySourceAssetId: string | null = null
    let cookieSourceAssetId: string | null = null
    let cookieInvalid = false

    if (request) {
      try {
        const url = new URL(request.url)
        requestedMissionId = url.searchParams.get('missionId')?.trim() || null
        textOnlyRequested = url.searchParams.get('textOnly') === 'true'
        const rawTopic = url.searchParams.get('topic')?.trim()
        if (rawTopic !== undefined && rawTopic !== null && rawTopic.length > 0) {
          if (rawTopic.length > 300) {
            return NextResponse.json({
              error: '원하는 주제는 300자 이하로 적어 주세요.',
              code: 'INVALID_TOPIC',
            }, { status: 422 })
          }
          topicParam = rawTopic
        }
        querySourceAssetId = url.searchParams.get('sourceAssetId')
      } catch {
        // invalid request URL ignored
      }

      const cookieHeader = request.headers.get('cookie') || ''
      const cookieName = firstValueSourceCookieName(auth.workspaceId)
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`))
      if (match) {
        try {
          cookieSourceAssetId = decodeURIComponent(match[1])
          if (cookieSourceAssetId.trim().length === 0) {
            cookieInvalid = true
          }
        } catch {
          cookieInvalid = true
        }
      }
    }

    let item: quickPostRuntime.QuickPostSummary | null = null

    if (requestedMissionId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedMissionId)
      if (!isUuid) {
        return NextResponse.json({
          error: '올바른 형식의 missionId가 아닙니다.',
          code: 'INVALID_MISSION_UUID',
        }, { status: 422 })
      }
      const { data: requestedRow, error: reqErr } = await auth.admin
        .from('marketing_missions')
        .select('id, status, metadata, created_at')
        .eq('id', requestedMissionId)
        .eq('workspace_id', auth.workspaceId)
        .maybeSingle()

      if (reqErr) {
        console.error('[first-value] requested mission read failed:', reqErr)
        return NextResponse.json({
          error: '미션을 불러오는 중 오류가 발생했어요.',
          code: 'MISSION_READ_FAILED',
        }, { status: 503 })
      }
      if (!requestedRow) {
        return NextResponse.json({
          error: '요청한 미션을 찾을 수 없어요.',
          code: 'MISSION_NOT_FOUND',
        }, { status: 404 })
      }

      let currentFactSnapshot: any
      if (requestedRow.status === 'AWAITING_APPROVAL') {
        try {
          const { loadApprovedFactSnapshot } = await import('@/features/knowledge/approved-fact-resolver')
          currentFactSnapshot = await loadApprovedFactSnapshot(auth.admin, auth.workspaceId)
        } catch (factErr) {
          console.error('[first-value] fact snapshot load failed for requested mission:', factErr)
          return NextResponse.json({
            error: '가게 정보를 불러오지 못했어요.',
            code: 'FACT_READ_FAILED',
          }, { status: 503 })
        }
      }

      item = quickPostRuntime.summarize(auth.workspaceId, requestedRow, currentFactSnapshot)
      if (!item) {
        return NextResponse.json({
          error: '미션 데이터를 불러오지 못했어요.',
          code: 'INVALID_MISSION_DATA',
        }, { status: 422 })
      }

      // Check if reservation is still reserved and retry settle only AFTER quick draft is verified
      const targetRevision = item.revision ?? 1
      const { data: priorRes, error: priorErr } = await auth.admin
        .from('quick_post_credit_reservations')
        .select('id, state, credits, operation_key')
        .eq('workspace_id', auth.workspaceId)
        .eq('mission_id', requestedMissionId)
        .eq('revision', targetRevision)
        .maybeSingle()

      if (priorErr) {
        console.error('[first-value] reservation lookup failed for requested mission:', priorErr)
        return NextResponse.json({
          error: '크레딧 예약 내역을 불러오지 못했어요.',
          code: 'RESERVATION_READ_FAILED',
        }, { status: 503 })
      }

      if (priorRes?.state === 'reserved') {
        const reservation: QuickPostReservation = {
          reservationId: priorRes.id,
          state: priorRes.state,
          requestedCredits: priorRes.credits,
          operationKey: priorRes.operation_key,
          isReplay: true,
        }
        await settleQuickPostCredits(auth.admin, auth.workspaceId, reservation)
      }
    } else {
      // 활성 승인 대기 중(AWAITING_APPROVAL)이며 미종료(STOPPED/CLOSED/CANCELLED/ACHIEVED/WITHDRAWN 제외) 상태인 기존 초안이 있으면
      // 파라미터(topic/source) 변경 여부와 무관하게 해당 초안을 우선 유지·반환하여 중복 생성 및 다중 초안 과금을 방지하고 단일 완결 레인을 보장한다 (의도적 설계).
      const existing = await listQuickPosts(auth.admin, auth.workspaceId)
      const existingDraft = existing.find(post =>
        post.status === 'AWAITING_APPROVAL' &&
        post.executionState !== 'STOPPED' &&
        post.executionState !== 'CLOSED' &&
        post.executionState !== 'CANCELLED' &&
        post.outcomeState !== 'ACHIEVED_VERIFIED' &&
        post.outcomeState !== 'WITHDRAWN' &&
        (Boolean(post.copies?.threads?.content?.trim()) || Boolean(post.copies?.instagram?.caption?.trim()))
      ) ?? null
      if (existingDraft) {
        const targetRevision = existingDraft.revision ?? 1
        const { data: priorRes, error: priorErr } = await auth.admin
          .from('quick_post_credit_reservations')
          .select('id, state, credits, operation_key')
          .eq('workspace_id', auth.workspaceId)
          .eq('mission_id', existingDraft.missionId)
          .eq('revision', targetRevision)
          .maybeSingle()

        if (priorErr) {
          console.error('[first-value] reservation lookup failed for existing draft:', priorErr)
          return NextResponse.json({
            error: '크레딧 예약 내역을 불러오지 못했어요.',
            code: 'RESERVATION_READ_FAILED',
          }, { status: 503 })
        }

        if (priorRes?.state === 'reserved') {
          const reservation: QuickPostReservation = {
            reservationId: priorRes.id,
            state: priorRes.state,
            requestedCredits: priorRes.credits,
            operationKey: priorRes.operation_key,
            isReplay: true,
          }
          await settleQuickPostCredits(auth.admin, auth.workspaceId, reservation)
        }
        item = existingDraft
      }
    }

    if (!item) {
      let explicitAssetId: string | undefined
      if (querySourceAssetId !== null && querySourceAssetId !== undefined) {
        explicitAssetId = querySourceAssetId
      } else if (cookieInvalid) {
        throw new FirstValueSourceError('MEDIA_SELECTION_INVALID', 409, '사진 선택 정보가 올바르지 않아요.')
      } else if (cookieSourceAssetId && cookieSourceAssetId.trim().length > 0) {
        explicitAssetId = cookieSourceAssetId
      }

      const sourceAssetIds = await resolveFirstValueSourceIds({
        admin: auth.admin,
        workspaceId: auth.workspaceId,
        explicitAssetId,
      })

      if (sourceAssetIds.length > 0) {
        const contract = Reflect.get(quickPostRuntime, 'sourceAssetContract')
        if (contract !== 'v093-original-1') {
          return NextResponse.json({
            error: '사진을 사용한 글 작성을 준비하는 중이에요. 잠시 후 다시 시도해 주세요.',
            code: 'ORIGINAL_PHOTO_NOT_READY',
            actionHref: '/start?step=shop',
          }, { status: 503 })
        }
      }

      let preferences: Awaited<ReturnType<typeof loadQuickStartPreferences>>
      try {
        preferences = await loadQuickStartPreferences({ admin: auth.admin, workspaceId: auth.workspaceId })
      } catch {
        return NextResponse.json({
          error: '가게 목표와 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
          code: 'QUICK_START_READ_FAILED',
        }, { status: 503 })
      }
      const ownerGoal = preferences?.goal?.trim() || null
      const topic = topicParam || ownerGoal || '우리 가게 첫 인사'

      // 무사진 기본 텍스트(자동생성0) 계약:
      // 사진이 없으면(sourceAssetIds.length === 0), 명시적 텍스트 모드로 강제하여
      // DALL-E 이미지 자동 생성을 0건으로 보장하고 100 SC만 과금한다.
      const isTextOnly = sourceAssetIds.length === 0 || explicitAssetId === 'none' || textOnlyRequested

      // 입력+workspace+user+textOnly의 안정 root UUID를 만들고 해당 mission/reservation만 tenant-scoped 직접 조회.
      // released/terminal lifecycle이면 그 영속 id를 다음 key hash의 anchor로 순차 전진 (기록이 잘려 root로 회귀 금지; 순회한도 초과는 503).
      // RESERVED 만료는 시각만으로 새키 발급 금지. 다른 사용자/다른 입력 reservation 재사용 금지.
      const rootHash = createHash('sha256')
        .update(`first-post-draft:v1:${auth.workspaceId}:${auth.userId}:${topic.trim()}:${sourceAssetIds.join(',')}:${isTextOnly}`)
        .digest('hex')
      const rootRequestId = `${rootHash.slice(0, 8)}-${rootHash.slice(8, 12)}-4${rootHash.slice(13, 16)}-a${rootHash.slice(17, 20)}-${rootHash.slice(20, 32)}`

      let candidateId = rootRequestId
      const maxHops = 10

      for (let hop = 0; hop < maxHops; hop++) {
        const { data: resRow, error: resErr } = await auth.admin
          .from('quick_post_credit_reservations')
          .select('id, mission_id, state, created_at, operation_key, credits')
          .eq('workspace_id', auth.workspaceId)
          .eq('mission_id', candidateId)
          .eq('revision', 1)
          .maybeSingle()

        if (resErr) {
          console.error('[first-value] reservation lookup failed:', resErr)
          return NextResponse.json({
            error: '예약 내역을 확인하지 못했어요.',
            code: 'RESERVATION_READ_FAILED',
          }, { status: 503 })
        }

        if (!resRow) {
          // No reservation yet; candidateId is unreserved and ready.
          break
        }

        // Validate timestamp: fail-closed on missing, NaN, or future timestamp
        const createdAtTime = Date.parse(resRow.created_at || '')
        if (Number.isNaN(createdAtTime) || createdAtTime > Date.now() + 5000) {
          console.error('[first-value] invalid reservation created_at timestamp')
          return NextResponse.json({
            error: '크레딧 예약 정보가 올바르지 않아요.',
            code: 'INVALID_RESERVATION_TIMESTAMP',
          }, { status: 503 })
        }

        // Validate required metadata fields without arbitrary fallback (fail-closed)
        if (!resRow.operation_key || typeof resRow.credits !== 'number') {
          console.error('[first-value] missing required reservation fields')
          return NextResponse.json({
            error: '크레딧 예약 규격이 올바르지 않아요.',
            code: 'INVALID_RESERVATION_METADATA',
          }, { status: 503 })
        }

        if (resRow.state === 'released') {
          // 이미 해제/환불된 예약: 다음 후보 키로 순차 전진
          if (hop === maxHops - 1) {
            return NextResponse.json({
              error: '초안 생성을 다시 시도할 수 있는 한도를 초과했어요.',
              code: 'DRAFT_RETRY_LIMIT_EXCEEDED',
            }, { status: 503 })
          }
          const nextHash = createHash('sha256')
            .update(`first-post-draft:v1:${candidateId}:${resRow.id}:retry`)
            .digest('hex')
          candidateId = `${nextHash.slice(0, 8)}-${nextHash.slice(8, 12)}-4${nextHash.slice(13, 16)}-a${nextHash.slice(17, 20)}-${nextHash.slice(20, 32)}`
          continue
        }

        if (resRow.state === 'reserved') {
          // DB 원자 reconcile RPC 호출: reservation row lock으로 insert 경합 직렬화
          let reconcileResult
          try {
            reconcileResult = await reconcileQuickPostOrphan(auth.admin, auth.workspaceId, {
              reservationId: resRow.id,
              operationKey: resRow.operation_key,
              maxLeaseSeconds: 120,
            })
          } catch (reconcileErr) {
            console.error('[first-value] orphan reconciliation failed:', reconcileErr)
            // RPC 오류 시 절대 resRow.state = 'released'로 가짜 전이하지 않고 503 fail-closed (새키/provider 호출 0)
            return NextResponse.json({
              error: '크레딧 예약 상태를 확인하지 못했어요.',
              code: 'ORPHAN_RECONCILIATION_FAILED',
            }, { status: 503 })
          }

          if (reconcileResult.missionExists) {
            const isTerminal = isTerminalMission({
              status: reconcileResult.missionStatus,
              metadata: {
                execution_state: reconcileResult.executionState,
                outcome_state: reconcileResult.outcomeState,
              },
            })
            if (!isTerminal) {
              // APPROVED, EXECUTING, AWAITING_APPROVAL 등 활성 미션: 중복 생성 금지, candidateId 재개
              break
            }
            // 터미널 미션: 다음 키로 순차 전진
          } else if (reconcileResult.activeLease) {
            // 살아있는 in-flight lease (<120s): 경합 보호 및 중복 생성/과금 방지를 위해 candidateId 유지
            break
          } else if (reconcileResult.reconciled || reconcileResult.state === 'released') {
            // 만료된 orphan이 원자적으로 환불 및 released 처리됨: 다음 후보 키로 순차 전진
          } else {
            // 예상치 못한 상태: fail-closed
            return NextResponse.json({
              error: '크레딧 예약 상태가 올바르지 않아요.',
              code: 'ORPHAN_RECONCILIATION_FAILED',
            }, { status: 503 })
          }

          if (hop === maxHops - 1) {
            return NextResponse.json({
              error: '초안 생성을 다시 시도할 수 있는 한도를 초과했어요.',
              code: 'DRAFT_RETRY_LIMIT_EXCEEDED',
            }, { status: 503 })
          }
          const nextHash = createHash('sha256')
            .update(`first-post-draft:v1:${candidateId}:${resRow.id}:retry`)
            .digest('hex')
          candidateId = `${nextHash.slice(0, 8)}-${nextHash.slice(8, 12)}-4${nextHash.slice(13, 16)}-a${nextHash.slice(17, 20)}-${nextHash.slice(20, 32)}`
          continue
        }

        if (resRow.state === 'settled') {
          // 이미 정산된 예약: 미션 상태 조회
          const { data: candidateMission, error: cMissionErr } = await auth.admin
            .from('marketing_missions')
            .select('id, status, metadata')
            .eq('workspace_id', auth.workspaceId)
            .eq('id', candidateId)
            .maybeSingle()

          if (cMissionErr) {
            console.error('[first-value] candidate mission lookup failed:', cMissionErr)
            return NextResponse.json({
              error: '미션 상태를 확인하지 못했어요.',
              code: 'MISSION_READ_FAILED',
            }, { status: 503 })
          }

          if (candidateMission) {
            const isTerminal = isTerminalMission(candidateMission)
            if (!isTerminal) {
              // APPROVED, EXECUTING, PUBLISHED, AWAITING_APPROVAL 등 활성 미션: 중복 생성 금지, candidateId 재사용
              break
            }
            // 터미널 미션: 다음 키로 순차 전진
          } else {
            // 미션 레코드가 아직 없거나 저장 중인 경우: candidateId 재사용
            break
          }

          if (hop === maxHops - 1) {
            return NextResponse.json({
              error: '초안 생성을 다시 시도할 수 있는 한도를 초과했어요.',
              code: 'DRAFT_RETRY_LIMIT_EXCEEDED',
            }, { status: 503 })
          }
          const nextHash = createHash('sha256')
            .update(`first-post-draft:v1:${candidateId}:${resRow.id}:retry`)
            .digest('hex')
          candidateId = `${nextHash.slice(0, 8)}-${nextHash.slice(8, 12)}-4${nextHash.slice(13, 16)}-a${nextHash.slice(17, 20)}-${nextHash.slice(20, 32)}`
          continue
        }
      }

      const requestId = candidateId
      await recordFunnelEvent({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, event: 'draft_requested', dedupeKey: `draft_requested:${requestId}` })
      type CreateDraftParams = Parameters<typeof createQuickDraft>[0] & {
        sourceAssetIds?: readonly string[]
      }
      const draftPayload: CreateDraftParams = {
        admin: auth.admin,
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        missionId: requestId,
        topic,
        textOnly: isTextOnly,
        allowTextOnlyOnImageError: true,
        sourceAssetIds,
      }
      item = await createQuickDraft(draftPayload as Parameters<typeof createQuickDraft>[0])
      await recordFunnelEvent({ admin: auth.admin, workspaceId: auth.workspaceId, userId: auth.userId, event: 'draft_ready', properties: { missionId: item.missionId }, dedupeKey: `draft_ready:${item.missionId}` })
    }
    await ensureQuickPostVaultVersions(auth.admin, auth.workspaceId, auth.userId, item.missionId)
    const options = await getQuickPostApprovalOptions(auth.admin, auth.workspaceId, item.missionId, readiness)

    const [{ data: profile, error: profileErr }, { data: missionRow, error: missionErr }] = await Promise.all([
      auth.admin.from('business_profiles').select('industry,location,summary').eq('workspace_id', auth.workspaceId).maybeSingle(),
      auth.admin.from('marketing_missions').select('metadata').eq('id', item.missionId).eq('workspace_id', auth.workspaceId).maybeSingle(),
    ])
    if (profileErr) throw profileErr
    if (missionErr || !missionRow) {
      console.error('[first-value] mission metadata read failed:', missionErr)
      return NextResponse.json({
        error: '미션 세부 정보를 불러오지 못했어요.',
        code: 'MISSION_READ_FAILED',
      }, { status: 503 })
    }

    const isLiveAllowed = isMetaLiveAllowed(auth.workspaceId)
    const missionContract = missionRow.metadata?.contract
    const observationDays = missionContract?.observation_window?.start_at && missionContract?.observation_window?.end_at
      ? Math.max(1, Math.round((new Date(missionContract.observation_window.end_at).getTime() - new Date(missionContract.observation_window.start_at).getTime()) / (24 * 60 * 60 * 1000)))
      : undefined

    const costCredits =
      (typeof missionRow.metadata?.quick?.creditsCharged === 'number' ? missionRow.metadata.quick.creditsCharged : undefined) ??
      (typeof missionRow.metadata?.cost_credits === 'number' ? missionRow.metadata.cost_credits : undefined) ??
      (typeof item.creditsCharged === 'number' ? item.creditsCharged : undefined)

    const delegationScope = missionContract ? {
      goal: missionContract.goal,
      serviceScope: missionContract.service_scope,
      allowedActions: missionContract.allowed_actions,
      forbiddenActions: missionContract.forbidden_actions,
      costCredits,
      approvalRequired: true,
      observationWindowDays: observationDays,
      targetChannels: item.channels?.map((c: any) => c.provider) ?? [],
    } : undefined

    const view = buildFirstValueView(item, readiness, {
      targets: options.targets,
      connectedChannels: item.channels,
      industry: profile?.industry,
      location: profile?.location,
      summary: profile?.summary,
      liveRolloutBlocked: !isLiveAllowed,
      delegationScope,
    })
    return NextResponse.json({ item: { ...item, workspaceId: auth.workspaceId }, view, imageNotice: item.imageNotice ?? null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof FirstValueSourceError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        actionHref: '/start?step=shop',
      }, { status: error.status })
    }
    if (error instanceof QuickPostError || error instanceof QuickPostVaultError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    if (error instanceof QuickPostCreditFailure) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error('[first-value] preview failed', error)
    return NextResponse.json({
      error: '첫 초안 미리보기를 준비하는 중 일시적인 지연이 발생했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
      code: 'FIRST_VALUE_PREVIEW_FAILED',
    }, { status: 503 })
  }
}
