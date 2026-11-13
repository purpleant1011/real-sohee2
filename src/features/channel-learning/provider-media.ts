import { z } from 'zod'
import { LearningError } from './contracts'
import type { FetchLearningProviderInput } from './provider-fetch'

const media = z.object({ id: z.string().min(1), media_type: z.string().optional(), media_url: z.string().url().nullish() })
const post = media.extend({ caption: z.string().nullish(), text: z.string().nullish(),
  owner: z.union([z.string(), z.object({ id: z.string() })]).nullish(), username: z.string().nullish(),
  timestamp: z.string(), permalink: z.string().url().nullish(),
  children: z.object({ data: z.array(media).max(100) }).nullish(),
  is_quote_post: z.boolean().nullish(), quoted_post: z.unknown().optional(), reposted_post: z.unknown().optional(),
})
const response = z.object({ data: z.array(z.unknown()).max(100),
  paging: z.object({ cursors: z.object({ after: z.string().max(2048).optional() }).optional() }).optional() })

/** Converts the authenticated own-media edge to the collector's internal contract, never arbitrary media nodes. */
export function createOwnedMediaFetcher(input: {
  platform: 'instagram' | 'threads'; accountId: string; username: string
  fetchProvider(input: FetchLearningProviderInput): Promise<unknown>
}): (request: FetchLearningProviderInput) => Promise<unknown> {
  if (!input.accountId.trim() || !input.username.trim()) throw new LearningError('PROVIDER_ACCOUNT_BOUNDARY', '채널 본인 확인이 필요해요.')
  return async (request) => {
    if (request.provider !== input.platform || !['/me/media', '/me/threads'].includes(request.path)) {
      throw new LearningError('PROVIDER_ACCOUNT_BOUNDARY', '본인 채널의 게시물만 조회할 수 있어요.')
    }
    const fields = input.platform === 'threads'
      ? 'id,text,owner,username,media_type,media_url,permalink,timestamp,children{id,media_type,media_url},is_quote_post,quoted_post,reposted_post'
      : 'id,caption,username,media_type,media_url,permalink,timestamp,children{id,media_type,media_url}'
    const raw = await input.fetchProvider({ ...request, path: input.platform === 'threads' ? '/me/threads' : '/me/media',
      query: { limit: '25', fields, ...(request.query?.after ? { after: request.query.after } : {}) } })
    const parsed = response.safeParse(raw)
    if (!parsed.success) throw new LearningError('PROVIDER_MEDIA_INVALID', '게시물 응답을 확인하지 못했어요.')
    const data = []
    for (const item of parsed.data.data) {
      const validated = post.safeParse(item)
      if (!validated.success) continue
      const row = validated.data
      const owner = typeof row.owner === 'string' ? row.owner : row.owner?.id
      if ((owner && owner !== input.accountId) || (row.username && row.username.toLowerCase() !== input.username.toLowerCase())) continue
      if (row.is_quote_post || row.quoted_post || row.reposted_post || !Number.isFinite(Date.parse(row.timestamp))) continue
      const children = row.children?.data.filter((child) => child.media_type === 'IMAGE' && child.media_url)
      data.push({ id: row.id, author_id: input.accountId, caption: row.caption ?? row.text ?? '',
        media_type: row.media_type, timestamp: row.timestamp, permalink: row.permalink ?? undefined,
        ...(row.media_type === 'IMAGE' && row.media_url ? { media_url: row.media_url } : {}),
        ...(children?.length ? { children } : {}),
      })
    }
    return { data, paging: parsed.data.paging }
  }
}
