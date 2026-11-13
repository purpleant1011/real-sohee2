import 'server-only'
import { z } from 'zod'
import type { SocialPostPreviewMap } from './types'

type Query = PromiseLike<{ data: unknown; error: unknown }>
export type SocialPostPreviewGateway = Readonly<{
  listVersions(workspaceId: string, versionIds: readonly string[]): Query
  listMedia(workspaceId: string, versionIds: readonly string[]): Query
  listAccounts(workspaceId: string): Query
}>

const uuid = z.string().uuid()
const versionRow = z.object({
  id: uuid,
  workspace_id: uuid,
  caption: z.string().min(1).max(2_200),
  hashtags: z.array(z.string()),
  content_items: z.object({ channel: z.enum(['instagram', 'threads']) }).strict(),
}).strict()
const mediaRow = z.object({
  version_id: uuid,
  media_asset_id: uuid,
  position: z.number().int().min(0).max(10),
}).strict()
const accountRow = z.object({
  channel: z.enum(['instagram', 'threads']),
  account_label: z.string().min(1).max(120).nullable(),
}).strict()

export async function getSocialPostPreviews(
  workspaceId: string,
  rawVersionIds: readonly string[],
  providedGateway?: SocialPostPreviewGateway,
): Promise<SocialPostPreviewMap> {
  if (!uuid.safeParse(workspaceId).success) return Object.freeze({})
  const versionIds = [...new Set(rawVersionIds.filter((id) => uuid.safeParse(id).success))]
  if (versionIds.length === 0) return Object.freeze({})

  try {
    const source = providedGateway ?? await productionGateway()
    const [versionsResult, mediaResult, accountsResult] = await Promise.all([
      source.listVersions(workspaceId, versionIds),
      source.listMedia(workspaceId, versionIds),
      source.listAccounts(workspaceId),
    ])
    const versions = z.array(versionRow).safeParse(versionsResult.data)
    const media = z.array(mediaRow).safeParse(mediaResult.data)
    const accounts = z.array(accountRow).safeParse(accountsResult.data)
    if (versionsResult.error || mediaResult.error || accountsResult.error || !versions.success || !media.success || !accounts.success) {
      return Object.freeze({})
    }
    const accountByChannel = new Map(accounts.data.map((row) => [row.channel, row.account_label ?? '소희 공식계정']))
    return Object.freeze(Object.fromEntries(versions.data.map((version) => {
      const channel = version.content_items.channel
      return [version.id, Object.freeze({
        versionId: version.id,
        channel,
        accountLabel: accountByChannel.get(channel) ?? '소희 공식계정',
        caption: version.caption,
        hashtags: Object.freeze([...version.hashtags]),
        media: Object.freeze(media.data.filter((item) => item.version_id === version.id).sort((left, right) => left.position - right.position).map((item, index) => Object.freeze({
          id: item.media_asset_id,
          position: item.position,
          altText: `게시 이미지 ${index + 1}`,
          src: `/api/workspaces/${workspaceId}/media/${item.media_asset_id}`,
        }))),
      })]
    })))
  } catch {
    return Object.freeze({})
  }
}

async function productionGateway(): Promise<SocialPostPreviewGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    listVersions: (workspaceId, versionIds) => supabase.from('content_versions')
      .select('id, workspace_id, caption, hashtags, content_items!content_versions_workspace_content_fkey!inner(channel)')
      .eq('workspace_id', workspaceId)
      .in('id', [...versionIds]),
    listMedia: (workspaceId, versionIds) => supabase.from('content_version_media')
      .select('version_id, media_asset_id, position')
      .eq('workspace_id', workspaceId)
      .in('version_id', [...versionIds])
      .order('position', { ascending: true }),
    listAccounts: (workspaceId) => supabase.from('channel_connections')
      .select('channel, account_label')
      .eq('workspace_id', workspaceId)
      .eq('status', 'connected')
      .in('channel', ['instagram', 'threads']),
  }
}
