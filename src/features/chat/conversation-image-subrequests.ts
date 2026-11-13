import { z } from 'zod'
import {
  generateImageBatch,
  type GeneratedImageBatch,
  type GeneratedSlide,
  type ImageSlideRole,
} from './conversation-image-batch'
import type { ConversationImageCount } from './conversation-image-intent'
import type { ContentBrief } from './content-interview'

const responseSchema = z.object({
  data: z.object({
    mediaAssetId: z.string().uuid(),
    altText: z.string().min(1).max(500),
  }).strict(),
}).strict()

type Input = Readonly<{
  workspaceId: string
  prompt: string
  slidePrompts?: readonly string[]
  contentBrief?: ContentBrief
  channel: 'instagram' | 'threads' | 'naver_blog'
  count: ConversationImageCount
  idempotencyKey: string
  origin: string
  cookie: string
  fetcher?: typeof fetch
  createSlideId(position: number): string
  signal?: AbortSignal
  onSlideProgress?(slide: GeneratedSlide): void
}>

function roleLabel(role: ImageSlideRole) {
  if (role === 'cover') return '표지'
  if (role === 'proof') return '근거'
  if (role === 'action') return '행동 유도'
  return '상세'
}

function failedSlide(input: { slideId: string; position: number; role: ImageSlideRole }): GeneratedSlide {
  return Object.freeze({
    id: input.slideId,
    position: input.position,
    role: input.role,
    status: 'failed' as const,
    mediaAssetId: null,
    altText: '',
    retryable: true,
    safeErrorCode: 'IMAGE_RETRYABLE' as const,
  })
}

function briefDirection(brief: ContentBrief | undefined, position: number) {
  if (!brief) return ''
  const sceneRole = brief.imageDirection.sceneRoles[position - 1] ?? brief.imageDirection.sceneRoles.at(-1) ?? ''
  return [
    `콘텐츠 목표: ${brief.goal.value}`,
    `대상 독자와 고민: ${brief.audienceProblem}`,
    `이미지 분위기: ${brief.imageDirection.mood.customText ?? brief.imageDirection.mood.value}`,
    `이미지 구도: ${brief.imageDirection.composition}`,
    `장면 역할: ${sceneRole}`,
    `피할 장면: ${brief.imageDirection.avoid.join(', ')}`,
    ...(brief.imageDirection.templateId ? [`선택 이미지 템플릿: ${brief.imageDirection.templateId}`] : []),
    ...(brief.imageDirection.modelAge ? [`모델 연령: ${brief.imageDirection.modelAge}`] : []),
    ...(brief.imageDirection.framing ? [`인물 범위: ${brief.imageDirection.framing}`] : []),
    ...(brief.imageDirection.pose ? [`포즈: ${brief.imageDirection.pose}`] : []),
    ...(brief.imageDirection.background ? [`배경: ${brief.imageDirection.background}`] : []),
    ...(brief.imageDirection.textOverlay ? [`텍스트 요소: ${brief.imageDirection.textOverlay}`] : []),
    ...(brief.imageDirection.extraDirection ? [`추가 이미지 요청: ${brief.imageDirection.extraDirection}`] : []),
  ].join('\n')
}

export async function generateConversationImageBatchViaSubrequests(
  input: Input,
): Promise<GeneratedImageBatch> {
  const fetcher = input.fetcher ?? fetch
  return generateImageBatch({
    count: input.count,
    prompt: input.prompt,
    ...(input.slidePrompts ? { slidePrompts: input.slidePrompts } : {}),
    idempotencyKey: input.idempotencyKey,
    createSlideId: input.createSlideId,
    ...(input.signal ? { signal: input.signal } : {}),
    generate: async ({ prompt, position, role, slideId, signal }) => {
      const response = await fetcher(
        new URL(`/api/workspaces/${input.workspaceId}/conversation-image-slide`, input.origin),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: input.cookie,
          },
          body: JSON.stringify({
            prompt: [
              prompt,
              briefDirection(input.contentBrief, position),
              `캐러셀 ${position}번 ${roleLabel(role)} 이미지로 구성하세요.`,
            ].filter(Boolean).join('\n'),
            channel: input.channel,
            position,
            ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
          }),
          ...(signal ? { signal } : {}),
        },
      )
      const payload = response.ok ? responseSchema.safeParse(await response.json()) : null
      if (!payload?.success) {
        input.onSlideProgress?.(failedSlide({ slideId, position, role }))
        const error = new Error('IMAGE_RETRYABLE') as Error & { code: 'IMAGE_RETRYABLE' }
        error.code = 'IMAGE_RETRYABLE'
        throw error
      }
      const slide: GeneratedSlide = Object.freeze({
        id: slideId,
        position,
        role,
        status: 'succeeded',
        mediaAssetId: payload.data.data.mediaAssetId,
        altText: payload.data.data.altText,
        retryable: false,
        safeErrorCode: null,
      })
      input.onSlideProgress?.(slide)
      return payload.data.data
    },
  })
}
