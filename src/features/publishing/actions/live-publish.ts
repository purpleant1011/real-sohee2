import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { loadApprovedPublishMaterial } from '../approved-publish-repository'
import { publishApprovedMetaContent } from '../meta-publish-provider'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import {
  autonomyAdmissionMessage,
  checkAutonomyExecutionAdmission,
  type AutonomyExecutionAdmission,
} from '@/features/marketing-agent/engine/autonomy-execution-admission'
import { assertPublishMissionGateAllowed } from '@/lib/mission-os/mission-lineage-guard'

const reservationSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  providerReference: z.string().nullable(),
  errorCode: z.string().nullable(),
  isNew: z.boolean(),
  workspaceId: z.string().uuid(),
  scheduleId: z.string().uuid(),
  versionId: z.string().uuid(),
  channelConnectionId: z.string().uuid(),
  channel: z.enum(['instagram', 'threads']),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/u),
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict()

type AdminGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
  recordDestination?(input: Readonly<{
    workspaceId: string
    attemptId: string
    destinationUrl: string
  }>): Promise<{ error: unknown }>
}>

export type LivePublishOutcome = Readonly<{
  attemptId: string
  status: 'publishing' | 'published' | 'failed' | 'unknown'
  providerPostId: string | null
  destinationUrl: string | null
  errorCode: string | null
}>

const failure = (message: string, code?: string): ActionResult<LivePublishOutcome> => ({
  error: {
    message,
    requestId: 'live-publish',
    ...(code ? { code } : {}),
  } as ActionResult<LivePublishOutcome>['error'] & { code?: string },
})

function stableKey(scheduleId: string) {
  return createHash('sha256').update(`sohee:live-publish:initial:${scheduleId}`).digest('hex')
}

function retryKey(failedAttemptId: string) {
  return createHash('sha256').update(`sohee:live-publish:retry:${failedAttemptId}`).digest('hex')
}

async function productionGateway(): Promise<AdminGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  return {
    rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }>,
    recordDestination: async ({ workspaceId, attemptId, destinationUrl }) => {
      const result = await supabase
        .from('social_post_tracking')
        .update({ destination_url: destinationUrl })
        .eq('workspace_id', workspaceId)
        .eq('publish_attempt_id', attemptId)
      return { error: result.error }
    },
  }
}

/**
 * 발행 실행 트리거. 백그라운드(자동·배치)는 기본값이며 자율근무 상태 가드를 받는다.
 * 사람이 화면에서 직접 누른 발행만 'user' 로 명시해 자율근무 일시정지와 분리한다.
 */
export type PublishTrigger = 'background' | 'user'

export type PublishClaimInput = Readonly<{
  workspaceId: string
  actorUserId: string
  trigger?: PublishTrigger
  missionId?: string | null
  workerObservedEpoch?: number
}>

type AutonomyAdmissionCheck = (workspaceId: string) => Promise<AutonomyExecutionAdmission>

async function productionAdmission(workspaceId: string): Promise<AutonomyExecutionAdmission> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return checkAutonomyExecutionAdmission(createAdminSupabaseClient(), workspaceId)
}

