import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateChannelSpec } from '@/features/vault/channel-spec'
import type { ChannelDraftRepository, SaveChannelDraftInput } from './ports'
import type { ChannelDraftEditSnapshot, ChannelDraftResult, ChannelDraftVariant, StudioChannel } from './types'

type Client = Pick<SupabaseClient, 'from' | 'rpc'>
type Row = Record<string, any>
const FIELDS = 'workspace_id,request_key,topic,basis_notes,image_notice,variants,created_at'
const BLOCKED = '내용을 확인한 뒤 다시 보관해 주세요.'

function stableId(parts: (string | number)[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
function assertNoError(error: { code?: string; message?: string } | null): void {
  if (error) throw new Error(`[channel-drafts] ${error.code ?? 'QUERY_FAILED'}: ${error.message ?? 'Database query failed'}`)
}
function mapDraft(row: Row, workspaceId: string): ChannelDraftResult {
  if (row.workspace_id !== workspaceId) throw new Error('[channel-drafts] workspace mismatch')
  return { requestKey: row.request_key, topic: row.topic, createdAt: row.created_at, basisNotes: row.basis_notes, imageNotice: row.image_notice, variants: row.variants }
}
function captionFor(channel: StudioChannel, payload: Record<string, unknown>): string {
  const text = channel === 'instagram' ? payload.caption : payload.text
  if (typeof text === 'string' && text.trim()) return text
  if (channel === 'naver_blog' && Array.isArray(payload.blocks)) {
    return payload.blocks.map(block => block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : '').filter(Boolean).join('\n\n')
  }
  return ''
}
function titleFor(channel: StudioChannel, payload: Record<string, unknown>, topic: string): string {
  const title = channel === 'naver_blog' && typeof payload.title === 'string' ? payload.title.trim() : ''
  return (title || topic.trim()).slice(0, 200)
}
function hashtagsFor(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.hashtags) ? payload.hashtags.filter((tag): tag is string => typeof tag === 'string') : []
}

/** Server-only adapter: neither this repository nor vault save calls any external SNS API. */
export class SupabaseChannelDraftRepository implements ChannelDraftRepository {
  private readonly db: any
  constructor(admin: Client) { this.db = admin }

  async reserve(input: Omit<SaveChannelDraftInput, 'variants' | 'imageIds'>): Promise<{ kind: 'acquired' } | { kind: 'pending' } | { kind: 'existing'; result: ChannelDraftResult } | { kind: 'limit' }> {
    const { data, error } = await this.db.rpc('reserve_channel_draft_ani1538', {
      p_workspace_id: input.workspaceId, p_request_key: input.requestKey, p_created_by: input.userId,
      p_topic: input.topic, p_knowledge_version: input.knowledgeVersion, p_basis_notes: input.basisNotes,
    })
    assertNoError(error)
    if (data === 'acquired' || data === 'limit') return { kind: data }
    if (data === 'pending' || data === 'existing') {
      const existing = await this.findByRequestKey(input.workspaceId, input.requestKey)
      return existing?.variants.length ? { kind: 'existing', result: existing } : { kind: 'pending' }
    }
    throw new Error('[channel-drafts] unexpected reservation result')
  }

  async release(workspaceId: string, requestKey: string, userId: string): Promise<void> {
    const { error } = await this.db.rpc('release_channel_draft_ani1538', { p_workspace_id: workspaceId, p_request_key: requestKey, p_created_by: userId })
    assertNoError(error)
  }

  async findByRequestKey(workspaceId: string, requestKey: string): Promise<ChannelDraftResult | null> {
    const { data, error } = await this.db.from('channel_drafts').select(FIELDS).eq('workspace_id', workspaceId).eq('request_key', requestKey).maybeSingle()
    assertNoError(error)
    return data ? mapDraft(data, workspaceId) : null
  }

  async findEditSnapshot(workspaceId: string, requestKey: string): Promise<ChannelDraftEditSnapshot | null> {
    const { data, error } = await this.db.from('channel_drafts').select(`${FIELDS},knowledge_version`)
      .eq('workspace_id', workspaceId).eq('request_key', requestKey).maybeSingle()
    assertNoError(error)
    return data ? { draft: mapDraft(data, workspaceId), knowledgeVersion: data.knowledge_version } : null
  }

  async updateVariant(workspaceId: string, requestKey: string, channel: StudioChannel, expected: ChannelDraftVariant, next: ChannelDraftVariant, userId: string): Promise<ChannelDraftResult | null> {
    const { data, error } = await this.db.rpc('edit_channel_draft_variant_ani1538', {
      p_workspace_id: workspaceId, p_request_key: requestKey, p_channel: channel,
      p_expected: expected, p_next: next, p_created_by: userId,
      p_content_id: stableId([workspaceId, requestKey, channel, 'content']),
    })
    assertNoError(error)
    return data ? mapDraft(data, workspaceId) : null
  }

  async countSince(workspaceId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.db.from('channel_drafts').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', sinceIso)
    assertNoError(error)
    if (count === null || typeof count !== 'number') throw new Error('[channel-drafts] count unavailable')
    return count
  }

  async listRecent(workspaceId: string, limit: number): Promise<ChannelDraftResult[]> {
    const { data, error } = await this.db.from('channel_drafts').select(FIELDS).eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(Math.max(0, limit))
    assertNoError(error)
    if (!Array.isArray(data)) throw new Error('[channel-drafts] QUERY_FAILED: no row list')
    return data.map((row: Row) => mapDraft(row, workspaceId))
  }

  async save(input: SaveChannelDraftInput): Promise<ChannelDraftResult> {
    const imageIds = [...new Set(input.imageIds)]
    const assets = imageIds.length
      ? await this.db.from('media_assets').select('id,mime_type,size_bytes,sha256_digest').eq('workspace_id', input.workspaceId).in('id', imageIds)
      : { data: [], error: null }
    assertNoError(assets.error)
    if (!Array.isArray(assets.data)) throw new Error('[channel-drafts] QUERY_FAILED: no media row list')
    const byId = new Map<string, Row>(assets.data.map((asset: Row) => [asset.id, asset]))
    if (imageIds.some(id => !byId.get(id)?.mime_type?.startsWith('image/') || !byId.get(id)?.sha256_digest)) {
      throw new Error('[channel-drafts] image unavailable or missing digest')
    }
    const media = imageIds.map((id) => {
      const asset = byId.get(id)!
      return { type: 'image' as const, mimeType: asset.mime_type as string, fileSizeBytes: Number(asset.size_bytes) }
    })
    const variants: ChannelDraftVariant[] = []
    for (const variant of input.variants) {
      const { channel, payload, status, statusLabel, issues, savableReason } = variant
      const caption = captionFor(channel, payload)
      const title = titleFor(channel, payload, input.topic)
      const hashtags = hashtagsFor(payload)
      // Only verified media rows may influence the vault specification or preview.
      const spec = evaluateChannelSpec(channel, { title, text: caption, hashtags, media })
      const specFailure = spec.checks.find(check => check.status === 'FAIL')
      const canMaterialise = !!title.trim() && !!caption.trim() && caption.length <= 2200 && hashtags.length <= 30
      const vaultSavable = status === 'READY' && !savableReason && canMaterialise && !spec.blocksVault
      const blockedReason = vaultSavable ? null : savableReason || specFailure?.userMessage || (status !== 'READY' ? issues[0] : null) || BLOCKED
      let contentId: string | null = null
      let versionId: string | null = null
      if (canMaterialise && status === 'READY' && !savableReason) {
        contentId = stableId([input.workspaceId, input.requestKey, channel, 'content'])
        versionId = stableId([input.workspaceId, input.requestKey, channel, 1, 'version'])
      }
      const previewMedia = imageIds.map((id, position) => ({
        ...media[position], src: `/api/workspaces/${input.workspaceId}/media/${id}`,
      }))
      const previewPayload = imageIds.length ? {
        ...payload, media: previewMedia,
        ...(channel === 'instagram' ? { imageUrls: previewMedia.map(item => item.src) } : {}),
        ...(channel === 'threads' ? { imageUrl: previewMedia[0].src } : {}),
      } : payload
      variants.push({ channel, payload: previewPayload, status, statusLabel, issues, contentId, versionId, vaultSavable, blockedReason })
    }
    const { data, error } = await this.db.rpc('finalize_channel_draft_ani1538', {
      p_workspace_id: input.workspaceId, p_request_key: input.requestKey, p_created_by: input.userId,
      p_topic: input.topic, p_knowledge_version: input.knowledgeVersion, p_basis_notes: input.basisNotes,
      p_image_notice: input.imageNotice, p_variants: variants, p_media_ids: imageIds,
    })
    assertNoError(error)
    if (!data) throw new Error('[channel-drafts] reserved draft unavailable')
    return mapDraft(data, input.workspaceId)
  }
}
