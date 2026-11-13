import 'server-only'

import { z } from 'zod'

import { contentMediaIds, normalizeStoredChannelPayload } from '@/features/content/channel-content-schema'
import { localPublishJobSchema, type LocalPublishJob } from './contracts'

type Row = Record<string, unknown>

type LocalPayloadMedia = Readonly<{
  id: string
  position: number
  bucket_id: 'content-media'
  object_path: string
  sha256_digest: string | null
}>

export type LocalPayloadGateway = Readonly<{
  loadAction(workspaceId: string, actionId: string): Promise<unknown>
  loadVersion(workspaceId: string, versionId: string): Promise<unknown>
  loadCurrentContent(workspaceId: string, contentId: string): Promise<unknown>
  loadApproval(workspaceId: string, approvalId: string): Promise<unknown>
  loadConnection(workspaceId: string, connectionId: string): Promise<unknown>
  listMedia(workspaceId: string, versionId: string): Promise<unknown>
  createSignedUrl(bucket: string, objectPath: string, expiresIn: number): Promise<string>
  backfillMediaDigest(workspaceId: string, media: LocalPayloadMedia): Promise<string | null>
}>

type PayloadResult = Readonly<{ data: LocalPublishJob }> | Readonly<{ error: { code: string } }>

const actionSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(),
  channel: z.enum(['naver_blog', 'daangn_business']),
  action_kind: z.enum(['blog_post', 'business_news_post']),
  target_external_id: z.string().min(1).max(255), target_label: z.string().min(1).max(255),
  content_version_id: z.string().uuid(), approval_id: z.string().uuid(),
  approval_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  browser_channel_connection_id: z.string().uuid(),
}).strict()

