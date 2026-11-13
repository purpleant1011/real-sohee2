import { z } from 'zod'
import { supportedChannels, type SupportedChannel } from '@/features/channels/channel-capabilities'
import { NAVER_VISIBILITIES } from '@/features/naver-publish/types'
import { blogStrategyBriefSchema } from './blog-strategy-brief'

const uuidSchema = z.string().uuid()
const nonBlankText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, '공백 외의 내용을 입력해 주세요.')
const optionalTrimmedText = (maximum: number) => z.string().trim().max(maximum)
const hashtagSchema = z.string().regex(/^#[^\s#]+$/)
const mediaIdsSchema = z.array(uuidSchema).min(1).max(10).superRefine((ids, context) => {
  if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    context.addIssue({ code: 'custom', message: '같은 미디어를 두 번 사용할 수 없습니다.' })
  }
})

const imagePlacementSchema = z
  .object({
    mediaId: uuidSchema,
    placement: z.enum(['cover', 'inline', 'detail', 'proof', 'action']),
    altText: nonBlankText(500),
  })
  .strict()

const naverEditorTextBlockSchema = (kind: 'paragraph' | 'heading' | 'quote' | 'cta', maximum: number) => z.object({
  kind: z.literal(kind),
  text: nonBlankText(maximum),
}).strict()

const naverEditorBlockSchema = z.discriminatedUnion('kind', [
  naverEditorTextBlockSchema('paragraph', 8_000),
  naverEditorTextBlockSchema('heading', 200),
  naverEditorTextBlockSchema('quote', 1_000),
  naverEditorTextBlockSchema('cta', 500),
  z.object({
    kind: z.literal('image'),
    mediaId: uuidSchema,
    altText: nonBlankText(500),
  }).strict(),
  z.object({
    kind: z.literal('link'),
    url: z.string().url().max(2_048).refine((value) => new URL(value).protocol === 'https:'),
    title: nonBlankText(300),
  }).strict(),
  z.object({
    kind: z.literal('map'),
    placeName: nonBlankText(200),
  }).strict(),
])

const orderedImagePlacementsSchema = (maximum: number) => z
  .array(imagePlacementSchema)
  .min(1)
  .max(maximum)
  .superRefine((placements, context) => {
    if (new Set(placements.map((placement) => placement.mediaId.toLowerCase())).size !== placements.length) {
      context.addIssue({ code: 'custom', message: '같은 미디어를 두 번 사용할 수 없습니다.' })
    }
  })

const instagramContentSchema = z
  .object({
    channel: z.literal('instagram'),
    caption: nonBlankText(2_200),
    hashtags: z.array(hashtagSchema).max(30),
    slides: orderedImagePlacementsSchema(10),
    cta: optionalTrimmedText(500),
  })
  .strict()

const threadsContentSchema = z
  .object({
    channel: z.literal('threads'),
    segments: z.array(nonBlankText(500)).min(1).max(20),
    mediaIds: z.array(uuidSchema).max(10).superRefine((ids, context) => {
      if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
        context.addIssue({ code: 'custom', message: '같은 미디어를 두 번 사용할 수 없습니다.' })
      }
    }),
    question: optionalTrimmedText(500),
  })
  .strict()

import { approvedFactBasisSchema } from './approved-fact-basis'
import { POST_FORMAT_IDS, POST_IMAGE_STYLE_IDS, POST_REACTION_IDS } from '@/features/channel-studio/naver/post-modules'

