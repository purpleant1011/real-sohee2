import { createHash } from 'node:crypto'
import { z } from 'zod'
import { QuickPostError, summarize, type QuickPostSummary } from './quick-post-service'

type AdminClient = any
const publishedStatuses = ['PUBLISHED_VERIFIED', 'COMPLETED', 'LISTENING']
const cursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  direction: z.enum(['next', 'prev']),
  inclusive: z.boolean().optional(),
  scope: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type QuickPostCursorPayload = z.infer<typeof cursorSchema>

function invalidInput(): never {
  throw new QuickPostError('검색 조건이나 페이지 주소를 확인해 주세요.', 'INVALID_INPUT', 422)
}

export function encodeQuickPostCursor(payload: QuickPostCursorPayload): string {
  return Buffer.from(JSON.stringify(cursorSchema.parse(payload))).toString('base64url')
}

export function decodeQuickPostCursor(cursor?: string | null): QuickPostCursorPayload | null {
  if (!cursor || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null
  try {
    const value = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return value.success ? value.data : null
  } catch { return null }
}

const optionsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(1024).nullish(),
  q: z.string().trim().max(200).default(''),
  status: z.enum(['waiting', 'published', 'all']).default('all'),
  channel: z.enum(['instagram', 'threads', 'all']).default('all'),
})
export interface ListQuickPostsOptions {
  limit?: number
  cursor?: string | null
  q?: string | null
  status?: 'waiting' | 'published' | 'all' | null
  channel?: 'instagram' | 'threads' | 'all' | null
}

export function parseQuickPostList(params: URLSearchParams): ListQuickPostsOptions {
  // Legacy bare consumers expect all stages in the most recent 40 supported posts.
  // Filtered ContentHub requests keep their 20-item contract and existing cursor scope.
  const hasFilterParams = ['q', 'status', 'channel'].some(key => params.has(key))
  const result = optionsSchema.safeParse({
    ...Object.fromEntries(['cursor', 'q', 'status', 'channel'].flatMap(key => params.has(key) ? [[key, params.get(key)]] : [])),
    limit: params.has('limit') ? Number(params.get('limit')) : hasFilterParams ? 20 : 40,
  })
  if (!result.success || (result.data.cursor && !decodeQuickPostCursor(result.data.cursor))) invalidInput()
  return result.data
}

export interface QuickPostPaginatedResult {
  items: QuickPostSummary[]
  nextCursor: string | null
  prevCursor: string | null
  hasNextPage: boolean
  hasAnySupportedContent: boolean
}

// Shared by listing, edge probes and the unfiltered workspace existence check.
function supportedQuery(admin: AdminClient, workspaceId: string, columns = 'id, status, metadata, created_at') {
  return admin.from('marketing_missions').select(columns).eq('workspace_id', workspaceId)
    .not('metadata->payload->copies->instagram->>caption', 'is', null)
    .not('metadata->payload->copies->threads->>content', 'is', null)
}

function project(workspaceId: string, row: any): QuickPostSummary {
  const copies = row.metadata?.payload?.copies
  if (typeof copies?.instagram?.caption !== 'string' || typeof copies?.threads?.content !== 'string') {
    throw new QuickPostError('콘텐츠 형식을 확인하지 못했어요.', 'INVALID_CONTENT', 500)
  }
  const summary = summarize(workspaceId, row)
  if (!summary) throw new QuickPostError('콘텐츠 형식을 확인하지 못했어요.', 'INVALID_CONTENT', 500)
  return summary
}

export async function getQuickPost(admin: AdminClient, workspaceId: string, missionId: string): Promise<QuickPostSummary | null> {
  if (!z.uuid().safeParse(missionId).success) invalidInput()
  const { data, error } = await admin.from('marketing_missions').select('id, status, metadata, created_at')
    .eq('workspace_id', workspaceId).eq('id', missionId).maybeSingle()
  if (error) throw new QuickPostError('게시물을 불러오지 못했어요.', 'DETAIL_FAILED', 500)
  if (!data || !data.metadata?.payload?.copies) return null
  return project(workspaceId, data)
}