const versionSchema = z.object({
  id: z.string().uuid(), content_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), structured_payload: z.unknown(),
}).strict()
const contentSchema = z.object({ current_version_id: z.string().uuid() }).strict()
const approvalSchema = z.object({
  id: z.string().uuid(), version_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('approved'),
}).strict()
const connectionSchema = z.object({
  id: z.string().uuid(), channel: z.enum(['naver_blog', 'daangn_business']),
  target_external_id: z.string().min(1).max(255),
  external_account_label: z.string().min(1).max(255),
  environment: z.enum(['test', 'production']).optional(), status: z.literal('connected'),
}).strict()
const mediaSchema = z.array(z.object({
  id: z.string().uuid(), position: z.number().int().min(0).max(19),
  bucket_id: z.literal('content-media'), object_path: z.string().min(1).max(1_024),
  sha256_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict()).min(1).max(20)

async function productionGateway(): Promise<LocalPayloadGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const admin = createAdminSupabaseClient() as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): unknown
      }
    }
    storage: { from(bucket: string): {
      createSignedUrl(path: string, expires: number): Promise<{ data: { signedUrl?: string } | null; error: unknown }>
      download(path: string): Promise<{ data: Blob | null; error: unknown }>
    } }
  }
  async function single(table: string, columns: string, filters: readonly [string, string][]) {
    let query = admin.from(table).select(columns) as unknown as { eq(column: string, value: string): unknown; maybeSingle(): Promise<{ data: unknown; error: unknown }> }
    for (const [column, value] of filters) query = query.eq(column, value) as typeof query
    const result = await query.maybeSingle()
    if (result.error) throw new Error('local_payload_query_failed')
    return result.data
  }
  return {
    loadAction: (workspaceId, actionId) => single('external_action_requests', 'id, workspace_id, channel, action_kind, target_external_id, target_label, content_version_id, approval_id, approval_fingerprint, browser_channel_connection_id', [['workspace_id', workspaceId], ['id', actionId]]),
    loadVersion: (workspaceId, versionId) => single('content_versions', 'id, content_id, fingerprint, structured_payload', [['workspace_id', workspaceId], ['id', versionId]]),
    loadCurrentContent: (workspaceId, contentId) => single('content_items', 'current_version_id', [['workspace_id', workspaceId], ['id', contentId]]),
    loadApproval: (workspaceId, approvalId) => single('approvals', 'id, version_id, fingerprint, status', [['workspace_id', workspaceId], ['id', approvalId]]),
    loadConnection: (workspaceId, connectionId) => single('browser_channel_connections', 'id, channel, target_external_id, external_account_label, environment, status', [['workspace_id', workspaceId], ['id', connectionId]]),
    async listMedia(workspaceId, versionId) {
      const query = admin.from('content_version_media').select('position, media_assets!content_version_media_workspace_id_media_asset_id_fkey(id, bucket_id, object_path, sha256_digest)') as unknown as {
        eq(column: string, value: string): { eq(column: string, value: string): { order(column: string): Promise<{ data: unknown; error: unknown }> } }
      }
      const result = await query.eq('workspace_id', workspaceId).eq('version_id', versionId).order('position')
      if (result.error || !Array.isArray(result.data)) throw new Error('local_payload_media_failed')
      return result.data.map((row: Row) => ({ position: row.position, ...(row.media_assets as Row) }))
    },
    async createSignedUrl(bucket, objectPath, expiresIn) {
      const result = await admin.storage.from(bucket).createSignedUrl(objectPath, expiresIn)
      const url = result.data?.signedUrl
      if (result.error || typeof url !== 'string' || !url.startsWith('https://')) throw new Error('local_payload_sign_failed')
      return url
    },
    async backfillMediaDigest(workspaceId, media) {
      const downloaded = await admin.storage.from(media.bucket_id).download(media.object_path)
      if (downloaded.error || downloaded.data === null) return null
      const bytes = await downloaded.data.arrayBuffer()
      const digestBytes = await crypto.subtle.digest('SHA-256', bytes)
      const digest = Array.from(new Uint8Array(digestBytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const query = admin.from('media_assets') as unknown as {
        update(values: { sha256_digest: string }): {
          eq(column: string, value: string): {
            eq(column: string, value: string): {
              eq(column: string, value: string): Promise<{ error: unknown }>
            }
          }
        }
      }
      const persisted = await query.update({ sha256_digest: digest })
        .eq('workspace_id', workspaceId)
        .eq('id', media.id)
        .eq('object_path', media.object_path)
      return persisted.error ? null : digest
    },
  }
}

export async function loadApprovedLocalPayload(
  workspaceId: string,
  actionId: string,
  leaseId: string,
  providedGateway?: LocalPayloadGateway,
): Promise<PayloadResult> {
  try {
    const gateway = providedGateway ?? await productionGateway()
    const action = actionSchema.safeParse(await gateway.loadAction(workspaceId, actionId))
    if (!action.success || action.data.workspace_id !== workspaceId) return { error: { code: 'ACTION_NOT_FOUND' } }
    const [versionRaw, approvalRaw, connectionRaw] = await Promise.all([
      gateway.loadVersion(workspaceId, action.data.content_version_id),
      gateway.loadApproval(workspaceId, action.data.approval_id),
      gateway.loadConnection(workspaceId, action.data.browser_channel_connection_id),
    ])
    const version = versionSchema.safeParse(versionRaw)
    const approval = approvalSchema.safeParse(approvalRaw)
    const connection = connectionSchema.safeParse(connectionRaw)
    if (!version.success || !approval.success || !connection.success) return { error: { code: 'REAPPROVAL_REQUIRED' } }
    const content = contentSchema.safeParse(await gateway.loadCurrentContent(workspaceId, version.data.content_id))
    if (!content.success
      || content.data.current_version_id !== version.data.id
      || approval.data.version_id !== version.data.id
      || approval.data.fingerprint !== version.data.fingerprint
      || action.data.approval_fingerprint !== version.data.fingerprint
      || connection.data.channel !== action.data.channel
      || connection.data.target_external_id !== action.data.target_external_id) {
      return { error: { code: 'REAPPROVAL_REQUIRED' } }
    }
    const media = mediaSchema.safeParse(await gateway.listMedia(workspaceId, version.data.id))
    if (!media.success || media.data.some((item) => item.position !== media.data.indexOf(item))) {
      return { error: { code: 'MEDIA_INVALID' } }
    }
    const publishPayload = normalizeStoredChannelPayload(version.data.structured_payload)
    const payloadMedia = contentMediaIds(publishPayload as never)
    if (payloadMedia.length !== media.data.length || payloadMedia.some((id, index) => id !== media.data[index]?.id)) {
      return { error: { code: 'MEDIA_INVALID' } }
    }
    const mediaWithDigests = await Promise.all(media.data.map(async (item) => ({
      ...item,
      sha256_digest: item.sha256_digest ?? await gateway.backfillMediaDigest(workspaceId, item),
    })))
    if (mediaWithDigests.some((item) => item.sha256_digest === null)) {
      return { error: { code: 'MEDIA_DIGEST_REQUIRED' } }
    }
    const signedMedia = await Promise.all(mediaWithDigests.map(async (item) => ({
      id: item.id,
      position: item.position,
      signedUrl: await gateway.createSignedUrl(item.bucket_id, item.object_path, 900),
      digest: item.sha256_digest as string,
    })))
    const parsed = localPublishJobSchema.safeParse({
      id: action.data.id,
      workspaceId,
      channel: action.data.channel,
      actionKind: action.data.action_kind,
      targetConnectionId: action.data.browser_channel_connection_id,
      ...(connection.data.environment ? { environment: connection.data.environment } : {}),
      targetExternalId: action.data.target_external_id,
      targetLabel: connection.data.external_account_label,
      contentVersionId: version.data.id,
      versionFingerprint: version.data.fingerprint,
      approvalId: approval.data.id,
      approvalFingerprint: approval.data.fingerprint,
      structuredPayload: publishPayload,
      media: signedMedia,
      submitPermitRequired: true,
    })
    return parsed.success ? { data: Object.freeze(parsed.data) } : { error: { code: 'PAYLOAD_INVALID' } }
  } catch {
    return { error: { code: 'PAYLOAD_UNAVAILABLE' } }
  }
}
