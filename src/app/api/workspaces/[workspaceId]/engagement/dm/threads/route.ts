export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createInstagramDmService } from '@/features/engagement/dm/compose'
import { isEngagementFeatureOn } from '@/features/engagement/engagement-allowlist'
import {
  checkIsDmExpired,
  getDmCountdownInfo,
} from '@/features/engagement/dm/options-generator'
import { formatAccountLabel } from '@/features/vault/ui/release-panel/release-service'
import type {
  InstagramDmDraft,
  InstagramDmStatus,
  InstagramDmThreadItem,
} from '@/features/engagement/dm/types'

const NO_STORE = { 'Cache-Control': 'no-store' }

function getDmStatusLabel(status: InstagramDmStatus): string {
  switch (status) {
    case 'NEEDS_REPLY':
      return '답장 필요'
    case 'NEEDS_CHECK':
      return '확인 필요'
    case 'SENT':
      return '완료'
    case 'EXPIRED':
      return '만료됨'
    case 'DISMISSED':
      return '무시함'
    default:
      return '답장 필요'
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const url = new URL(request.url)
    const rawStatus = url.searchParams.get('status')
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 20
    const cursor = url.searchParams.get('cursor') || undefined

    let filterStatus: InstagramDmStatus | undefined
    if (rawStatus === 'needs_reply' || rawStatus === 'NEEDS_REPLY') {
      filterStatus = 'NEEDS_REPLY'
    } else if (rawStatus === 'needs_check' || rawStatus === 'NEEDS_CHECK') {
      filterStatus = 'NEEDS_CHECK'
    } else if (rawStatus === 'sent' || rawStatus === 'SENT') {
      filterStatus = 'SENT'
    } else if (rawStatus === 'expired' || rawStatus === 'EXPIRED') {
      filterStatus = 'EXPIRED'
    } else if (rawStatus === 'dismissed' || rawStatus === 'DISMISSED') {
      filterStatus = 'DISMISSED'
    }

    const service = createInstagramDmService(auth.admin)
    const { threads, nextCursor } = await service.repo.listThreads(auth.workspaceId, {
      status: filterStatus,
      limit,
      cursor,
    })

    // Fetch drafts for these threads
    const threadIds = threads.map((t) => t.id)
    const draftsByThreadId: Record<string, InstagramDmDraft> = {}
    if (threadIds.length > 0) {
      const { data: drafts } = await auth.admin
        .from('instagram_dm_drafts')
        .select('*')
        .eq('workspace_id', auth.workspaceId)
        .in('thread_id', threadIds)

      if (Array.isArray(drafts)) {
        for (const draft of drafts) {
          draftsByThreadId[draft.thread_id] = draft as InstagramDmDraft
        }
      }
    }

    // Auto-create drafts for threads lacking one or refresh stale drafts on new customer messages
    for (const thread of threads) {
      const existingDraft = draftsByThreadId[thread.id]
      const isDraftStale = existingDraft && (
        thread.status === 'NEEDS_REPLY' &&
        Date.parse(thread.last_message_at) > Date.parse(existingDraft.updated_at || existingDraft.created_at)
      )

      if (
        (!existingDraft || isDraftStale) &&
        thread.status === 'NEEDS_REPLY' &&
        !checkIsDmExpired(thread.expires_at)
      ) {
        try {
          const options = await service.generateDraftOptions(auth.workspaceId, thread)
          const firstOpt = options[0]
          const createdDraft = await service.repo.saveDraft(
            auth.workspaceId,
            thread.id,
            options,
            firstOpt.id,
            firstOpt.draftText,
            null
          )
          draftsByThreadId[thread.id] = createdDraft
        } catch (err) {
          console.error('[dm/threads] Failed to auto-generate draft for thread:', thread.id, err)
        }
      }
    }

    // Fetch messages for each thread (timeline)
    const messagesByThreadId: Record<string, any[]> = {}
    if (threadIds.length > 0) {
      const { data: messages } = await auth.admin
        .from('instagram_dm_messages')
        .select('*')
        .eq('workspace_id', auth.workspaceId)
        .in('thread_id', threadIds)
        .order('sent_at', { ascending: true })

      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (!messagesByThreadId[msg.thread_id]) {
            messagesByThreadId[msg.thread_id] = []
          }
          messagesByThreadId[msg.thread_id].push(msg)
        }
      }
    }

    // Fetch channel connections to expose account_label
    const { data: connections } = await auth.admin
      .from('channel_connections')
      .select('channel, account_label')
      .eq('workspace_id', auth.workspaceId)
      .eq('channel', 'instagram')

    const accountLabel =
      Array.isArray(connections) && connections.length > 0
        ? formatAccountLabel(connections[0].account_label)
        : 'Instagram 계정'

    const send_enabled = isEngagementFeatureOn('ENGAGEMENT_SEND_ENABLED', auth.workspaceId)

    const items: InstagramDmThreadItem[] = threads.map((thread) => {
      const countdown = getDmCountdownInfo(thread.expires_at)
      return {
        ...thread,
        channel_label: 'Instagram',
        account_label: accountLabel,
        status_label: getDmStatusLabel(thread.status),
        countdown_text: countdown.label,
        is_expired: countdown.isExpired,
        remaining_seconds: countdown.remainingSeconds,
        draft: draftsByThreadId[thread.id] || null,
        messages: messagesByThreadId[thread.id] || [],
      }
    })

    return NextResponse.json(
      { items, nextCursor, send_enabled },
      { status: 200, headers: NO_STORE }
    )
  } catch {
    return NextResponse.json(
      { error: '메시지 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
