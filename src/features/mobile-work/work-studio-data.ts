import 'server-only'

import { pickVerifiedPostUrl, toHistoryMessages, toPanelConnectionStatus, type AttemptFallbackRow, type HistoryMessage, type LivePost, type ReceiptRow, type WorkStudioContext } from './work-studio-model'

/** 서버 전용: 원고 → 대화 산출물 → 대화 메시지, 그리고 읽어 확인된 게시 주소를 가게 범위로만 조회한다. */
export async function loadWorkStudioContext(workspaceId: string, contentId: string): Promise<WorkStudioContext> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  let thread: WorkStudioContext['thread'] = null
  let messages: HistoryMessage[] = []
  let historyError = false
  try {
    const artifacts = await supabase.from('conversation_artifacts').select('source_message_id, created_at')
      .eq('workspace_id', workspaceId).eq('content_item_id', contentId).order('created_at', { ascending: true }).limit(1)
    if (artifacts.error) throw artifacts.error
    const sourceMessageId = artifacts.data?.[0]?.source_message_id
    if (sourceMessageId) {
      const source = await supabase.from('messages').select('thread_id').eq('workspace_id', workspaceId).eq('id', sourceMessageId).maybeSingle()
      if (source.error) throw source.error
      const threadId = source.data?.thread_id
      if (threadId) {
        const [t, m] = await Promise.all([
          supabase.from('conversation_threads').select('id, title').eq('workspace_id', workspaceId).eq('id', threadId).maybeSingle(),
          supabase.from('messages').select('id, role, content, created_at').eq('workspace_id', workspaceId).eq('thread_id', threadId)
            .order('created_at', { ascending: true }).limit(120),
        ])
        if (t.error || m.error) throw (t.error ?? m.error)
        if (t.data) thread = { id: t.data.id, title: t.data.title ?? null }
        if (!Array.isArray(m.data)) throw new Error('MESSAGES_QUERY_FAILED')
        messages = toHistoryMessages(m.data as never)
      }
    }
  } catch {
    historyError = true
  }

  let livePost: LivePost | null = null
  let publishAttemptId: string | null = null
  let providerPostId: string | null = null
  let publishedAt: string | null = null
  try {
    const schedules = await supabase.from('schedules').select('id').eq('workspace_id', workspaceId).eq('content_id', contentId).limit(20)
    if (schedules.error || !Array.isArray(schedules.data)) {
      throw (schedules.error ?? new Error('SCHEDULES_QUERY_FAILED'))
    }
    const ids = schedules.data.map(s => s.id)
    if (ids.length > 0) {
      const [receiptsRes, attemptsRes] = await Promise.all([
        supabase.from('external_action_receipts')
          .select('verified, verified_at, result_url, external_url, provider_post_url')
          .eq('workspace_id', workspaceId).in('schedule_id', ids).eq('verified', true).limit(20),
        supabase.from('publish_attempts')
          .select('id, provider_reference, finished_at, status')
          .eq('workspace_id', workspaceId).in('schedule_id', ids).eq('status', 'succeeded').not('provider_reference', 'is', null)
          .order('finished_at', { ascending: false }).limit(20),
      ])
      if (receiptsRes.error || attemptsRes.error || !Array.isArray(receiptsRes.data) || !Array.isArray(attemptsRes.data)) {
        throw (receiptsRes.error ?? attemptsRes.error ?? new Error('PUBLISH_EVIDENCE_QUERY_FAILED'))
      }
      let destinationByAttemptId = new Map<string, string>()
      const attemptIds = attemptsRes.data.map(a => a.id)
      if (attemptIds.length > 0) {
        const trackingRes = await supabase.from('social_post_tracking')
          .select('publish_attempt_id, destination_url')
          .eq('workspace_id', workspaceId).in('publish_attempt_id', attemptIds).limit(20)
        if (!trackingRes.error && Array.isArray(trackingRes.data)) {
          destinationByAttemptId = new Map(
            trackingRes.data.flatMap(t => t.destination_url ? [[t.publish_attempt_id, t.destination_url]] : []),
          )
        }
      }
      const attemptCandidates: AttemptFallbackRow[] = attemptsRes.data.map(a => ({
        status: a.status,
        finished_at: a.finished_at,
        destination_url: destinationByAttemptId.get(a.id) ?? null,
      }))
      const receipts = receiptsRes.data as ReceiptRow[]
      livePost = pickVerifiedPostUrl(receipts, attemptCandidates)
      const latestAttempt = attemptsRes.data[0]
      if (latestAttempt) {
        publishAttemptId = latestAttempt.id
        providerPostId = latestAttempt.provider_reference
        publishedAt = latestAttempt.finished_at
      }
    }
  } catch {
    livePost = null
  }
  let connectionStatus: WorkStudioContext['connectionStatus'] = 'unknown'
  try {
    const item = await supabase.from('content_items').select('channel').eq('workspace_id', workspaceId).eq('id', contentId).maybeSingle()
    const channel = item.data?.channel
    if (!item.error && (channel === 'instagram' || channel === 'threads')) {
      const conn = await supabase.from('channel_connections').select('status').eq('workspace_id', workspaceId).eq('channel', channel)
        .order('updated_at', { ascending: false }).limit(1)
      if (!conn.error) connectionStatus = toPanelConnectionStatus(conn.data?.[0]?.status)
    }
  } catch {
    connectionStatus = 'unknown'
  }
  return {
    thread,
    messages,
    livePost,
    historyError,
    connectionStatus,
    publishAttemptId,
    providerPostId,
    publishedAt,
  }
}
