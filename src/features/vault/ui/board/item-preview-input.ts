import type { ChannelPreviewProps } from '@/features/preview/channel-preview'
import { evaluateChannelSpec, type ChannelVariantPayload, type SpecEvaluationResult } from '@/features/vault/channel-spec'
import type { VaultItemDetailDto } from '@/features/vault/query/types'

/** The saved variant does not store the connected account's handle, so the preview uses a neutral label instead of inventing one. */
export const PREVIEW_ACCOUNT_LABEL = '내 계정'

export type PreviewSource = Pick<VaultItemDetailDto, 'channel' | 'content' | 'media' | 'settings'>

/** Same shape the save and edit services check, so the panel next to the preview agrees with the saved verdict. */
export function toSpecVariant({ content, media }: Pick<PreviewSource, 'content' | 'media'>): ChannelVariantPayload {
  return {
    title: content.title ?? undefined,
    text: content.body,
    caption: content.body,
    hashtags: content.tags,
    media: media.map((item) => ({ type: item.type, mimeType: item.mime_type ?? undefined, fileSizeBytes: item.size_bytes ?? undefined })),
  }
}

/**
 * The only place that turns a saved item into preview adapter input. Title, body and tags are the very values the
 * copy bundle exports (both read the payload through bundle/content.ts), so the exported text equals what is shown.
 */
export function toPreviewInput(source: PreviewSource): { preview: ChannelPreviewProps; spec: SpecEvaluationResult } {
  const { channel, content, settings } = source
  const variant = toSpecVariant(source)
  const spec = evaluateChannelSpec(channel, variant)
  const mediaItems = variant.media ?? []
  switch (channel) {
    case 'instagram':
      return { spec, preview: { channel, variant: { handle: PREVIEW_ACCOUNT_LABEL, caption: content.body, hashtags: content.tags } } }
    case 'threads':
      return { spec, preview: { channel, variant: { handle: PREVIEW_ACCOUNT_LABEL, caption: content.body, hashtags: content.tags } } }
    case 'naver_blog':
      return {
        spec,
        preview: { channel, variant: { title: content.title ?? '', text: content.body, hashtags: content.tags, media: mediaItems, ...(settings.category ? { category: settings.category } : {}) } },
      }
    case 'daangn_business':
      return {
        spec,
        preview: {
          channel,
          variant: {
            text: content.body,
            hashtags: content.tags,
            media: mediaItems,
            ...(content.title ? { firstLineHighlight: content.title } : {}),
            ...(settings.coupon ? { coupon: settings.coupon } : {}),
          },
        },
      }
  }
}
