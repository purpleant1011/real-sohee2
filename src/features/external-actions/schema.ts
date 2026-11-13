import { z } from 'zod'

const uuid = z.string().uuid()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)

const orderedMediaSchema = z.object({
  id: uuid,
  position: z.number().int().min(0),
  signedUrl: z.url().max(2_048),
}).strict()

const contentVersionSchema = z.object({
  id: uuid,
  fingerprint,
  text: z.string().min(1).max(10_000),
  media: z.array(orderedMediaSchema).min(0).max(20).default([]),
}).strict().superRefine((value, context) => {
  const positions = value.media.map((media) => media.position)
  if (positions.some((position, index) => position !== index)) {
    context.addIssue({ code: 'custom', path: ['media'], message: '미디어 순서는 0부터 연속이어야 합니다.' })
  }
})

export const externalActionSchema = z.object({
  workspaceId: uuid,
  channel: z.enum(['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business']),
  actionKind: z.enum([
    'profile_edit',
    'news_post',
    'blog_post',
    'business_news_post',
    'feed_publish',
    'thread_publish',
    'comment_reply',
    'story_publish',
    'dm_reply',
  ]),
  target: z.object({
    externalId: z.string().min(1).max(255),
    label: z.string().min(1).max(255),
  }).strict(),
  contentVersion: contentVersionSchema,
  approval: z.object({ id: uuid, fingerprint }).strict(),
}).strict().superRefine((value, context) => {
  if (value.channel !== 'naver_blog' && value.contentVersion.media.length > 10) {
    context.addIssue({
      code: 'custom',
      path: ['contentVersion', 'media'],
      message: '네이버 블로그 외 채널은 미디어를 최대 10개까지 사용할 수 있습니다.',
    })
  }
  if (
    ['feed_publish', 'story_publish', 'blog_post', 'news_post', 'business_news_post'].includes(value.actionKind)
    && value.contentVersion.media.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['contentVersion', 'media'],
      message: '해당 작업 종류는 최소 1개 이상의 미디어가 필요합니다.',
    })
  }
  const valid =
    value.channel === 'naver_blog'
      ? value.actionKind === 'blog_post'
      : value.channel === 'instagram'
        ? ['feed_publish', 'comment_reply', 'story_publish', 'dm_reply'].includes(value.actionKind)
        : value.channel === 'threads'
          ? ['thread_publish', 'comment_reply'].includes(value.actionKind)
          : value.channel === 'daangn_business'
            ? ['profile_edit', 'news_post', 'business_news_post'].includes(value.actionKind)
            : value.actionKind === 'profile_edit' || value.actionKind === 'news_post'
  if (!valid) {
    context.addIssue({
      code: 'custom',
      path: ['actionKind'],
      message: '채널과 외부 작업 종류가 일치해야 합니다.',
    })
  }
})

export type ExternalActionInput = z.infer<typeof externalActionSchema>