async function executeClaimedPublish(
  input: PublishClaimInput,
  claimName: 'claim_publish_schedule' | 'claim_publish_retry',
  claimArgs: Record<string, unknown>,
  providedGateway?: AdminGateway,
  providedAdmission?: AutonomyAdmissionCheck,
): Promise<ActionResult<LivePublishOutcome>> {
  if (!z.string().uuid().safeParse(input.workspaceId).success
    || !z.string().uuid().safeParse(input.actorUserId).success) {
    return failure('실제 게시 요청을 확인해 주세요.')
  }

  // Pre-claim admission check: Prevent background publishing if autonomy is paused/disabled
  if ((input.trigger ?? 'background') === 'background') {
    const admission = providedAdmission
      ? await providedAdmission(input.workspaceId)
      : await productionAdmission(input.workspaceId)
    if (!admission.admitted) return failure(autonomyAdmissionMessage(admission.code))
  }

  if (!isMetaLiveAllowed(input.workspaceId)) {
    return failure('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
  }

  const gateway = providedGateway ?? await productionGateway()
  const claimToken = randomBytes(32).toString('base64url')
  const claim = await gateway.rpc(claimName, {
    p_workspace_id: input.workspaceId,
    p_actor_user_id: input.actorUserId,
    p_claim_token: claimToken,
    p_worker_id: 'sohee-web-action',
    p_now: new Date().toISOString(),
    ...claimArgs,
  })
  const reservation = reservationSchema.safeParse(claim.data)
  if (claim.error || !reservation.success) {
    const errorText = typeof claim.error === 'string'
      ? claim.error
      : typeof claim.error === 'object' && claim.error !== null
        ? ((claim.error as { message?: string }).message ?? '')
        : ''

    if (errorText.includes('PUBLISH_CLAIM_FORBIDDEN')) {
      return failure('게시 권한이 필요해요', 'PUBLISH_CLAIM_FORBIDDEN')
    }
    if (errorText.includes('PUBLISH_NOT_DUE_OR_NOT_READY') || errorText.includes('PUBLISH_RETRY_NOT_READY')) {
      return failure('연결 권한이나 상태를 확인해 주세요. 채널을 다시 연결하면 해결될 수 있어요.', 'PUBLISH_NOT_DUE_OR_NOT_READY')
    }
    return failure('게시 실행을 시작하지 못했어요. 연결 상태와 예약 기록을 확인해 주세요.')
  }
  if (!reservation.data.isNew) {
    if (reservation.data.status === 'succeeded') return { data: {
      attemptId: reservation.data.attemptId,
      status: 'published',
      providerPostId: reservation.data.providerReference,
      destinationUrl: null,
      errorCode: null,
    } }
    if (reservation.data.status === 'failed') return { data: {
      attemptId: reservation.data.attemptId,
      status: 'failed',
      providerPostId: null,
      destinationUrl: null,
      errorCode: reservation.data.errorCode,
    } }
    return { data: {
      attemptId: reservation.data.attemptId,
      status: 'publishing',
      providerPostId: null,
      destinationUrl: null,
      errorCode: null,
    } }
  }

  // Derive / verify mission lineage from schedule or content item
  let targetMissionId: string | null = null
  // Preserve authoritative caller-provided workerObservedEpoch if given.
  // Never overwrite an explicit workerObservedEpoch with late DB reads (prevents stale worker bypass).
  // Live epoch authoritative fallback is ONLY permitted when input.workerObservedEpoch === undefined.
  // Explicit invalid/NaN/fractional/negative epochs must NOT be substituted and must fail closed immediately.
  let claimObservedEpoch: number | undefined = undefined

  if (input.workerObservedEpoch !== undefined) {
    const isExplicitValid =
      typeof input.workerObservedEpoch === 'number' &&
      Number.isSafeInteger(input.workerObservedEpoch) &&
      !Number.isNaN(input.workerObservedEpoch) &&
      input.workerObservedEpoch >= 0

    if (!isExplicitValid) {
      await gateway.rpc('complete_claimed_publish', {
        p_workspace_id: input.workspaceId,
        p_schedule_id: reservation.data.scheduleId,
        p_idempotency_key: reservation.data.idempotencyKey,
        p_claim_token: claimToken,
        p_status: 'failed',
        p_provider_reference: null,
        p_error_code: 'INVALID_WORKER_OBSERVED_EPOCH',
        p_provider_request_id: null,
      })
      return failure('제어 정보가 올바르지 않아 발행을 중단했습니다.')
    }
    claimObservedEpoch = input.workerObservedEpoch
  }
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabaseAdmin = createAdminSupabaseClient()

  if (typeof supabaseAdmin?.from === 'function') {
    let schedRow: { content_id: string } | null = null
    try {
      const { data, error: schedErr } = await (supabaseAdmin as any)
        .from('schedules')
        .select('content_id')
        .eq('id', reservation.data.scheduleId)
        .eq('workspace_id', input.workspaceId)
        .maybeSingle()

      if (schedErr) {
        console.error('[live-publish] Schedule lineage query failed:', schedErr)
        await gateway.rpc('complete_claimed_publish', {
          p_workspace_id: input.workspaceId,
          p_schedule_id: reservation.data.scheduleId,
          p_idempotency_key: reservation.data.idempotencyKey,
          p_claim_token: claimToken,
          p_status: 'failed',
          p_provider_reference: null,
          p_error_code: 'SCHEDULE_LINEAGE_QUERY_FAILED',
          p_provider_request_id: null,
        })
        return failure('발행 일정 계통을 조회하지 못했습니다.')
      }
      schedRow = data
    } catch (schedEx: any) {
      console.error('[live-publish] Schedule lineage query exception:', schedEx)
      await gateway.rpc('complete_claimed_publish', {
        p_workspace_id: input.workspaceId,
        p_schedule_id: reservation.data.scheduleId,
        p_idempotency_key: reservation.data.idempotencyKey,
        p_claim_token: claimToken,
        p_status: 'failed',
        p_provider_reference: null,
        p_error_code: 'SCHEDULE_LINEAGE_QUERY_EXCEPTION',
        p_provider_request_id: null,
      })
      return failure('발행 일정 계통을 확인하는 중 예외가 발생했습니다.')
    }

    if (!schedRow) {
      await gateway.rpc('complete_claimed_publish', {
        p_workspace_id: input.workspaceId,
        p_schedule_id: reservation.data.scheduleId,
        p_idempotency_key: reservation.data.idempotencyKey,
        p_claim_token: claimToken,
        p_status: 'failed',
        p_provider_reference: null,
        p_error_code: 'CLAIMED_SCHEDULE_NOT_FOUND',
        p_provider_request_id: null,
      })
      return failure('예약된 일정을 찾을 수 없습니다.')
    }

    // Correlate with marketing_missions from content_id
    if (schedRow.content_id) {
      try {
        const { data: missionRow, error: missionErr } = await (supabaseAdmin as any)
          .from('marketing_missions')
          .select('id, content_id, metadata')
          .eq('workspace_id', input.workspaceId)
          .eq('content_id', schedRow.content_id)
          .maybeSingle()

        if (missionErr) {
          console.error('[live-publish] Mission lineage query failed:', missionErr)
          await gateway.rpc('complete_claimed_publish', {
            p_workspace_id: input.workspaceId,
            p_schedule_id: reservation.data.scheduleId,
            p_idempotency_key: reservation.data.idempotencyKey,
            p_claim_token: claimToken,
            p_status: 'failed',
            p_provider_reference: null,
            p_error_code: 'MISSION_LINEAGE_QUERY_FAILED',
            p_provider_request_id: null,
          })
          return failure('임무 계통 확인 중 데이터베이스 오류가 발생했습니다.')
        }

        if (missionRow?.id) {
          targetMissionId = missionRow.id
          // Authoritative fallback: ONLY permitted when caller truly omitted workerObservedEpoch (=== undefined).
          if (
            input.workerObservedEpoch === undefined &&
            claimObservedEpoch === undefined &&
            typeof missionRow.metadata?.control_epoch === 'number' &&
            Number.isSafeInteger(missionRow.metadata.control_epoch) &&
            missionRow.metadata.control_epoch >= 0
          ) {
            claimObservedEpoch = missionRow.metadata.control_epoch
          }
        }
      } catch (mEx: any) {
        console.error('[live-publish] Mission lineage query exception:', mEx)
        await gateway.rpc('complete_claimed_publish', {
          p_workspace_id: input.workspaceId,
          p_schedule_id: reservation.data.scheduleId,
          p_idempotency_key: reservation.data.idempotencyKey,
          p_claim_token: claimToken,
          p_status: 'failed',
          p_provider_reference: null,
          p_error_code: 'MISSION_LINEAGE_QUERY_EXCEPTION',
          p_provider_request_id: null,
        })
        return failure('임무 계통 조회 중 예외가 발생했습니다.')
      }
    }

    // Explicit missionId verification against claimed schedule & content lineage
    if (input.missionId) {
      if (targetMissionId && targetMissionId !== input.missionId) {
        await gateway.rpc('complete_claimed_publish', {
          p_workspace_id: input.workspaceId,
          p_schedule_id: reservation.data.scheduleId,
          p_idempotency_key: reservation.data.idempotencyKey,
          p_claim_token: claimToken,
          p_status: 'failed',
          p_provider_reference: null,
          p_error_code: 'EXPLICIT_MISSION_LINEAGE_MISMATCH',
          p_provider_request_id: null,
        })
        return failure('요청한 임무 식별자와 예약 일정의 실제 임무가 일치하지 않습니다.')
      }

      if (!targetMissionId) {
        try {
          const { data: explicitMission, error: expErr } = await (supabaseAdmin as any)
            .from('marketing_missions')
            .select('id, content_id, metadata')
            .eq('id', input.missionId)
            .eq('workspace_id', input.workspaceId)
            .maybeSingle()

          if (expErr || !explicitMission) {
            await gateway.rpc('complete_claimed_publish', {
              p_workspace_id: input.workspaceId,
              p_schedule_id: reservation.data.scheduleId,
              p_idempotency_key: reservation.data.idempotencyKey,
              p_claim_token: claimToken,
              p_status: 'failed',
              p_provider_reference: null,
              p_error_code: 'EXPLICIT_MISSION_NOT_FOUND',
              p_provider_request_id: null,
            })
            return failure('지정한 임무를 찾을 수 없습니다.')
          }

          if (schedRow.content_id && explicitMission.content_id !== schedRow.content_id) {
            await gateway.rpc('complete_claimed_publish', {
              p_workspace_id: input.workspaceId,
              p_schedule_id: reservation.data.scheduleId,
              p_idempotency_key: reservation.data.idempotencyKey,
              p_claim_token: claimToken,
              p_status: 'failed',
              p_provider_reference: null,
              p_error_code: 'EXPLICIT_MISSION_CONTENT_MISMATCH',
              p_provider_request_id: null,
            })
            return failure('지정한 임무와 예약 일정의 원고 식별자가 일치하지 않습니다.')
          }

          targetMissionId = input.missionId
          if (
            claimObservedEpoch === undefined &&
            typeof explicitMission.metadata?.control_epoch === 'number' &&
            Number.isSafeInteger(explicitMission.metadata.control_epoch) &&
            explicitMission.metadata.control_epoch >= 0
          ) {
            claimObservedEpoch = explicitMission.metadata.control_epoch
          }
        } catch {
          await gateway.rpc('complete_claimed_publish', {
            p_workspace_id: input.workspaceId,
            p_schedule_id: reservation.data.scheduleId,
            p_idempotency_key: reservation.data.idempotencyKey,
            p_claim_token: claimToken,
            p_status: 'failed',
            p_provider_reference: null,
            p_error_code: 'EXPLICIT_MISSION_VERIFICATION_FAILED',
            p_provider_request_id: null,
          })
          return failure('지정한 임무 유효성 검증에 실패했습니다.')
        }
      }
    }
  }

  // 1. Load approved publish material FIRST
  let material: Awaited<ReturnType<typeof loadApprovedPublishMaterial>>
  try {
    material = await loadApprovedPublishMaterial(input.workspaceId, reservation.data.scheduleId)
  } catch (loadErr: any) {
    console.error('[live-publish] MATERIAL_LOAD_FAILED:', loadErr)
    await gateway.rpc('complete_claimed_publish', {
      p_workspace_id: input.workspaceId,
      p_schedule_id: reservation.data.scheduleId,
      p_idempotency_key: reservation.data.idempotencyKey,
      p_claim_token: claimToken,
      p_status: 'failed',
      p_provider_reference: null,
      p_error_code: 'MATERIAL_LOAD_FAILED',
      p_provider_request_id: null,
    })
    return failure('발행할 원고 자료를 준비하지 못했습니다.')
  }

  // 2. Post-load Pre-send Fence (ANI-1845):
  // Evaluated immediately before provider dispatch so slow material load doesn't race with owner pause
  if ((input.trigger ?? 'background') === 'background') {
    const preSendAdmission = providedAdmission
      ? await providedAdmission(input.workspaceId)
      : await productionAdmission(input.workspaceId)
    if (!preSendAdmission.admitted) {
      await gateway.rpc('complete_claimed_publish', {
        p_workspace_id: input.workspaceId,
        p_schedule_id: reservation.data.scheduleId,
        p_idempotency_key: reservation.data.idempotencyKey,
        p_claim_token: claimToken,
        p_status: 'failed',
        p_provider_reference: null,
        p_error_code: 'AUTONOMY_ADMISSION_BLOCKED',
        p_provider_request_id: null,
      })
      return failure(autonomyAdmissionMessage(preSendAdmission.code))
    }
  }

  if (targetMissionId) {
    try {
      await assertPublishMissionGateAllowed({
        supabase: supabaseAdmin,
        workspaceId: input.workspaceId,
        missionId: targetMissionId,
        workerObservedEpoch: claimObservedEpoch,
      })
    } catch (fenceErr: any) {
      console.warn('[live-publish] Pre-send mission control fence blocked NEW_WRITE:', fenceErr?.message)
      // Release claim reservation safely via complete_claimed_publish
      await gateway.rpc('complete_claimed_publish', {
        p_workspace_id: input.workspaceId,
        p_schedule_id: reservation.data.scheduleId,
        p_idempotency_key: reservation.data.idempotencyKey,
        p_claim_token: claimToken,
        p_status: 'failed',
        p_provider_reference: null,
        p_error_code: 'MISSION_GATE_BLOCKED',
        p_provider_request_id: null,
      })
      return failure('임무가 일시 정지되었거나 제어 주기가 변경되어 새 발행이 안전하게 차단되었습니다.')
    }
  }

  // 3. Provider Dispatch with dispatchStarted guard
  let dispatchStarted = false
  let providerRequestId: string | null = null
  let providerResult: Awaited<ReturnType<typeof publishApprovedMetaContent>>
  try {
    dispatchStarted = true
    providerResult = await publishApprovedMetaContent({
      reservation: reservation.data,
      material,
      onProviderRequestId: async (requestId) => {
        if (!/^[A-Za-z0-9._-]{1,255}$/u.test(requestId)) throw new Error('provider request invalid')
        if (providerRequestId !== null && providerRequestId !== requestId) {
          throw new Error('provider request changed')
        }
        const recorded = await gateway.rpc('record_claimed_publish_request', {
          p_workspace_id: input.workspaceId,
          p_schedule_id: reservation.data.scheduleId,
          p_idempotency_key: reservation.data.idempotencyKey,
          p_claim_token: claimToken,
          p_provider_request_id: requestId,
        })
        if (recorded.error || recorded.data !== reservation.data.attemptId) {
          throw new Error('provider request recording failed')
        }
        providerRequestId = requestId
      },
    })
  } catch (error) {
    console.error(
      '[live-publish] DISPATCH_EXCEPTION',
      error instanceof Error && /^([A-Z0-9_]+|[가-힣 .]+)$/u.test(error.message)
        ? error.message
        : 'UNKNOWN_ERROR',
    )
    // Fail-closed: once dispatch has started, any exception/timeout must default to RESULT_UNKNOWN
    // to prevent duplicate posts via blind retry
    providerResult = {
      ok: false,
      providerPostId: null,
      destinationUrl: null,
      errorCode: dispatchStarted ? 'RESULT_UNKNOWN' : 'PROVIDER_REJECTED',
    }
  }

  const completion = await gateway.rpc('complete_claimed_publish', {
    p_workspace_id: input.workspaceId,
    p_schedule_id: reservation.data.scheduleId,
    p_idempotency_key: reservation.data.idempotencyKey,
    p_claim_token: claimToken,
    p_status: providerResult.ok ? 'succeeded' : providerResult.errorCode === 'RESULT_UNKNOWN' ? 'unknown' : 'failed',
    p_provider_reference: providerResult.providerPostId,
    p_error_code: providerResult.errorCode,
    p_provider_request_id: providerRequestId,
  })
  if (completion.error || completion.data !== reservation.data.attemptId) {
    return { data: {
      attemptId: reservation.data.attemptId,
      status: 'unknown',
      providerPostId: providerResult.ok ? providerResult.providerPostId : null,
      destinationUrl: providerResult.ok ? providerResult.destinationUrl : null,
      errorCode: 'RESULT_RECORDING_UNKNOWN',
    } }
  }
  if (providerResult.ok && providerResult.destinationUrl && gateway.recordDestination) {
    const destination = await gateway.recordDestination({
      workspaceId: input.workspaceId,
      attemptId: reservation.data.attemptId,
      destinationUrl: providerResult.destinationUrl,
    })
    if (destination.error) console.error('[live-publish] DESTINATION_RECORDING_FAILED')
  }
  return { data: {
    attemptId: reservation.data.attemptId,
    status: providerResult.ok ? 'published' : providerResult.errorCode === 'RESULT_UNKNOWN' ? 'unknown' : 'failed',
    providerPostId: providerResult.providerPostId,
    destinationUrl: providerResult.destinationUrl,
    errorCode: providerResult.errorCode,
  } }
}

export async function executeLivePublishSchedule(input: PublishClaimInput & Readonly<{
  scheduleId: string
}>, providedGateway?: AdminGateway, providedAdmission?: AutonomyAdmissionCheck): Promise<ActionResult<LivePublishOutcome>> {
  if (!z.string().uuid().safeParse(input.scheduleId).success) return failure('실제 게시 요청을 확인해 주세요.')
  return executeClaimedPublish(input, 'claim_publish_schedule', {
    p_schedule_id: input.scheduleId,
    p_idempotency_key: stableKey(input.scheduleId),
  }, providedGateway, providedAdmission)
}

export async function executeLivePublishRetry(input: PublishClaimInput & Readonly<{
  failedAttemptId: string
}>, providedGateway?: AdminGateway, providedAdmission?: AutonomyAdmissionCheck): Promise<ActionResult<LivePublishOutcome>> {
  if (!z.string().uuid().safeParse(input.failedAttemptId).success) return failure('재시도할 게시 기록을 확인해 주세요.')
  return executeClaimedPublish(input, 'claim_publish_retry', {
    p_failed_attempt_id: input.failedAttemptId,
    p_idempotency_key: retryKey(input.failedAttemptId),
  }, providedGateway, providedAdmission)
}
