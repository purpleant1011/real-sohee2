import { z } from 'zod'
import { buildChannelCopy, evaluateMetaChannelLimits } from './meta-content-text'

export { buildChannelCopy, evaluateMetaChannelLimits, normalizeHashtag } from './meta-content-text'

const uuid = z.string().uuid()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u)
const media = z.object({
  media_asset_id: uuid,
  position: z.number().int().min(0).max(9),
  bucket_id: z.literal('content-media'),
  object_path: z.string().min(1).max(1024),
  mime_type: z.enum(['image/jpeg', 'image/png']),
  rights_status: z.literal('confirmed'),
}).strict()

const row = z.object({
  workspace_id: uuid,
  content_id: uuid,
  schedule_id: uuid,
  channel_connection_id: uuid,
  schedule_status: z.enum(['publishing', 'unknown']),
  version_id: uuid,
  current_version_id: uuid,
  approval_version_id: uuid,
  version_fingerprint: fingerprint,
  approval_fingerprint: fingerprint,
  approval_status: z.literal('approved'),
  disclosure_confirmed: z.literal(true),
  rights_confirmed: z.literal(true),
  connection_status: z.literal('connected'),
  channel: z.enum(['instagram', 'threads']),
  connection_channel: z.enum(['instagram', 'threads']),
  external_account_id: z.string().min(1).max(255),
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().min(1).max(100)).max(30),
  disclosure: z.string().max(500),
  media: z.array(media).max(10),
}).strict()

export type ApprovedMetaPublishPayload = Readonly<{
  workspaceId: string
  contentId: string
  scheduleId: string
  channelConnectionId: string
  versionId: string
  fingerprint: string
  channel: 'instagram' | 'threads'
  externalAccountId: string
  text: string
  media: readonly Readonly<{ mediaId: string; bucket: 'content-media'; objectPath: string; mimeType: 'image/jpeg' | 'image/png' }>[]
  isAiGenerated: boolean
}>

function buildMetaPublishPayload(
  input: unknown,
  expectedScheduleStatus: 'publishing' | 'unknown',
): ApprovedMetaPublishPayload {
  const parsed = row.safeParse(input)
  if (!parsed.success) throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  const value = parsed.data
  if (
    value.schedule_status !== expectedScheduleStatus
    || value.version_id !== value.current_version_id
    || value.version_id !== value.approval_version_id
    || value.version_fingerprint !== value.approval_fingerprint
    || value.channel !== value.connection_channel
    || (value.channel === 'instagram' && value.media.length === 0)
  ) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  const positions = new Set(value.media.map((item) => item.position))
  const text = buildChannelCopy(value)
  if (
    positions.size !== value.media.length
    || evaluateMetaChannelLimits({ channel: value.channel, text, mediaCount: value.media.length }).length > 0
  ) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  return Object.freeze({
    workspaceId: value.workspace_id,
    contentId: value.content_id,
    scheduleId: value.schedule_id,
    channelConnectionId: value.channel_connection_id,
    versionId: value.version_id,
    fingerprint: value.version_fingerprint,
    channel: value.channel,
    externalAccountId: value.external_account_id,
    text,
    media: Object.freeze([...value.media]
      .sort((left, right) => left.position - right.position)
      .map((item) => Object.freeze({
        mediaId: item.media_asset_id,
        bucket: item.bucket_id,
        objectPath: item.object_path,
        mimeType: item.mime_type,
      }))),
    isAiGenerated: value.disclosure.length > 0,
  })
}

export function buildApprovedMetaPublishPayload(input: unknown): ApprovedMetaPublishPayload {
  return buildMetaPublishPayload(input, 'publishing')
}

export function buildReconciledMetaPublishPayload(input: unknown): ApprovedMetaPublishPayload {
  return buildMetaPublishPayload(input, 'unknown')
}
