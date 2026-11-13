import type { InboxReadContext, InboxSourceResult } from './read-inbox'

export const INBOX_PAGE_LIMIT = 100

interface QueryResult { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
/** 사용자 권한(RLS) supabase 클라이언트의 필요한 부분만. 관리자 키 클라이언트를 넘기지 않는다. */
export interface QueryBuilder {
  select(columns: string): QueryBuilder
  eq(column: string, value: string): QueryBuilder
  in(column: string, values: string[]): QueryBuilder
  order(column: string, opts: { ascending: boolean }): QueryBuilder
  limit(n: number): PromiseLike<QueryResult>
}
export interface InboxClient { from(table: string): QueryBuilder }

export type Raw = Record<string, unknown>
export const isoOrNull = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)

/**
 * 원문·답안으로 쓸 수 있는 글자만 통과시킨다. 없거나 공백뿐이면 null.
 * `String(null)` 이 `"null"` 이 되어 답안처럼 보이는 것을 막는 경계다(없는 글은 만들지 않는다).
 */
export const sourceText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export async function read(qb: QueryBuilder, max = INBOX_PAGE_LIMIT): Promise<Raw[]> {
  const { data, error } = await qb.limit(max)
  if (error || !data) throw new Error('inbox_read_failed')
  return data
}

const DM_STATUS: Record<string, string> = { NEEDS_REPLY: 'needs_reply', SENT: 'waiting_customer', DISMISSED: 'handled', EXPIRED: 'handled' }
const COMMENT_STATUS: Record<string, string> = {
  RECEIVED: 'needs_reply', CLASSIFIED: 'needs_reply', DRAFTED: 'draft_ready', APPROVED: 'draft_ready', SENT: 'handled', DISMISSED: 'handled',
}


export function dmRow(t: Raw, draftText: string | null, nowMs: number) {
  const raw = String(t.status)
  const expired = Date.parse(String(t.expires_at)) < nowMs || raw === 'EXPIRED'
  const draft = sourceText(draftText)
  const status = raw === 'NEEDS_REPLY' && draft ? 'draft_ready' : DM_STATUS[raw] ?? 'unknown'
  const at = isoOrNull(t.last_message_at)
  const message = sourceText(t.last_message_text)
  return {
    id: `dm:${t.id}`, workspaceId: t.workspace_id, channel: 'instagram_dm',
    customerName: (typeof t.customer_name === 'string' && t.customer_name) || t.customer_handle,
    consent: 'unknown', status, unread: raw === 'NEEDS_REPLY',
    // 원문이 없으면 `text: undefined` 로 스키마를 깨뜨려 줄 전체를 버리지 않고, 원문 없음(null)으로 내린다.
    lastMessage: at && message ? { text: message, receivedAt: at, fromCustomer: true } : null,
    draft: draft ? { text: draft, sources: [] as string[] } : null,
    sendBlockers: expired ? ['NO_SEND_SCOPE', 'WINDOW_EXPIRED'] : ['NO_SEND_SCOPE'],
  }
}

export function commentRow(c: Raw, draftText: string | null) {
  const at = isoOrNull(c.comment_created_at)
  const draft = sourceText(draftText)
  const message = sourceText(c.comment_text)
  return {
    id: `comment:${c.id}`, workspaceId: c.workspace_id,
    channel: c.channel === 'threads' ? 'threads' : 'instagram_comment',
    customerName: c.author_handle, consent: 'unknown',
    status: COMMENT_STATUS[String(c.status)] ?? 'unknown', unread: String(c.status) === 'RECEIVED',
    lastMessage: at && message ? { text: message, receivedAt: at, fromCustomer: true } : null,
    draft: draft ? { text: draft, sources: [] as string[] } : null,
    sendBlockers: ['NO_SEND_SCOPE'],
  }
}

/** 초안 표의 행 → id 별 초안 글. 글 없는 행(draft_text null)은 버린다. */
function draftMap(rows: Raw[], key: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const text = sourceText(row.draft_text)
    if (text) map.set(String(row[key]), text)
  }
  return map
}

/**
 * 실제 수집 테이블(instagram_dm_threads/drafts, social_comments/comment_reply_drafts)을 사용자 RLS 로 읽는다.
 * 목록 전용이라 발송 권한은 항상 NO_SEND_SCOPE(실제 발송은 승인 게이트 화면 담당), 수신동의 출처는 없어 unknown.
 * 하나라도 읽기에 실패하면 던진다(일부만 성공한 목록을 완전한 것처럼 내리지 않는다).
 */
export async function readInboxSource(
  client: InboxClient,
  ctx: InboxReadContext,
  opts: { now: () => string; datasetMode: InboxSourceResult['datasetMode'] },
): Promise<InboxSourceResult> {
  const ws = ctx.workspaceId
  const [threads, comments] = await Promise.all([
    read(client.from('instagram_dm_threads')
      .select('id, workspace_id, customer_handle, customer_name, last_message_at, expires_at, status, last_message_text')
      .eq('workspace_id', ws).order('last_message_at', { ascending: false })),
    read(client.from('social_comments')
      .select('id, workspace_id, channel, author_handle, comment_text, comment_created_at, status')
      .eq('workspace_id', ws).order('comment_created_at', { ascending: false })),
  ])
  const [dmDrafts, commentDrafts] = await Promise.all([
    threads.length ? read(client.from('instagram_dm_drafts').select('thread_id, draft_text').eq('workspace_id', ws).in('thread_id', threads.map(t => String(t.id)))) : Promise.resolve([]),
    comments.length ? read(client.from('comment_reply_drafts').select('comment_id, draft_text').eq('workspace_id', ws).in('comment_id', comments.map(c => String(c.id)))) : Promise.resolve([]),
  ])
  const dmDraft = draftMap(dmDrafts, 'thread_id')
  const cDraft = draftMap(commentDrafts, 'comment_id')
  const nowMs = Date.parse(opts.now())

  const dmRows = threads.map(t => dmRow(t, dmDraft.get(String(t.id)) ?? null, nowMs))
  const commentRows = comments.map(c => commentRow(c, cDraft.get(String(c.id)) ?? null))
  return {
    rows: [...dmRows, ...commentRows],
    complete: threads.length < INBOX_PAGE_LIMIT && comments.length < INBOX_PAGE_LIMIT,
    observedAt: opts.now(),
    datasetMode: opts.datasetMode,
  }
}
