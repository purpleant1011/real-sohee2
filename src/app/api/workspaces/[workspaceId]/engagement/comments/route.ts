export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { SupabaseEngagementRepository } from '@/features/engagement/repository'
import { isEngagementFeatureOn } from '@/features/engagement/engagement-allowlist'
import {
  getChannelLabel,
  getClassificationLabel,
  getStatusLabel,
} from '@/features/engagement/labels'
import { formatAccountLabel } from '@/features/vault/ui/release-panel/release-service'
import type { CommentStatus, SocialChannel } from '@/features/engagement/types'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const url = new URL(request.url)
    const status = url.searchParams.get('status') as CommentStatus | null
    const channel = url.searchParams.get('channel') as SocialChannel | null
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 20
    const cursor = url.searchParams.get('cursor') || undefined

    const repo = new SupabaseEngagementRepository(auth.admin)
    const { comments, nextCursor } = await repo.listComments(auth.workspaceId, {
      status: status || undefined,
      channel: channel || undefined,
      limit,
      cursor,
    })

    // Fetch drafts for these comments
    const commentIds = comments.map((c) => c.id)
    const draftsByCommentId: Record<string, unknown> = {}
    if (commentIds.length > 0) {
      const { data: drafts } = await auth.admin
        .from('comment_reply_drafts')
        .select('*')
        .eq('workspace_id', auth.workspaceId)
        .in('comment_id', commentIds)

      if (Array.isArray(drafts)) {
        for (const draft of drafts) {
          draftsByCommentId[draft.comment_id] = draft
        }
      }
    }

    // Fetch channel connections to expose account_label
    const { data: connections } = await auth.admin
      .from('channel_connections')
      .select('channel, account_label')
      .eq('workspace_id', auth.workspaceId)

    const accountLabelsByChannel: Record<string, string> = {}
    if (Array.isArray(connections)) {
      for (const conn of connections) {
        if (conn.channel) {
          accountLabelsByChannel[conn.channel] = formatAccountLabel(conn.account_label)
        }
      }
    }

    const send_enabled = isEngagementFeatureOn('ENGAGEMENT_SEND_ENABLED', auth.workspaceId)
    const cycle_enabled = isEngagementFeatureOn('ENGAGEMENT_CYCLE_ENABLED', auth.workspaceId)

    const now = new Date()
    const [igAutoSent, thAutoSent] = await Promise.all([
      repo.countAutoRepliesSentToday(auth.workspaceId, 'instagram', now).catch(() => 0),
      repo.countAutoRepliesSentToday(auth.workspaceId, 'threads', now).catch(() => 0),
    ])
    const auto_replied_today_count = (igAutoSent || 0) + (thAutoSent || 0)

    const items = comments.map((comment) => ({
      ...comment,
      channel_label: getChannelLabel(comment.channel),
      account_label: accountLabelsByChannel[comment.channel] ?? '연결된 계정',
      status_label: getStatusLabel(comment.status),
      classification_label: getClassificationLabel(comment.classification),
      draft: draftsByCommentId[comment.id] || null,
    }))

    return NextResponse.json(
      { items, nextCursor, send_enabled, cycle_enabled, auto_replied_today_count },
      { status: 200, headers: NO_STORE }
    )
  } catch {
    return NextResponse.json(
      { error: '댓글 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
