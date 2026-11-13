'use server'

import { z } from 'zod'
import { workspaceRoleSchema, type WorkspaceRole } from '@/features/auth/workspace-context'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import type { ApprovalPreviewSnapshot } from '@/features/content/types'
import { backfillPublishedDestination } from '@/features/publishing/backfill-published-destination'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  contentId: z.string().uuid(),
}).strict()

const scheduleRowSchema = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  publish_at: z.string().datetime({ offset: true }),
  status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown']),
}).strict()
const attemptRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
  provider_reference: z.string().max(500).nullable(),
}).strict()
const versionRowSchema = z.object({
  id: z.string().uuid(),
  version_number: z.number().int().positive(),
  created_at: z.string(),
  revision_reason: z.string().nullable(),
})
const trackingRowSchema = z.object({
  destination_url: z.string().url().max(2_048).nullable(),
}).strict()

export type ConversationPublishReceipt = Readonly<{
  next: 'scheduled' | 'published' | 'failed' | 'unknown'
  scheduleId: string
  attemptId: string | null
  providerPostId: string | null
  destinationUrl: string | null
  publishAt: string | null
}>

export type ConversationPreviousVersion = Readonly<{ id: string; versionNumber: number; createdAt: string; revisionReason: string | null }>

export type ConversationPublishingState = Readonly<{
  role: WorkspaceRole
  preview: ApprovalPreviewSnapshot
  receipt: ConversationPublishReceipt | null
  /** 네이버 원고만: 현재 버전을 제외한 최근 버전. 복원은 새 버전으로 추가된다. */
  previousVersions?: readonly ConversationPreviousVersion[]
}>

function failure(message: string): ActionResult<ConversationPublishingState> {
  return { error: { message, requestId: 'conversation-publishing' } }
}

export async function loadConversationPublishingAction(input: unknown): Promise<ActionResult<ConversationPublishingState>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('검토할 게시물을 확인해 주세요.')

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (userError || typeof userId !== 'string') return failure('로그인 후 다시 시도해 주세요.')

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    const role = workspaceRoleSchema.safeParse(membership?.role)
    if (membershipError || membership?.status !== 'active' || !role.success) {
      return failure('이 작업공간의 게시물을 검토할 수 없습니다.')
    }

    const preview = await getApprovalPreview(parsed.data.workspaceId, parsed.data.contentId)
    if (preview.error) return failure(preview.error.message)

    const scheduleResult = await supabase
      .from('schedules')
      .select('id, version_id, publish_at, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('content_id', parsed.data.contentId)
      .eq('version_id', preview.data.versionId)
      .order('created_at', { ascending: false })
      .limit(1)
    const scheduleRows = z.array(scheduleRowSchema).safeParse(scheduleResult.data)
    if (scheduleResult.error || !scheduleRows.success) return failure('게시 실행 기록을 불러오지 못했어요.')
    const schedule = scheduleRows.data[0] ?? null
    let receipt: ConversationPublishReceipt | null = null
    if (schedule && schedule.status !== 'cancelled') {
      const attemptResult = await supabase
        .from('publish_attempts')
        .select('id, status, provider_reference')
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('schedule_id', schedule.id)
        .order('attempt_number', { ascending: false })
        .limit(1)
      const attemptRows = z.array(attemptRowSchema).safeParse(attemptResult.data)
      if (attemptResult.error || !attemptRows.success) return failure('게시 실행 결과를 불러오지 못했어요.')
      const attempt = attemptRows.data[0] ?? null
      let destinationUrl: string | null = null
      if (attempt) {
        const trackingResult = await supabase
          .from('social_post_tracking')
          .select('destination_url')
          .eq('workspace_id', parsed.data.workspaceId)
          .eq('publish_attempt_id', attempt.id)
          .maybeSingle()
        const tracking = trackingRowSchema.nullable().safeParse(trackingResult.data)
        if (trackingResult.error || !tracking.success) {
          return failure('게시물 공개 주소를 불러오지 못했어요.')
        }
        destinationUrl = tracking.data?.destination_url ?? null
        if (
          destinationUrl === null
          && schedule.status === 'published'
          && attempt.status === 'succeeded'
          && attempt.provider_reference
        ) {
          destinationUrl = await backfillPublishedDestination({
            workspaceId: parsed.data.workspaceId,
            channelConnectionId: preview.data.account.connectionId,
            channel: preview.data.channel,
            attemptId: attempt.id,
            providerPostId: attempt.provider_reference,
          })
        }
      }
      const next = schedule.status === 'published' && attempt?.status === 'succeeded'
        ? 'published'
        : schedule.status === 'failed' || attempt?.status === 'failed'
          ? 'failed'
          : schedule.status === 'scheduled'
            ? 'scheduled'
            : 'unknown'
      receipt = Object.freeze({
        next,
        scheduleId: schedule.id,
        attemptId: attempt?.id ?? null,
        providerPostId: attempt?.provider_reference ?? null,
        destinationUrl,
        publishAt: schedule.publish_at,
      })
    }
    let previousVersions: ConversationPreviousVersion[] | undefined
    if (preview.data.channel === 'naver_blog') {
      const versionResult = await supabase
        .from('content_versions')
        .select('id, version_number, created_at, revision_reason')
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('content_id', parsed.data.contentId)
        .neq('id', preview.data.versionId)
        .order('version_number', { ascending: false })
        .limit(10)
      const rows = z.array(versionRowSchema).safeParse(versionResult.data)
      if (versionResult.error || !rows.success) return failure('이전 버전 목록을 불러오지 못했어요.')
      previousVersions = rows.data.map(row => Object.freeze({
        id: row.id, versionNumber: row.version_number, createdAt: row.created_at, revisionReason: row.revision_reason,
      }))
    }
    return { data: Object.freeze({ role: role.data, preview: preview.data, receipt, ...(previousVersions ? { previousVersions } : {}) }) }
  } catch {
    return failure('게시물 검토 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
