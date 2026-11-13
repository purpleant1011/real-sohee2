import type { ChannelPreviewProps } from '@/features/preview/channel-preview'
import { NAVER_VISIBILITIES } from '@/features/naver-publish/types'
import type { SpecEvaluationResult } from '@/features/vault/channel-spec'
import type { StudioChannel } from '../types'

export interface PayloadToPreviewOptions {
  accountLabel?: string
  specResult?: SpecEvaluationResult
  contextLabel?: string
}

const DEFAULT_ACCOUNT_LABEL = '내 계정'
const DEFAULT_DAANGN_NAME = '비즈프로필'

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function safeMedia(value: unknown): Array<{ type: 'image'; src: string }> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is { type: 'image'; src: string } =>
    !!item && typeof item === 'object' && item.type === 'image' && typeof item.src === 'string' && item.src.startsWith('/api/workspaces/'))
    .map(({ src }) => ({ type: 'image', src }))
}

export function payloadToPreview(
  channel: StudioChannel,
  payload?: Record<string, unknown> | null,
  options: PayloadToPreviewOptions = {},
): ChannelPreviewProps {
  const { accountLabel, specResult, contextLabel } = options
  const raw = payload ?? {}

  switch (channel) {
    case 'instagram': {
      const caption = safeString(raw.caption) ?? safeString(raw.text) ?? ''
      const hashtags = safeStringArray(raw.hashtags)
      const imageUrl = safeString(raw.imageUrl)
      const imageUrls = Array.isArray(raw.imageUrls) ? safeStringArray(raw.imageUrls) : safeMedia(raw.media).map((item) => item.src)
      const timeLabel = safeString(raw.timeLabel)

      return {
        channel: 'instagram',
        variant: {
          handle: accountLabel || DEFAULT_ACCOUNT_LABEL,
          caption,
          hashtags,
          ...(imageUrl ? { imageUrl } : {}),
          ...(imageUrls ? { imageUrls } : {}),
          ...(timeLabel ? { timeLabel } : {}),
        },
        ...(specResult ? { specResult } : {}),
        ...(contextLabel ? { contextLabel } : {}),
      }
    }

    case 'threads': {
      const caption = safeString(raw.caption) ?? safeString(raw.text) ?? ''
      const hashtags = safeStringArray(raw.hashtags)
      const imageUrl = safeString(raw.imageUrl) ?? safeMedia(raw.media)[0]?.src
      const timeLabel = safeString(raw.timeLabel)

      return {
        channel: 'threads',
        variant: {
          handle: accountLabel || DEFAULT_ACCOUNT_LABEL,
          caption,
          hashtags,
          ...(imageUrl ? { imageUrl } : {}),
          ...(timeLabel ? { timeLabel } : {}),
        },
        ...(specResult ? { specResult } : {}),
        ...(contextLabel ? { contextLabel } : {}),
      }
    }

    case 'naver_blog': {
      const title = safeString(raw.title) ?? ''
      const text = safeString(raw.text) ?? safeString(raw.caption) ?? ''
      const hashtags = safeStringArray(raw.hashtags)
      const blocks = Array.isArray(raw.blocks) ? (raw.blocks as any) : undefined
      const category = safeString(raw.category)
      const visibility = NAVER_VISIBILITIES.find((value) => value === raw.visibility)
      const media = safeMedia(raw.media)

      return {
        channel: 'naver_blog',
        variant: {
          title,
          text,
          ...(blocks ? { blocks } : {}),
          ...(hashtags.length ? { hashtags } : {}),
          ...(category ? { category } : {}),
          ...(visibility ? { visibility } : {}),
          ...(media ? { media } : {}),
        },
        ...(specResult ? { specResult } : {}),
        ...(contextLabel ? { contextLabel } : {}),
      }
    }

    case 'daangn_business': {
      const text = safeString(raw.text) ?? safeString(raw.caption) ?? ''
      const firstLineHighlight = safeString(raw.firstLineHighlight) ?? safeString(raw.title)
      const coupon = safeString(raw.coupon)
      const hashtags = safeStringArray(raw.hashtags)
      const media = safeMedia(raw.media)
      const businessName = safeString(raw.businessName) || accountLabel || DEFAULT_DAANGN_NAME
      const timeLabel = safeString(raw.timeLabel)

      return {
        channel: 'daangn_business',
        variant: {
          text,
          ...(firstLineHighlight ? { firstLineHighlight } : {}),
          ...(coupon ? { coupon } : {}),
          ...(hashtags.length ? { hashtags } : {}),
          ...(media.length ? { media: media.map(({ src }) => ({ type: 'image' as const, url: src })) } : {}),
          businessName,
          ...(timeLabel ? { timeLabel } : {}),
        },
        ...(specResult ? { specResult } : {}),
        ...(contextLabel ? { contextLabel } : {}),
      }
    }
  }
}
