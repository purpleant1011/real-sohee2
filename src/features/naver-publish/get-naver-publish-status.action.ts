'use server'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/errors/result'
import {
  localExecutionViewState,
} from '@/features/schedule/repository'
import type { LocalExecutionViewState } from '@/features/local-publishing/publish-status-card'
import { NAVER_VISIBILITIES, type NaverVisibility } from '@/features/naver-publish/types'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  contentId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
}).strict()

export type NaverPublishStatusData = Readonly<{
  id: string
  status: LocalExecutionViewState
  phase: string | null
  resultUrl: string | null
  failureCode: string | null
  visibility: NaverVisibility
  scheduledAt: string | null
  targetLabel: string
}>

const REVIEWER_ROLES = new Set(['owner', 'manager', 'reviewer'])

function fail(message: string): ActionResult<never> {
  return { error: { message, requestId: 'get-naver-publish-status' } }
}

export async function getNaverPublishStatusAction(
  input: unknown,
): Promise<ActionResult<NaverPublishStatusData | null>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return fail('요청 정보를 확인해 주세요.')
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') {
      return fail('로그인이 필요해요.')
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError || membership?.status !== 'active' || !REVIEWER_ROLES.has(membership.role)) {
      return fail('이 매장에 접근할 수 없어요.')
    }

    let versionIds: string[] = []
    if (parsed.data.versionId) {
      versionIds = [parsed.data.versionId]
    } else {
      const { data: versions } = await supabase
        .from('content_versions')
        .select('id')
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('content_id', parsed.data.contentId)
      versionIds = (versions ?? []).map((v: { id: string }) => v.id)
    }

    if (versionIds.length === 0) {
      return { data: null }
    }

    const { data: requests } = await supabase
      .from('external_action_requests')
      .select('id, status, target_label, content_version_id, scheduled_at, auto_execute_until, failure_code, exact_payload')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('channel', 'naver_blog')
      .in('content_version_id', versionIds)
      .order('created_at', { ascending: false })
      .limit(1)

    const request = requests?.[0]
    if (!request) {
      return { data: null }
    }

    const { data: receipts } = await supabase
      .from('external_action_receipts')
      .select('result_url')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('action_request_id', request.id)
      .order('created_at', { ascending: false })
      .limit(1)

    const resultUrl = receipts?.[0]?.result_url ?? null
    const viewState = localExecutionViewState(request.status)
    const payload = (request.exact_payload ?? {}) as Record<string, unknown>
    const visibility: NaverVisibility = (typeof payload.visibility === 'string' && (NAVER_VISIBILITIES as readonly string[]).includes(payload.visibility))
      ? (payload.visibility as NaverVisibility)
      : 'private'

    const entry: NaverPublishStatusData = {
      id: request.id,
      status: viewState,
      phase: request.status,
      resultUrl,
      failureCode: request.failure_code ?? null,
      visibility,
      scheduledAt: request.scheduled_at ?? null,
      targetLabel: request.target_label ?? '네이버 블로그',
    }

    return { data: entry }
  } catch {
    return fail('게시 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
