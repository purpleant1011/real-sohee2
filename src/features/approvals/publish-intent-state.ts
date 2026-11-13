import 'server-only'

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 같은 승인 기록(작업공간 + 원고 + 버전)에 이미 만들어진 게시 실행 상태를 읽는다 (ANI-1680 M07).
 *
 * `approve_and_dispatch_meta_content` 는 `scheduled`/`publishing` 상태의 예약만 재사용한다.
 * 발행이 끝나 예약이 `published` 로 바뀐 뒤 같은 승인을 다시 누르면 **새 예약 행**이 생기고,
 * 새 예약은 새 멱등키를 갖기 때문에 공급자가 같은 원고를 다시 게시한다.
 *
 * 그래서 최신 예약 한 건만 보지 않고 **해당 버전의 예약 이력 전체**를 읽는다.
 * 최신 행이 취소(`cancelled`)나 예약(`scheduled`)이어도 과거의 게시 성공·불확실 증거가 있으면
 * 그 증거를 우선한다. 그렇지 않으면 이 가드가 생기기 전에 만들어진 이력이 다시 게시로 이어진다.
 *
 * 용어 구분: `published` 는 공급자가 게시를 받아들여 게시 식별자를 돌려준 상태다.
 * 독립 readback(게시물 주소 확인)은 `social_post_tracking.destination_url` 로 따로 표시하며,
 * readback 이 없다고 성공이 취소되지는 않는다(같은 원고를 다시 보내는 것이 더 위험하다).
 *
 * 읽기 실패·해석 불가·이력 상한 초과는 통과가 아니라 `unreadable`(차단) 이다.
 */

const uuid = z.string().uuid()
// 한 원고 버전의 예약 이력은 사용자가 만든 횟수만큼이다. 상한에 닿으면 이력이 잘렸는지
// 알 수 없으므로(과거 성공 증거를 놓칠 수 있으므로) 성공으로 판정하지 않고 차단한다.
// PostgREST 기본 상한(1000) 아래에서 +1 조회로 초과 여부를 확인한다.
const MAX_SCHEDULES = 200
const MAX_ATTEMPTS = 500
const scheduleRowSchema = z.object({
  id: uuid,
  approval_id: uuid,
  status: z.enum(['scheduled', 'publishing', 'published', 'unknown', 'failed', 'cancelled']),
}).strict()
const attemptRowSchema = z.object({
  schedule_id: uuid,
  id: uuid,
  status: z.enum(['pending', 'succeeded', 'unknown', 'failed']),
  provider_reference: z.string().min(1).max(500).nullable(),
  error_code: z.string().min(1).max(120).nullable(),
}).strict()
const trackingRowSchema = z.object({
  publish_attempt_id: uuid,
  destination_url: z.string().min(8).max(2_048).nullable(),
}).strict()

export type PublishIntentState = Readonly<
  | { kind: 'none' }
  | { kind: 'scheduled'; approvalId: string; scheduleId: string }
  | { kind: 'in_flight'; approvalId: string; scheduleId: string; attemptId: string | null }
  | {
    kind: 'published'
    approvalId: string
    scheduleId: string
    attemptId: string
    providerPostId: string | null
    /** 공급자 게시물 주소의 독립 readback. 없으면 게시 확인이 아니라 공급자 수락 단계다. */
    readbackUrl: string | null
  }
  | { kind: 'unknown'; approvalId: string; scheduleId: string; attemptId: string | null; errorCode: string | null }
  | { kind: 'failed'; approvalId: string; scheduleId: string; attemptId: string | null; errorCode: string | null }
  | { kind: 'unreadable' }
>

/**
 * 성공한 실행의 독립 readback 주소. 보조 증거이므로 조회 실패는 차단이 아니라
 * "readback 없음"으로 둔다. 이미 공급자가 받아들인 게시를 되돌릴 수는 없고,
 * 이 값의 부재만으로 재게시를 허용해서도 안 되기 때문이다.
 */
async function readReadbackUrl(
  db: SupabaseClient,
  workspaceId: string,
  attemptId: string,
): Promise<string | null> {
  try {
    const result = await db
      .from('social_post_tracking')
      .select('publish_attempt_id, destination_url')
      .eq('workspace_id', workspaceId)
      .in('publish_attempt_id', [attemptId])
      .limit(1)
    const rows = Array.isArray(result.data) ? result.data : []
    const parsed = trackingRowSchema.safeParse(rows[0])
    if (result.error || !parsed.success) return null
    return parsed.data.destination_url
  } catch {
    return null
  }
}

