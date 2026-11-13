'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { readPublishIntentState } from '@/features/approvals/publish-intent-state'
import { executeLivePublishSchedule } from '@/features/publishing/actions/live-publish'
import { loadReadiness } from '@/features/readiness/load'
import { evaluateGate } from '@/features/readiness'
import { evaluateApprovalActions, type ProviderReviewStatus } from '@/features/vault/approval-policy'
import { readInterventionState } from '@/features/admin/interventions/read-state'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import { NAVER_AUTOMATION_BLOCKED_MESSAGE } from '@/features/naver-publish/automation-policy'

const uuid = z.string().uuid()
const inputSchema = z.object({
  workspaceId: uuid,
  contentId: uuid,
  versionId: uuid,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  mode: z.enum(['approve_only', 'publish_now', 'schedule']),
  channelConnectionId: uuid.nullable(),
  scheduledLocal: z.string().nullable(),
  timezone: z.string().trim().min(1).max(64).nullable(),
}).strict()
const resultSchema = z.object({
  approvalId: uuid,
  scheduleId: uuid.nullable(),
  next: z.enum(['approved', 'publishing', 'scheduled']),
}).strict()
const localResultSchema = z.object({
  approvalId: uuid,
  actionRequestId: uuid.nullable(),
  next: z.enum(['approved', 'publishing', 'scheduled']),
}).strict()

export type ApproveAndDispatchResult = Readonly<{
  approvalId: string
  versionId: string
  next: 'approved' | 'scheduled' | 'published' | 'failed' | 'unknown'
  scheduleId: string | null
  attemptId: string | null
  providerPostId: string | null
  errorCode: string | null
}>

const fail = (message: string, errorCode?: string): ActionResult<ApproveAndDispatchResult> => ({
  error: {
    message,
    requestId: 'approve-and-dispatch',
    ...(errorCode ? { errorCode } : {}),
  } as ActionResult<ApproveAndDispatchResult>['error'] & { errorCode?: string },
})

const scheduleUpdatedAtSchema = z.object({ updated_at: z.string().min(1) }).strict()

/**
 * ANI-1680 M07: 실행 직후 사후 재확인이 뒤늦게 과거 게시를 발견했을 때,
 * 방금 만들어진 예약을 기존 보호 RPC로 취소한다. 취소하지 않으면 그 예약이
 * 예약 시각에 도달해 같은 원고를 다시 게시할 수 있다.
 */
async function cancelDispatchedSchedule(
  db: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  workspaceId: string,
  scheduleId: string,
): Promise<boolean> {
  const { data, error } = await db.from('schedules')
    .select('updated_at').eq('workspace_id', workspaceId).eq('id', scheduleId).maybeSingle()
  const parsed = scheduleUpdatedAtSchema.safeParse(data)
  if (error || !parsed.success) return false
  const cancelled = await db.rpc('cancel_schedule_guarded' as never, {
    p_workspace_id: workspaceId,
    p_schedule_id: scheduleId,
    p_expected_updated_at: parsed.data.updated_at,
  } as never)
  return !cancelled.error
}

function localToUtc(value: string, timezone: string): string | null {
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(normalized)
  if (!match) return null
  const wanted = match.slice(1, 7).map(Number)
  const target = Date.UTC(wanted[0]!, wanted[1]! - 1, wanted[2]!, wanted[3]!, wanted[4]!, wanted[5]!)
  let instant = target
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = formatter.formatToParts(new Date(instant))
      const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
      const represented = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'))
      instant = target - (represented - instant)
    }
    return new Date(instant).toISOString()
  } catch {
    return null
  }
}

