import { computeMobileApprovalFingerprint } from '@/features/mobile-approvals/fingerprint'
import type { ConversationDetailDto, DeliveryState, ThreadMessageDto } from '../detail-model'
import { inboxRowSchema, type InboxReadContext } from './read-inbox'
import { commentRow, dmRow, isoOrNull, read, type InboxClient, type Raw } from './inbox-source'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY = new RegExp(`^(dm|comment):(${UUID})$`, 'i')
const MESSAGE_LIMIT = 200
/** 한 건 더 읽어 절단 여부를 판정한다. 200건을 꽉 채운 응답은 '전체'가 아니다. */
const MESSAGE_FETCH = MESSAGE_LIMIT + 1

export type DetailResult =
  | { status: 'ok'; detail: ConversationDetailDto }
  | { status: 'bad_key' | 'not_found' | 'error' }

/**
 * 원문·답안으로 쓸 수 있는 글자만 통과시킨다. 없거나 공백뿐이면 null.
 * `String(null)` 이 `"null"` 인 말풍선·답안이 되지 않게 하는 경계다(없는 글은 만들지 않는다).
 */
const sourceText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** 답안 근거는 draft.options[].sources(문자열 배열)가 있을 때만 쓴다. 저장돼 있지 않으면 빈 배열 → 화면이 '근거 없음'으로 막는다. */
function sourcesFor(options: unknown, selectedId: unknown): string[] {
  if (!Array.isArray(options)) return []
  const chosen = options.find(o => o && typeof o === 'object' && (o as Raw).id === selectedId) as Raw | undefined
  const src = chosen?.sources
  return Array.isArray(src) ? src.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/**
 * 대화 상세(원문 전체·답안·지문). 지문은 기존 mobile-approvals 디스패처로 서버가 다시 계산한다
 * (DB 에 저장된 approved_fingerprint 를 그대로 믿지 않는다). 다른 가게/없는 id 는 not_found.
 */
export async function readConversationDetail(
  client: InboxClient,
  ctx: InboxReadContext,
  key: string,
  deps: { now: () => string },
): Promise<DetailResult> {
  const m = KEY.exec(key)
  if (!m) return { status: 'bad_key' }
  const kind = m[1].toLowerCase() as 'dm' | 'comment'
  const id = m[2].toLowerCase()
  const ws = ctx.workspaceId
  try {
    if (kind === 'dm') {
      const [threads, messages, drafts] = await Promise.all([
        read(client.from('instagram_dm_threads').select('id, workspace_id, customer_handle, customer_name, last_message_at, expires_at, status, last_message_text').eq('workspace_id', ws).eq('id', id)),
        // 최신 대화를 남기려고 내림차순으로 읽는다(오름차순 + limit 이면 가장 오래된 200건만 남는다).
        // 화면에는 다시 시간 오름차순으로 넘기므로, 여기서의 순서는 fetch 편의일 뿐이다.
        // sent_at 만으로는 200번째와 201번째가 같은 시각일 때 어느 행이 잘리는지 DB 가 보장하지 않는다.
        // id 를 보조 정렬키로 뒤에 붙여 (sent_at desc, id desc) 유일 순서로 경계 선택을 고정한다.
        read(client.from('instagram_dm_messages').select('id, workspace_id, thread_id, sender_type, text, sent_at').eq('workspace_id', ws).eq('thread_id', id).order('sent_at', { ascending: false }).order('id', { ascending: false }), MESSAGE_FETCH),
        read(client.from('instagram_dm_drafts').select('workspace_id, thread_id, draft_text, selected_option_id, options, updated_at').eq('workspace_id', ws).eq('thread_id', id)),
      ])
      const t = threads[0]
      if (!t || t.workspace_id !== ws) return { status: 'not_found' }
      if (messages.some(row => row.workspace_id !== ws || row.thread_id !== id) || drafts.some(row => row.workspace_id !== ws || row.thread_id !== id)) return { status: 'error' }
      const draft = drafts[0]
      const draftText = sourceText(draft?.draft_text)
      const row = dmRow(t, draftText, Date.parse(deps.now()))
      if (row.draft) row.draft.sources = sourcesFor(draft?.options, draft?.selected_option_id)
      // 내림차순으로 읽었으므로 앞에서부터 200건을 남기면 최신 200건이고, 가장 오래된 1건이 잘린다.
      // 화면이 이를 '완전한 대화'로 그리지 않도록 알린다.
      const truncated = messages.length > MESSAGE_LIMIT
      const page = truncated ? messages.slice(0, MESSAGE_LIMIT) : messages
      const msgs: ThreadMessageDto[] = []
      let omitted = 0
      for (const x of page) {
        const at = isoOrNull(x.sent_at)
        const text = sourceText(x.text)
        // 글자 없는 행은 말풍선을 지어내지 않고 건너뛴다(원문 없는 대화를 완전한 것처럼 그리지 않는다).
        if (at && text) msgs.push({ id: String(x.id), fromCustomer: x.sender_type === 'customer', text, at })
        else omitted += 1
      }
      // 화면은 오래된→최신 순서다. at 오름차순, 같은 시각이면 id 오름차순으로 고정해
      // 원본 fetch 순서와 무관하게 결과가 결정적이도록 만든다.
      msgs.sort((a, b) => (a.at === b.at
        ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        : a.at < b.at ? -1 : 1))
      return finish(row, msgs, `인스타그램 DM → ${row.customerName}`, 'dm', ws, id, draftText, draft?.updated_at, deliveryFromDm(String(t.status)), !truncated && omitted === 0)
    }
    const [comments, drafts] = await Promise.all([
      read(client.from('social_comments').select('id, workspace_id, channel, author_handle, comment_text, comment_created_at, status').eq('workspace_id', ws).eq('id', id)),
      read(client.from('comment_reply_drafts').select('workspace_id, comment_id, draft_text, updated_at').eq('workspace_id', ws).eq('comment_id', id)),
    ])
    const c = comments[0]
    if (!c || c.workspace_id !== ws) return { status: 'not_found' }
    if (drafts.some(row => row.workspace_id !== ws || row.comment_id !== id)) return { status: 'error' }
    const draftText = sourceText(drafts[0]?.draft_text)
    const row = commentRow(c, draftText)
    const at = isoOrNull(c.comment_created_at)
    const text = sourceText(c.comment_text)
    const msgs: ThreadMessageDto[] = []
    if (at && text) msgs.push({ id: String(c.id), fromCustomer: true, text, at })
    const readable = msgs.length > 0
    const where = c.channel === 'threads' ? '스레드' : '인스타그램 댓글'
    return finish(row, msgs, `${where} → ${row.customerName}`, 'comment', ws, id, draftText, drafts[0]?.updated_at, deliveryFromComment(String(c.status)), readable)
  } catch {
    return { status: 'error' }
  }
}

const deliveryFromDm = (s: string): DeliveryState => (s === 'SENT' ? 'accepted' : s === 'NEEDS_CHECK' ? 'unknown' : 'none')
const deliveryFromComment = (s: string): DeliveryState => (s === 'SENT' ? 'accepted' : s === 'NEEDS_CHECK' || s === 'FAILED' ? 'unknown' : 'none')

function finish(
  row: ReturnType<typeof dmRow> | ReturnType<typeof commentRow>, messages: ThreadMessageDto[], targetLabel: string,
  kind: 'dm' | 'comment', ws: string, id: string, draftText: string | null, updatedAt: unknown, delivery: DeliveryState,
  complete: boolean,
): DetailResult {
  const parsed = inboxRowSchema.safeParse(row)
  if (!parsed.success) return { status: 'error' }
  const fingerprint = draftText
    ? computeMobileApprovalFingerprint(kind === 'dm'
        ? { kind, workspaceId: ws, threadId: id, draftText }
        : { kind, workspaceId: ws, commentId: id, draftText })
    : null
  const version = typeof updatedAt === 'string' && !Number.isNaN(Date.parse(updatedAt)) ? Date.parse(updatedAt) : 0
  return { status: 'ok', detail: { thread: parsed.data, messages, targetLabel, fingerprint, version, draftUpdatedAt: typeof updatedAt === 'string' ? updatedAt : null, delivery, complete } }
}
