import { buildChannelCopy, type ApprovedMetaPublishPayload } from './meta-publish-payload'
import { evaluateMetaChannelLimits } from './meta-content-text'

export { evaluateMetaChannelLimits } from './meta-content-text'

export type ChannelPreview = Readonly<{
  channel: 'instagram' | 'threads'
  versionId: string
  versionNumber: number
  fingerprint: string
  accountLabel: string
  text: string
  visibility: 'public'
  media: readonly Readonly<{ mediaId: string; position: number; mimeType: string; altText: string }> []
}>

export function buildApprovedChannelPreview(
  payload: ApprovedMetaPublishPayload,
  context: Readonly<{ versionNumber: number; accountLabel: string }>,
): ChannelPreview {
  return Object.freeze({
    channel: payload.channel,
    versionId: payload.versionId,
    versionNumber: context.versionNumber,
    fingerprint: payload.fingerprint,
    accountLabel: context.accountLabel,
    text: payload.text,
    visibility: 'public',
    media: Object.freeze(payload.media.map((item, position) => Object.freeze({
      mediaId: item.mediaId,
      position,
      mimeType: item.mimeType,
      altText: `${position + 1}번 이미지`,
    }))),
  })
}

export function buildDraftChannelPreview(input: Readonly<{
  channel: 'instagram' | 'threads'
  versionId: string
  versionNumber: number
  fingerprint: string
  accountLabel?: string
  caption: string
  hashtags: readonly string[]
  disclosure: string
  media: readonly Readonly<{ id: string; position: number; mimeType: string; altText?: string }> []
}>): ChannelPreview {
  const text = buildChannelCopy(input)
  if (evaluateMetaChannelLimits({ channel: input.channel, text, mediaCount: input.media.length }).length > 0) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  return Object.freeze({
    channel: input.channel,
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    fingerprint: input.fingerprint,
    accountLabel: input.accountLabel ?? '공식 계정',
    text,
    visibility: 'public',
    media: Object.freeze([...input.media]
      .sort((left, right) => left.position - right.position)
      .map((item, position) => Object.freeze({
        mediaId: item.id,
        position,
        mimeType: item.mimeType,
        altText: item.altText?.trim() || `${position + 1}번 이미지`,
      }))),
  })
}
