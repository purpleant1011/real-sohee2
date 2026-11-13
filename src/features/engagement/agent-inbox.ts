import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { SupabaseInstagramDmRepository } from './dm/repository'
import { computeApprovalFingerprint } from './draft'
import { computeDmApprovalFingerprint, checkIsDmExpired } from './dm/options-generator'

const uuid = z.string().uuid()
const time = z.string().datetime({ offset: true })
const commentSchema = z.object({ id: uuid, workspace_id: uuid, channel: z.enum(['instagram', 'threads']),
  comment_text: z.string(), author_handle: z.string().nullable().optional(), status: z.string(), comment_created_at: time })
const messageSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, text: z.string(), sent_at: time })
const draftSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, draft_text: z.string(), updated_at: time })

/** Reads canonical stored inboxes only. Discovery never generates drafts, changes status, or sends. */
export async function loadAgentInbox(input: {
  client: ServerSupabaseClient; workspaceId: string; kind?: 'all' | 'comments' | 'dm'
  channel?: string; unreadOnly?: boolean; limit?: number
}) {
  const workspaceId = uuid.parse(input.workspaceId)
  const limit = Number.isSafeInteger(input.limit) ? Math.max(1, Math.min(10, input.limit!)) : 5
  const channel = input.channel?.toLowerCase()
  if ((channel && !['all', 'instagram', 'threads', 'instagram_dm'].includes(channel))
    || (input.kind === 'dm' && channel === 'threads')
    || (input.kind === 'comments' && channel === 'instagram_dm')) throw new Error('INBOX_CHANNEL_UNSUPPORTED')
  const includeComments = input.kind !== 'dm' && channel !== 'instagram_dm'
  const includeDm = input.kind !== 'comments' && channel !== 'threads'
  const commentLimit = includeDm && includeComments ? Math.ceil(limit / 2) : limit
  const dmLimit = includeComments ? limit - commentLimit : limit
  const comments: z.infer<typeof commentSchema>[] = []
  let moreComments = false
  if (includeComments) {
    let query = input.client.from('social_comments').select('id,workspace_id,channel,comment_text,author_handle,status,comment_created_at')
      .eq('workspace_id', workspaceId).order('comment_created_at', { ascending: false }).order('id', { ascending: false }).limit(commentLimit + 1)
    if (channel === 'instagram' || channel === 'threads') query = query.eq('channel', channel)
    if (input.unreadOnly) query = query.in('status', ['NEW', 'CLASSIFIED', 'DRAFTED', 'APPROVED'])
    const rows = await query
    const parsed = z.array(commentSchema).safeParse(rows.data)
    if (rows.error || !parsed.success) throw new Error('INBOX_COMMENTS_READ_UNAVAILABLE')
    if (parsed.data.some(row => row.workspace_id !== workspaceId)) throw new Error('INBOX_SCOPE_MISMATCH')
    moreComments = parsed.data.length > commentLimit
    comments.push(...parsed.data.slice(0, commentLimit))
  }
  const repo = new SupabaseInstagramDmRepository(input.client)
  const dm = includeDm && dmLimit > 0 ? await repo.listThreads(workspaceId, { strict: true, readOnly: true, limit: dmLimit,
    ...(input.unreadOnly ? { status: 'NEEDS_REPLY' as const } : {}) }) : { threads: [], nextCursor: undefined }
  const dmThreads = await Promise.all(dm.threads.map(async thread => {
    const [latest, draft] = await Promise.all([
      input.client.from('instagram_dm_messages').select('id,workspace_id,thread_id,text,sent_at')
        .eq('workspace_id', workspaceId).eq('thread_id', thread.id).eq('sender_type', 'customer')
        .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
      input.client.from('instagram_dm_drafts').select('id,workspace_id,thread_id,draft_text,updated_at')
        .eq('workspace_id', workspaceId).eq('thread_id', thread.id).maybeSingle(),
    ])
    if (latest.error || draft.error) throw new Error('INBOX_DM_CONTEXT_UNAVAILABLE')
    const source = latest.data === null ? null : messageSchema.parse(latest.data)
    const saved = draft.data === null ? null : draftSchema.parse(draft.data)
    if ((source && (source.workspace_id !== workspaceId || source.thread_id !== thread.id))
      || (saved && (saved.workspace_id !== workspaceId || saved.thread_id !== thread.id))) throw new Error('INBOX_SCOPE_MISMATCH')
    return { id: thread.id, channel: 'instagram' as const, customerLabel: thread.customer_name || thread.customer_handle,
      lastMessageText: source?.text ?? thread.last_message_text, latestCustomerMessageId: source?.id ?? null,
      lastMessageAt: source?.sent_at ?? thread.last_message_at, expiresAt: thread.expires_at, status: thread.status,
      replyWindowExpired: checkIsDmExpired(thread.expires_at), requiresUserApproval: true,
      draft: saved ? { id: saved.id, text: saved.draft_text, updatedAt: saved.updated_at,
        fingerprint: computeDmApprovalFingerprint(workspaceId, thread.id, saved.draft_text) } : null }
  }))
  const reviews = comments.map(row => ({ id: row.id, channel: row.channel, authorName: row.author_handle || '방문 고객',
    commentText: row.comment_text, status: row.status, createdAt: row.comment_created_at,
    sourceFingerprint: computeApprovalFingerprint(workspaceId, row.id, row.comment_text) }))
  return { source: 'stored_inbound_records' as const, observedAt: new Date().toISOString(), reviews, dmThreads,
    count: reviews.length + dmThreads.length, partial: moreComments || Boolean(dm.nextCursor) || (includeDm && dmLimit === 0),
    scopes: { commentsRead: includeComments, dmRead: includeDm && dmLimit > 0 },
    note: '저장된 수신 기록의 제한된 범위입니다. 빈 목록·수집 누락·전체 처리 완료를 혼동하지 마세요. 발송 권한은 별도 확인합니다.' }
}