// PostgREST quoted values escape grammar separately from PostgreSQL regex metacharacters.
function searchValue(q: string) {
  const regex = q.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  return `"${regex.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function boundary(query: any, value: { createdAt: string; id: string }, direction: 'next' | 'prev', inclusive = false) {
  const op = direction === 'next' ? 'lt' : 'gt'
  const idOp = inclusive ? `${op}e` : op
  return query.or(`created_at.${op}.${value.createdAt},and(created_at.eq.${value.createdAt},id.${idOp}.${value.id})`)
}

export async function listQuickPostsPage(admin: AdminClient, workspaceId: string, options: ListQuickPostsOptions = {}): Promise<QuickPostPaginatedResult> {
  const parsed = optionsSchema.safeParse({ ...options, q: options.q ?? undefined, status: options.status ?? undefined, channel: options.channel ?? undefined })
  if (!parsed.success) invalidInput()
  const { limit, q, status, channel, cursor } = parsed.data
  const scope = createHash('sha256').update(JSON.stringify([workspaceId, q, status, channel, limit])).digest('hex')
  const position = cursor ? decodeQuickPostCursor(cursor) : null
  if (cursor && (!position || position.scope !== scope)) invalidInput()

  const filteredQuery = (columns?: string) => {
    let query = supportedQuery(admin, workspaceId, columns)
    if (status === 'published') query = query.in('status', publishedStatuses)
    if (status === 'waiting') query = query.not('status', 'in', `(${publishedStatuses.join(',')})`)
    if (channel !== 'all') query = query.contains('metadata', { payload: { channels: [{ provider: channel }] } })
    if (q) {
      const value = searchValue(q)
      query = query.or([
        `metadata->quick->>topic.imatch.${value}`,
        `and(metadata->quick->>topic.is.null,metadata->draft->>topic.imatch.${value})`,
        `metadata->payload->copies->instagram->>caption.imatch.${value}`,
        `metadata->payload->copies->threads->>content.imatch.${value}`,
      ].join(','))
    }
    return query
  }
  const backwards = position?.direction === 'prev'
  let query = filteredQuery()
  if (position) query = boundary(query, position, position.direction, position.inclusive)
  query = query.order('created_at', { ascending: backwards }).order('id', { ascending: backwards }).limit(limit + 1)
  const [page, existence] = await Promise.all([query, supportedQuery(admin, workspaceId, 'id').limit(1)])
  if (page.error || existence.error) throw new QuickPostError('콘텐츠 목록을 불러오지 못했어요.', 'LIST_FAILED', 500)
  const rows = (page.data ?? []).slice(0, limit)
  if (backwards) rows.reverse()
  const items = rows.map((row: any) => project(workspaceId, row))
  const encode = (item: QuickPostSummary, direction: 'next' | 'prev') => encodeQuickPostCursor({ createdAt: item.createdAt, id: item.missionId, direction, scope })
  const hasBeyond = (page.data ?? []).length > limit
  let hasNextPage = backwards ? false : hasBeyond
  let hasPreviousPage = backwards ? hasBeyond : false
  if (items.length && position) {
    const edge = backwards ? items[items.length - 1] : items[0]
    const probe = await boundary(filteredQuery('id'), { createdAt: edge.createdAt, id: edge.missionId }, backwards ? 'next' : 'prev').limit(1)
    if (probe.error) throw new QuickPostError('콘텐츠 목록을 불러오지 못했어요.', 'LIST_FAILED', 500)
    if (backwards) hasNextPage = Boolean(probe.data?.length)
    else hasPreviousPage = Boolean(probe.data?.length)
  }
  return {
    items,
    nextCursor: items.length && hasNextPage ? encode(items[items.length - 1], 'next') : null,
    // An empty next page must recover the prior page's last item, not strand the pivot.
    prevCursor: items.length && hasPreviousPage ? encode(items[0], 'prev') : !items.length && position?.direction === 'next' ? encodeQuickPostCursor({ ...position, direction: 'prev', inclusive: true }) : null,
    hasNextPage,
    hasAnySupportedContent: Boolean(existence.data?.length),
  }
}