export async function readPublishIntentState(
  db: SupabaseClient,
  input: Readonly<{ workspaceId: string; contentId: string; versionId: string }>,
): Promise<PublishIntentState> {
  try {
    const scheduleResult = await db
      .from('schedules')
      .select('id, approval_id, status')
      .eq('workspace_id', input.workspaceId)
      .eq('content_id', input.contentId)
      .eq('version_id', input.versionId)
      .order('created_at', { ascending: false })
      .limit(MAX_SCHEDULES + 1)
    const parsedSchedules = z.array(scheduleRowSchema).safeParse(scheduleResult.data)
    if (scheduleResult.error || !parsedSchedules.success) return { kind: 'unreadable' }
    const schedules = parsedSchedules.data
    // 상한을 넘겼으면 이력이 잘렸을 수 있다. 잘린 이력으로 "기록 없음"을 주장하지 않는다.
    if (schedules.length > MAX_SCHEDULES) return { kind: 'unreadable' }
    if (schedules.length === 0) return { kind: 'none' }

    const attemptResult = await db
      .from('publish_attempts')
      .select('schedule_id, id, status, provider_reference, error_code')
      .eq('workspace_id', input.workspaceId)
      .in('schedule_id', schedules.map((schedule) => schedule.id))
      .order('attempt_number', { ascending: false })
      .limit(MAX_ATTEMPTS + 1)
    const parsedAttempts = z.array(attemptRowSchema).safeParse(attemptResult.data)
    if (attemptResult.error || !parsedAttempts.success) return { kind: 'unreadable' }
    if (parsedAttempts.data.length > MAX_ATTEMPTS) return { kind: 'unreadable' }

    // 응답은 attempt_number 내림차순이므로 각 예약에서 처음 만난 실행이 마지막 실행이다.
    const latestAttempt = new Map<string, z.infer<typeof attemptRowSchema>>()
    for (const attempt of parsedAttempts.data) {
      if (!latestAttempt.has(attempt.schedule_id)) latestAttempt.set(attempt.schedule_id, attempt)
    }
    const history = schedules.map((schedule) => ({
      schedule,
      attempt: latestAttempt.get(schedule.id) ?? null,
    }))

    // 공급자가 게시에 성공한 증거가 가장 강하다. 최신 행이 취소·예약이어도 이 증거를 이긴다.
    const succeeded = history.find((row) => row.attempt?.status === 'succeeded')
    if (succeeded?.attempt) {
      return {
        kind: 'published',
        approvalId: succeeded.schedule.approval_id,
        scheduleId: succeeded.schedule.id,
        attemptId: succeeded.attempt.id,
        providerPostId: succeeded.attempt.provider_reference,
        readbackUrl: await readReadbackUrl(db, input.workspaceId, succeeded.attempt.id),
      }
    }

    // 결과를 확인하지 못한 실행도 성공으로 보지 않고, 다시 보내지도 않는다.
    const uncertain = history.find((row) => row.attempt?.status === 'unknown')
    if (uncertain?.attempt) {
      return {
        kind: 'unknown',
        approvalId: uncertain.schedule.approval_id,
        scheduleId: uncertain.schedule.id,
        attemptId: uncertain.attempt.id,
        errorCode: uncertain.attempt.error_code,
      }
    }

    const inFlight = history.find((row) =>
      row.attempt?.status === 'pending' || row.schedule.status === 'publishing')
    if (inFlight) {
      return {
        kind: 'in_flight',
        approvalId: inFlight.schedule.approval_id,
        scheduleId: inFlight.schedule.id,
        attemptId: inFlight.attempt?.id ?? null,
      }
    }

    // 실행 기록 없이 published 로만 표시된 예약도 증거가 없으므로 성공으로 보지 않는다.
    const unprovenPublished = history.find((row) => row.schedule.status === 'published')
    if (unprovenPublished) {
      return {
        kind: 'unknown',
        approvalId: unprovenPublished.schedule.approval_id,
        scheduleId: unprovenPublished.schedule.id,
        attemptId: null,
        errorCode: null,
      }
    }

    // 취소된 예약은 사용자가 실행을 접은 기록이다. 다만 실패·예약 판정은 가장 최근에
    // 살아 있는(취소되지 않은) 예약 하나만 본다.
    const current = history.find((row) => row.schedule.status !== 'cancelled')
    if (current?.attempt?.status === 'failed') {
      return {
        kind: 'failed',
        approvalId: current.schedule.approval_id,
        scheduleId: current.schedule.id,
        attemptId: current.attempt.id,
        errorCode: current.attempt.error_code,
      }
    }
    if (current?.schedule.status === 'scheduled') {
      return {
        kind: 'scheduled',
        approvalId: current.schedule.approval_id,
        scheduleId: current.schedule.id,
      }
    }
    return { kind: 'none' }
  } catch {
    return { kind: 'unreadable' }
  }
}