const naverBlogContentSchema = z
  .object({
    channel: z.literal('naver_blog'),
    title: nonBlankText(200),
    introduction: nonBlankText(2_000),
    sections: z
      .array(
        z
          .object({
            heading: nonBlankText(200),
            body: nonBlankText(8_000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    keywords: z.array(nonBlankText(100)).min(1).max(30),
    imagePlacements: orderedImagePlacementsSchema(20),
    strategyBrief: blogStrategyBriefSchema.optional(),
    factBasis: approvedFactBasisSchema.optional(),
    editorBlocks: z.array(naverEditorBlockSchema).min(1).max(80).optional(),
    postMode: z.enum(POST_FORMAT_IDS).optional(),
    reaction: z.enum(POST_REACTION_IDS).optional(),
    imageStyle: z.enum(POST_IMAGE_STYLE_IDS).optional(),
    cta: nonBlankText(500),
    categoryId: z.string().min(1).max(255).nullable().optional(),
    visibility: z.enum(NAVER_VISIBILITIES).optional(),
    scheduledAt: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.editorBlocks) return
    const blockMediaIds = value.editorBlocks
      .filter((block): block is Extract<typeof block, { kind: 'image' }> => block.kind === 'image')
      .map((block) => block.mediaId)
    const placementMediaIds = value.imagePlacements.map((placement) => placement.mediaId)
    if (blockMediaIds.length !== placementMediaIds.length
      || blockMediaIds.some((mediaId, index) => mediaId !== placementMediaIds[index])) {
      context.addIssue({
        code: 'custom',
        path: ['editorBlocks'],
        message: '편집 블록의 이미지 순서가 승인된 이미지 순서와 일치해야 합니다.',
      })
    }
  })

const naverPlaceContentSchema = z
  .object({
    channel: z.literal('naver_place'),
    postKind: z.literal('place_news'),
    title: nonBlankText(200),
    body: nonBlankText(2_200),
    mediaIds: mediaIdsSchema,
    validUntil: z.string().datetime({ offset: true }),
  })
  .strict()

const daangnBusinessContentSchema = z
  .object({
    channel: z.literal('daangn_business'),
    title: nonBlankText(200),
    body: nonBlankText(2_200),
    mediaIds: mediaIdsSchema,
    localCta: nonBlankText(500),
    targetNeighborhood: nonBlankText(120),
  })
  .strict()

export const channelContentSchema = z.discriminatedUnion('channel', [
  instagramContentSchema,
  threadsContentSchema,
  naverBlogContentSchema,
  naverPlaceContentSchema,
  daangnBusinessContentSchema,
])

export type ChannelContent = z.infer<typeof channelContentSchema>

export function normalizeNaverPublicText(value: string): string {
  return value
    .replace(/외부 게시 전 사람이 검토하는 비공개 초안/gu, '공개 게시 전 사실관계를 검토한 안내 글')
    .replace(/자동 게시되지 않는 사람 검토용 비공개 초안/gu, '일반적인 상담 준비 정보를 제공하는 공개 안내 글')
    .replace(/비공개 검토용 초안/gu, '공개 안내 글')
    .replace(/비공개 초안/gu, '공개 안내 글')
}

export function normalizeNaverPublicCopy(content: ChannelContent): ChannelContent {
  if (content.channel !== 'naver_blog' || !content.visibility || content.visibility === 'private') return content
  return {
    ...content,
    title: normalizeNaverPublicText(content.title),
    introduction: normalizeNaverPublicText(content.introduction),
    sections: content.sections.map((section) => ({
      heading: normalizeNaverPublicText(section.heading),
      body: normalizeNaverPublicText(section.body),
    })),
    cta: normalizeNaverPublicText(content.cta),
    editorBlocks: content.editorBlocks?.map((block) => {
      if (block.kind === 'image') return block
      if (block.kind === 'link') return { ...block, title: normalizeNaverPublicText(block.title) }
      if (block.kind === 'map') return { ...block, placeName: normalizeNaverPublicText(block.placeName) }
      return { ...block, text: normalizeNaverPublicText(block.text) }
    }),
  }
}

export function normalizeStoredChannelPayload(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const row = input as Record<string, unknown>
  if (row.channel !== 'naver_blog') {
    return input
  }
  const publishPayload = { ...row }
  delete publishPayload.editorBlueprint
  delete publishPayload.generation
  return publishPayload
}

export function naverPublishSettings(content: Extract<ChannelContent, { channel: 'naver_blog' }>) {
  return Object.freeze({
    categoryId: content.categoryId ?? null,
    visibility: content.visibility ?? 'private' as const,
  })
}

export function parseChannelContent(input: unknown): ChannelContent {
  return channelContentSchema.parse(input)
}

export function contentMediaIds(content: ChannelContent): readonly string[] {
  switch (content.channel) {
    case 'instagram':
      return content.slides.map((slide) => slide.mediaId)
    case 'threads':
    case 'naver_place':
    case 'daangn_business':
      return content.mediaIds
    case 'naver_blog':
      return content.imagePlacements.map((placement) => placement.mediaId)
  }
}

export function isSupportedChannel(channel: string): channel is SupportedChannel {
  return supportedChannels.includes(channel as SupportedChannel)
}
