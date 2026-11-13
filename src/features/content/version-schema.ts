import { z } from 'zod'
import {
  contentMediaIds,
  channelContentSchema,
  type ChannelContent,
} from './channel-content-schema'
import { supportedChannels } from '@/features/channels/channel-capabilities'

function containsNonWhitespace(value: string): boolean {
  return value.trim().length > 0
}

const captionSchema = z
  .string()
  .min(1)
  .max(2_200)
  .refine(containsNonWhitespace, '문구에 공백 외의 내용을 입력해 주세요.')

const hashtagsSchema = z.array(z.string().regex(/^#[^\s#]+$/)).max(30)
const disclosureSchema = z.string().max(500)
const revisionReasonSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(containsNonWhitespace, '수정 이유에 공백 외의 내용을 입력해 주세요.')

export const revisionResultSchema = z.object({
  caption: captionSchema,
  hashtags: hashtagsSchema,
  disclosure: disclosureSchema,
  revisionReason: revisionReasonSchema,
})

const uuidListSchema = (maximum: number) =>
  z.array(z.string().uuid()).max(maximum).superRefine((ids, context) => {
    if (new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
      context.addIssue({ code: 'custom', message: '같은 식별자를 두 번 사용할 수 없습니다.' })
    }
  })

function legacyStructuredPayload(input: {
  channel: (typeof supportedChannels)[number]
  caption: string
  hashtags: string[]
  mediaIds: string[]
}): ChannelContent | null {
  if (input.channel === 'instagram') {
    return {
      channel: 'instagram',
      caption: input.caption,
      hashtags: input.hashtags,
      slides: input.mediaIds.map((mediaId, index) => ({
        mediaId,
        placement: index === 0 ? 'cover' : 'inline',
        altText: `콘텐츠 미디어 ${index + 1}`,
      })),
      cta: '상담이 필요하면 문의해 주세요.',
    }
  }
  if (input.channel === 'threads') {
    return {
      channel: 'threads',
      segments: [input.caption],
      mediaIds: input.mediaIds,
      question: '어떤 점이 가장 궁금한가요?',
    }
  }
  return null
}

const versionInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    contentId: z.string().uuid(),
    channel: z.enum(supportedChannels),
    ...revisionResultSchema.shape,
    rightsConfirmed: z.literal(true),
    generationEvidenceConfirmed: z.literal(true),
    mediaIds: z.array(z.string().uuid()).max(20),
    structuredPayload: channelContentSchema.optional(),
    knowledgeIds: uuidListSchema(50).default([]),
    harnessRuleIds: uuidListSchema(50).default([]),
  })
  .transform((value, context) => {
    const structuredPayload = value.structuredPayload ?? legacyStructuredPayload(value)
    if (!structuredPayload) {
      context.addIssue({
        code: 'custom',
        path: ['structuredPayload'],
        message: '이 채널의 구조화 콘텐츠를 입력해 주세요.',
      })
      return z.NEVER
    }
    return { ...value, structuredPayload }
  })
  .superRefine((value, context) => {
    if (value.channel !== 'naver_blog' && value.mediaIds.length > 10) {
      context.addIssue({
        code: 'custom',
        path: ['mediaIds'],
        message: '이 채널은 미디어를 최대 10개까지 사용할 수 있습니다.',
      })
    }
    if (value.channel !== 'threads' && value.mediaIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['mediaIds'],
        message: '이 채널은 미디어를 1개 이상 선택해야 합니다.',
      })
    }
    if (
      new Set(value.mediaIds.map((mediaId) => mediaId.toLowerCase())).size !==
      value.mediaIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mediaIds'],
        message: '같은 미디어를 한 버전에 두 번 추가할 수 없습니다.',
      })
    }
    if (value.structuredPayload.channel !== value.channel) {
      context.addIssue({
        code: 'custom',
        path: ['structuredPayload', 'channel'],
        message: '콘텐츠 채널과 구조화 페이로드 채널이 일치해야 합니다.',
      })
    }
    if (value.structuredPayload.channel === 'naver_blog'
      && value.structuredPayload.strategyBrief
      && value.structuredPayload.strategyBrief.workspaceId !== value.workspaceId) {
      context.addIssue({
        code: 'custom',
        path: ['structuredPayload', 'strategyBrief', 'workspaceId'],
        message: '전략과 콘텐츠의 작업공간이 일치해야 합니다.',
      })
    }
    if (value.structuredPayload.channel === 'naver_blog'
      && value.structuredPayload.factBasis
      && value.structuredPayload.factBasis.workspaceId !== value.workspaceId) {
      context.addIssue({
        code: 'custom', path: ['structuredPayload', 'factBasis', 'workspaceId'],
        message: '승인 근거와 콘텐츠의 작업공간이 일치해야 합니다.',
      })
    }
    const payloadMediaIds = contentMediaIds(value.structuredPayload)
    if (
      payloadMediaIds.length !== value.mediaIds.length ||
      payloadMediaIds.some((mediaId, index) => mediaId !== value.mediaIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['structuredPayload'],
        message: '구조화 콘텐츠의 미디어 순서가 버전 미디어와 일치해야 합니다.',
      })
    }
  })

export const versionSchema = versionInputSchema

export const revisionInstructionSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(containsNonWhitespace, '수정 지시에 공백 외의 내용을 입력해 주세요.')

export const currentVersionFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const revisionInputSchema = z.object({
  workspaceId: z.string().uuid(),
  contentId: z.string().uuid(),
  versionId: z.string().uuid(),
  channel: z.enum(['instagram', 'threads']),
  instruction: revisionInstructionSchema,
  inputType: z.enum(['caption', 'hashtags', 'disclosure', 'full']),
  currentVersionFingerprint: currentVersionFingerprintSchema,
  currentCaption: z.string().max(2_200).optional(),
  currentHashtags: hashtagsSchema.optional(),
  currentDisclosure: z.string().max(500).optional(),
})

export type VersionInput = z.infer<typeof versionSchema>
