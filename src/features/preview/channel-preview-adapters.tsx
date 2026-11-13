import type { ReactNode } from 'react'
import { InstagramAdapterPreview, ThreadsAdapterPreview, type InstagramPreviewVariant, type ThreadsPreviewVariant } from './instagram-threads-adapters'
import { NaverBlogPreview, type NaverBlogVariant } from './naver/naver-blog-preview'
import { evaluateChannelSpec, type ChannelType, type ChannelVariantPayload, type SpecEvaluationResult } from '@/features/vault/channel-spec'
import { DaangnNewsPreview, type DaangnNewsVariant } from './daangn'


type PreviewSlot = Readonly<{ status: 'ready' | 'coming_soon'; content?: ReactNode }>

/** Adapter renderers populate only the frame content slot, never the frame chrome. */
export interface ChannelPreviewAdapter<TVariant> {
  readonly id: ChannelType
  readonly requiredFields: readonly (keyof TVariant)[]
  readonly optionalFields: readonly (keyof TVariant)[]
  readonly render: (variant: TVariant) => PreviewSlot
  readonly evaluateSpec: (variant: ChannelVariantPayload) => SpecEvaluationResult
}

type DaangnVariant = DaangnNewsVariant

export const channelPreviewAdapters = {
  instagram: {
    id: 'instagram',
    requiredFields: ['handle', 'caption'],
    optionalFields: ['hashtags', 'imageUrl', 'imageUrls', 'timeLabel'],
    render: (variant) => ({ status: 'ready', content: <InstagramAdapterPreview {...variant} /> }),
    evaluateSpec: (variant) => evaluateChannelSpec('instagram', variant),
  } satisfies ChannelPreviewAdapter<InstagramPreviewVariant>,
  threads: {
    id: 'threads',
    requiredFields: ['handle', 'caption'],
    optionalFields: ['hashtags', 'imageUrl', 'timeLabel'],
    render: (variant) => ({ status: 'ready', content: <ThreadsAdapterPreview {...variant} /> }),
    evaluateSpec: (variant) => evaluateChannelSpec('threads', variant),
  } satisfies ChannelPreviewAdapter<ThreadsPreviewVariant>,
  naver_blog: {
    id: 'naver_blog',
    requiredFields: ['title', 'text'],
    optionalFields: ['blocks', 'media', 'hashtags', 'category', 'visibility'],
    render: (variant?: NaverBlogVariant) => variant
      ? { status: 'ready', content: <NaverBlogPreview variant={variant} specResult={evaluateChannelSpec('naver_blog', variant)} /> }
      : { status: 'coming_soon' },
    evaluateSpec: (variant) => evaluateChannelSpec('naver_blog', variant),
  } satisfies ChannelPreviewAdapter<NaverBlogVariant>,
  daangn_business: {
    id: 'daangn_business',
    requiredFields: ['text'],
    optionalFields: ['firstLineHighlight', 'coupon', 'media', 'videoCount', 'businessName', 'timeLabel'],
    render: (variant?: DaangnNewsVariant) => {
      if (!variant) {
        return { status: 'coming_soon' }
      }
      return {
        status: 'ready',
        content: <DaangnNewsPreview variant={variant} />,
      }
    },
    evaluateSpec: (variant) => evaluateChannelSpec('daangn_business', variant),
  } satisfies ChannelPreviewAdapter<DaangnVariant>,
} as const

export type ChannelPreviewVariant<TChannel extends ChannelType> =
  TChannel extends 'instagram' ? InstagramPreviewVariant :
  TChannel extends 'threads' ? ThreadsPreviewVariant :
  TChannel extends 'naver_blog' ? NaverBlogVariant : DaangnVariant