export async function approveAndDispatchAction(input: unknown): Promise<ActionResult<ApproveAndDispatchResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('승인과 게시 방식을 다시 확인해 주세요.')
  const value = parsed.data

  try {
    const previewResult = await getApprovalPreview(value.workspaceId, value.contentId)
    if (previewResult.error) return fail(previewResult.error.message)
    const preview = previewResult.data
    if (
      preview.versionId !== value.versionId
      || preview.fingerprint !== value.fingerprint
      || preview.issues.some(issue => issue.code !== 'channel_disconnected')
      || (preview.account.status !== 'connected' && preview.account.status !== 'disconnected')
      || (value.mode !== 'approve_only' && preview.account.connectionId !== value.channelConnectionId)
    ) return fail('수정된 새 버전과 채널 연결을 다시 확인해 주세요.')

    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const parsedUserId = uuid.safeParse(userData?.user?.id)
    if (userError || !parsedUserId.success) return fail('로그인 후 다시 시도해 주세요.')
    const userId = parsedUserId.data
    const { data: membership, error: membershipError } = await supabase.from('workspace_members')
      .select('role, status').eq('workspace_id', value.workspaceId).eq('user_id', userId).maybeSingle()
    const role = membership?.role
    if (membershipError || membership?.status !== 'active' || typeof role !== 'string' || !['owner', 'manager', 'reviewer'].includes(role)) {
      return fail('이 작업공간에서는 콘텐츠를 승인할 수 없습니다.')
    }
    if (value.mode !== 'approve_only' && role !== 'owner' && role !== 'manager') {
      return fail('실제 게시와 예약은 작업공간 소유자와 관리자만 할 수 있습니다.')
    }
    if (value.mode === 'approve_only' && preview.account.status !== 'connected') {
      return fail('수정된 새 버전과 채널 연결을 다시 확인해 주세요.')
    }

    // A content fingerprint alone does not authorize a mission's cost and execution scope.
    if (value.mode !== 'approve_only') {
      const missions = await supabase.from('marketing_missions').select('id')
        .eq('workspace_id', value.workspaceId).eq('content_id', value.contentId).limit(1)
      if (missions.error || !Array.isArray(missions.data)) {
        return fail('미션 연결을 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.')
      }
      if (missions.data.length > 0) return fail('미션의 게시 비용과 승인 범위를 먼저 확인해 주세요.')
    }

    // Re-evaluate the shared safety truth before creating any publish request.
    if (value.mode !== 'approve_only') {
      const safety = await readInterventionState(supabase, value.workspaceId, preview.channel)
      if (safety.blocked) return fail(safety.label ?? '소희가 잠시 멈췄어요')
      const readiness = await loadReadiness(value.workspaceId, { supabaseClient: supabase as any })
      if (preview.account.status !== 'connected') {
        const gate = evaluateGate(readiness, value.mode === 'schedule' ? 'SCHEDULE' : 'PUBLISH')
        return fail(gate.allowed ? '채널 연결을 다시 확인해 주세요.' : gate.message ?? '발행 준비를 확인해 주세요.')
      }
      if (preview.channel !== 'naver_blog') {
        const targetVerified = (preview.channel === 'instagram' || preview.channel === 'threads')
          && readiness.verifiedChannels.includes(preview.channel)
        const configuredReview = process.env.META_APP_REVIEW_STATUS?.toUpperCase()
        const providerReviewStatus: ProviderReviewStatus = configuredReview === 'APPROVED' ? 'APPROVED' : 'PENDING'
        const action = value.mode === 'schedule' ? 'SCHEDULE' : 'PUBLISH'
        const verdict = evaluateApprovalActions({
          channel: preview.channel,
          readiness: readiness.stage,
          connection: targetVerified ? 'VERIFIED' : 'DISCONNECTED',
          providerReviewStatus,
          specResult: { blocksVault: false },
          targetTime: value.mode === 'schedule' ? value.scheduledLocal : null,
        })[action]
        if (!verdict.allowed) return fail(verdict.message ?? '발행 준비를 확인해 주세요.')

        if ((preview.channel === 'instagram' || preview.channel === 'threads') && !isMetaLiveAllowed(value.workspaceId)) {
          return fail('아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.')
        }
      }
    }

    // ANI-1680 M07: 같은 승인 기록에 이미 실행 결과가 있으면 새 게시 의도를 만들지 않는다.
    // 이 확인이 없으면 발행이 끝난 뒤 다시 누를 때 새 예약(새 멱등키)이 생겨 같은 원고가 두 번 게시된다.
    if (value.mode !== 'approve_only' && preview.channel !== 'naver_blog') {
      const intent = await readPublishIntentState(supabase, {
        workspaceId: value.workspaceId,
        contentId: value.contentId,
        versionId: value.versionId,
      })
      if (intent.kind === 'unreadable') {
        return fail('게시 실행 기록을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
      if (intent.kind === 'published') {
        return { data: {
          approvalId: intent.approvalId,
          versionId: value.versionId,
          next: 'published',
          scheduleId: intent.scheduleId,
          attemptId: intent.attemptId,
          providerPostId: intent.providerPostId,
          errorCode: null,
        } }
      }
      if (intent.kind === 'failed' || intent.kind === 'unknown') {
        return { data: {
          approvalId: intent.approvalId,
          versionId: value.versionId,
          next: intent.kind,
          scheduleId: intent.scheduleId,
          attemptId: intent.attemptId,
          providerPostId: null,
          errorCode: intent.errorCode,
        } }
      }
      if (intent.kind === 'in_flight') {
        return { data: {
          approvalId: intent.approvalId,
          versionId: value.versionId,
          next: 'unknown',
          scheduleId: intent.scheduleId,
          attemptId: intent.attemptId,
          providerPostId: null,
          errorCode: null,
        } }
      }
    }

    let publishAt: string | null = null
    if (value.mode === 'schedule') {
      if (value.scheduledLocal === null || value.timezone === null) return fail('예약 날짜와 시간대를 확인해 주세요.')
      publishAt = localToUtc(value.scheduledLocal, value.timezone)
      if (publishAt === null || Date.parse(publishAt) < Date.now() + 60 * 60_000) {
        return fail('예약 시각은 현재보다 60분 이상 뒤여야 합니다.')
      }
    } else if (value.mode === 'publish_now') {
      publishAt = new Date().toISOString()
    }

    if (preview.channel === 'naver_blog') {
      if (value.mode !== 'approve_only') {
        return fail(NAVER_AUTOMATION_BLOCKED_MESSAGE, 'POLICY_DISABLED')
      }
      const mutation = await createAdminSupabaseClient().rpc('approve_and_dispatch_content_as_actor' as never, {
        p_actor_user_id: userId, p_lane: 'local',
        p_workspace_id: value.workspaceId,
        p_content_id: value.contentId,
        p_version_id: value.versionId,
        p_expected_fingerprint: value.fingerprint,
        p_mode: value.mode,
        p_publish_at: publishAt,
        p_timezone: value.mode === 'approve_only' ? null : value.mode === 'publish_now' ? 'Asia/Seoul' : value.timezone,
        p_channel_connection_id: value.channelConnectionId,
      } as never)
      const dispatched = localResultSchema.safeParse(mutation.data)
      if (mutation.error || !dispatched.success) return fail('승인과 게시 요청을 기록하지 못했어요. 최신 상태를 다시 확인해 주세요.')
      revalidatePath('/app/work')
      revalidatePath(`/app/work/${value.contentId}`)
      revalidatePath('/app/schedule')
      return { data: {
        approvalId: dispatched.data.approvalId,
        versionId: value.versionId,
        next: dispatched.data.next === 'publishing' ? 'unknown' : dispatched.data.next,
        scheduleId: dispatched.data.actionRequestId,
        attemptId: null,
        providerPostId: null,
        errorCode: null,
      } }
    }

    const mutation = await createAdminSupabaseClient().rpc('approve_and_dispatch_content_as_actor' as never, {
      p_actor_user_id: userId, p_lane: 'meta',
      p_workspace_id: value.workspaceId,
      p_content_id: value.contentId,
      p_version_id: value.versionId,
      p_expected_fingerprint: value.fingerprint,
      p_mode: value.mode,
      p_publish_at: publishAt,
      p_timezone: value.mode === 'publish_now' ? 'Asia/Seoul' : value.timezone,
      p_channel_connection_id: value.channelConnectionId,
    } as never)
    const dispatched = resultSchema.safeParse(mutation.data)
    if (mutation.error || !dispatched.success) return fail('승인과 게시 요청을 기록하지 못했어요. 최신 상태를 다시 확인해 주세요.')

    // ANI-1680 M07: 사전 확인과 RPC 는 서로 다른 트랜잭션이다. 두 요청이 겹치면
    // 사전 확인 뒤에 앞선 요청의 게시가 끝나, RPC 가 재사용할 예약을 찾지 못하고
    // 새 예약(새 멱등키)을 만들 수 있다. 예약을 만든 직후 이력을 한 번 더 읽어
    // 다른 예약에 이미 결과가 있으면 방금 만든 예약을 취소하고 공급자를 부르지 않는다.
    if (dispatched.data.scheduleId !== null) {
      const afterDispatch = await readPublishIntentState(supabase, {
        workspaceId: value.workspaceId,
        contentId: value.contentId,
        versionId: value.versionId,
      })
      if (afterDispatch.kind === 'unreadable') {
        // 판정을 못 해도 방금 만든 예약을 남기면 예약 시각에 cron 이 발송할 수 있다.
        // 공급자를 부르지 않은 것만으로 '중복 발송 0'을 주장하지 않고, 예약을 먼저 취소한다.
        const cancelled = await cancelDispatchedSchedule(supabase, value.workspaceId, dispatched.data.scheduleId)
        if (cancelled) {
          revalidatePath('/app/work')
          revalidatePath(`/app/work/${value.contentId}`)
          revalidatePath('/app/schedule')
          return fail('게시 실행 기록을 확인하지 못해 방금 만든 예약을 취소했어요. 잠시 후 다시 시도해 주세요.')
        }
        return fail('게시 실행 기록을 확인하지 못했어요. 예약이 남아 있을 수 있으니 일정 화면에서 예약 상태를 확인해 주세요.')
      }
      const overlapping = afterDispatch.kind !== 'none'
        && afterDispatch.kind !== 'scheduled'
        && afterDispatch.scheduleId !== dispatched.data.scheduleId
      if (overlapping) {
        const cancelled = await cancelDispatchedSchedule(supabase, value.workspaceId, dispatched.data.scheduleId)
        if (!cancelled) {
          // 예약을 지우지 못했다. 공급자는 불렀지 않았지만 그 예약이 나중에 발송될 수 있으므로
          // 사용자가 일정 화면에서 직접 취소해야 한다.
          return fail('이전 게시와 겹쳐 실행을 멈췄지만 예약을 취소하지 못했어요. 일정 화면에서 예약을 취소해 주세요.')
        }
        revalidatePath('/app/work')
        revalidatePath(`/app/work/${value.contentId}`)
        revalidatePath('/app/schedule')
        if (afterDispatch.kind === 'published') {
          return { data: {
            approvalId: afterDispatch.approvalId,
            versionId: value.versionId,
            next: 'published',
            scheduleId: afterDispatch.scheduleId,
            attemptId: afterDispatch.attemptId,
            providerPostId: afterDispatch.providerPostId,
            errorCode: null,
          } }
        }
        if (afterDispatch.kind === 'failed' || afterDispatch.kind === 'unknown') {
          return { data: {
            approvalId: afterDispatch.approvalId,
            versionId: value.versionId,
            next: afterDispatch.kind,
            scheduleId: afterDispatch.scheduleId,
            attemptId: afterDispatch.attemptId,
            providerPostId: null,
            errorCode: afterDispatch.errorCode,
          } }
        }
        return { data: {
          approvalId: afterDispatch.approvalId,
          versionId: value.versionId,
          next: 'unknown',
          scheduleId: afterDispatch.scheduleId,
          attemptId: afterDispatch.attemptId,
          providerPostId: null,
          errorCode: null,
        } }
      }
    }

    if (value.mode === 'publish_now') {
      if (dispatched.data.scheduleId === null) return fail('게시 실행 기록을 확인하지 못했어요. 최신 상태를 다시 확인해 주세요.')
      const outcome = await executeLivePublishSchedule({
        workspaceId: value.workspaceId,
        scheduleId: dispatched.data.scheduleId,
        actorUserId: userId,
        // 사용자가 승인 화면에서 직접 '지금 게시'를 누른 실행이다.
        trigger: 'user',
      })
      if (outcome.error) return fail(outcome.error.message)
      revalidatePath('/app/work')
      revalidatePath(`/app/work/${value.contentId}`)
      revalidatePath('/app/schedule')
      return { data: {
        approvalId: dispatched.data.approvalId,
        versionId: value.versionId,
        next: outcome.data.status === 'publishing' ? 'unknown' : outcome.data.status,
        scheduleId: dispatched.data.scheduleId,
        attemptId: outcome.data.attemptId,
        providerPostId: outcome.data.providerPostId,
        errorCode: outcome.data.errorCode,
      } }
    }
    revalidatePath('/app/work')
    revalidatePath(`/app/work/${value.contentId}`)
    revalidatePath('/app/schedule')
    return { data: {
      approvalId: dispatched.data.approvalId,
      versionId: value.versionId,
      next: dispatched.data.next === 'publishing' ? 'unknown' : dispatched.data.next,
      scheduleId: dispatched.data.scheduleId,
      attemptId: null,
      providerPostId: null,
      errorCode: null,
    } }
  } catch {
    return fail('승인과 게시 요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
