import type { WorkspaceRole } from '@/features/auth/workspace-context'
import {
  composeByreumImagePrompt,
  type ByreumImageChannel,
} from '@/features/harness/byreum-image-harness'
import type { WorkspaceImageStyle } from '@/features/image-style/workspace-image-style'
import { composeNeutralImagePrompt } from '@/features/harness/neutral-image-prompt'
import type { ImageGenerationResult } from '@/lib/providers/image-provider'
import {
  generateImageBatch,
  type GeneratedImageBatch,
  type ImageSlideRole,
} from './conversation-image-batch'
import type { ImageMessageArtifact } from './stream-events'
import type { ConversationImageCount } from './conversation-image-intent'
import type { ContentBrief } from './content-interview'
import type { UsageEventInput } from '@/features/credits/usage-event'

type ContentCreationRole = Extract<WorkspaceRole, 'owner' | 'manager'>

export type ConversationImageGenerationInput = Readonly<{
  workspaceId: string
  userId: string
  prompt: string
  channel: ByreumImageChannel
  contentBrief?: ContentBrief
  onUsage?(usage: UsageEventInput): void
  allowNeutralFallback?: boolean
  /** 저장 전 시안용. 지정하면 전용 하네스와 저장된 스타일 대신 이 스타일로 만든다. */
  workspaceStyleOverride?: WorkspaceImageStyle
  neutralContext?: Readonly<{
    altText?: string | null
    sectionText?: string | null
    industry?: string | null
    tone?: string | null
  }>
}>

export type ConversationImageGenerationDependencies = Readonly<{
  authorize(input: Pick<ConversationImageGenerationInput, 'workspaceId' | 'userId'>): Promise<{
    email: string | null
    role: ContentCreationRole
  } | null>
  loadHarness(input: Pick<ConversationImageGenerationInput, 'workspaceId' | 'channel'>): Promise<unknown | null>
  /** 사장님이 등록한 이미지 스타일. 전용 하네스가 없을 때만 조회해 중립 프롬프트에 반영한다. */
  loadWorkspaceStyle?(workspaceId: string): Promise<WorkspaceImageStyle | null>
  generate(input: {
    prompt: string
    size: '1024x1536'
    /** 스타일 참고 사진. 서버 구현이 이 작업공간의 사진을 읽어 이미지 모델에 붙인다. */
    workspaceId?: string
    referenceAssetIds?: readonly string[]
  }): Promise<ImageGenerationResult>
  store(input: {
    workspaceId: string
    userId: string
    role: ContentCreationRole
    bytes: Uint8Array
    mimeType: 'image/png'
  }): Promise<{ assetId: string }>
}>

export type ConversationImageBatchGenerationInput = ConversationImageGenerationInput & Readonly<{
  count: ConversationImageCount
  idempotencyKey: string
  slidePrompts?: readonly string[]
  signal?: AbortSignal
}>

export type ConversationImageBatchGenerationDependencies =
  ConversationImageGenerationDependencies & Readonly<{
    createSlideId(position: number): string
    loadExisting?(idempotencyKey: string): Promise<GeneratedImageBatch | null>
  }>

const channelLabels: Record<ByreumImageChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
}

const roleLabels: Record<ImageSlideRole, string> = {
  cover: '표지',
  detail: '상세',
  proof: '근거',
  action: '행동 유도',
}

/** 인터뷰에서 고른 기준 사진만 쓰고(순서는 스타일의 순서 유지), 고른 게 없거나 겹치는 게 없으면 등록한 기준 사진 전체를 쓴다. */
export function selectReferenceIds(styleIds: readonly string[], chosen: readonly string[] | undefined): string[] {
  const all = styleIds.slice(0, 8)
  if (!chosen || chosen.length === 0) return all
  const picked = all.filter((id) => chosen.includes(id))
  return picked.length > 0 ? picked : all
}

function withSelectedReferences(
  style: WorkspaceImageStyle | null,
  chosen: readonly string[] | undefined,
): WorkspaceImageStyle | null {
  if (!style) return null
  return { ...style, referenceAssetIds: selectReferenceIds(style.referenceAssetIds, chosen) }
}

export async function generateConversationImageArtifact(
  input: ConversationImageGenerationInput,
  dependencies: ConversationImageGenerationDependencies,
): Promise<ImageMessageArtifact> {
  const access = await dependencies.authorize({
    workspaceId: input.workspaceId,
    userId: input.userId,
  })
  if (access === null) throw new Error('CHAT_IMAGE_FORBIDDEN')

  const harness = input.workspaceStyleOverride ? null : await dependencies.loadHarness({
    workspaceId: input.workspaceId,
    channel: input.channel,
  })
  if (harness === null && !input.allowNeutralFallback && !input.workspaceStyleOverride) {
    throw new Error('CHAT_IMAGE_HARNESS_UNAVAILABLE')
  }
  const workspaceStyle = withSelectedReferences(
    input.workspaceStyleOverride
      ?? (harness === null && dependencies.loadWorkspaceStyle
        ? await dependencies.loadWorkspaceStyle(input.workspaceId).catch(() => null)
        : null),
    input.contentBrief?.imageDirection.styleReferenceIds,
  )

  const prompt = harness !== null
    ? composeByreumImagePrompt({
        harness,
        channel: input.channel,
        userPrompt: input.prompt,
        ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
      })
    : composeNeutralImagePrompt({
        channel: input.channel,
        userPrompt: input.prompt,
        altText: input.neutralContext?.altText,
        sectionText: input.neutralContext?.sectionText,
        industry: input.neutralContext?.industry,
        tone: input.neutralContext?.tone,
        workspaceStyle,
        ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
      })

  const generated = await dependencies.generate({
    prompt,
    size: '1024x1536',
    workspaceId: input.workspaceId,
    referenceAssetIds: workspaceStyle?.referenceAssetIds ?? [],
  })
  if (generated.usage) input.onUsage?.(generated.usage)
  const stored = await dependencies.store({
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: access.role,
    bytes: generated.bytes,
    mimeType: generated.mimeType,
  })
  const href = `/api/workspaces/${input.workspaceId}/media/${stored.assetId}`

  return Object.freeze({
    id: stored.assetId,
    kind: 'image_draft' as const,
    title: harness !== null
      ? `바이름 ${channelLabels[input.channel]} 이미지 초안`
      : `${channelLabels[input.channel]} 이미지 초안`,
    href,
    previewUrl: href,
    statusLabel: '승인 대기' as const,
    requiresConfirmation: true as const,
  })
}

export async function generateConversationImageBatchArtifacts(
  input: ConversationImageBatchGenerationInput,
  dependencies: ConversationImageBatchGenerationDependencies,
): Promise<GeneratedImageBatch> {
  const access = await dependencies.authorize({
    workspaceId: input.workspaceId,
    userId: input.userId,
  })
  if (access === null) throw new Error('CHAT_IMAGE_FORBIDDEN')

  const harness = input.workspaceStyleOverride ? null : await dependencies.loadHarness({
    workspaceId: input.workspaceId,
    channel: input.channel,
  })
  if (harness === null && !input.allowNeutralFallback && !input.workspaceStyleOverride) {
    throw new Error('CHAT_IMAGE_HARNESS_UNAVAILABLE')
  }
  const workspaceStyle = withSelectedReferences(
    input.workspaceStyleOverride
      ?? (harness === null && dependencies.loadWorkspaceStyle
        ? await dependencies.loadWorkspaceStyle(input.workspaceId).catch(() => null)
        : null),
    input.contentBrief?.imageDirection.styleReferenceIds,
  )

  return generateImageBatch({
    count: input.count,
    prompt: input.prompt,
    ...(input.slidePrompts ? { slidePrompts: input.slidePrompts } : {}),
    idempotencyKey: input.idempotencyKey,
    createSlideId: dependencies.createSlideId,
    generate: async ({ prompt, position, role }) => {
      const generatedPrompt = harness !== null
        ? composeByreumImagePrompt({
            harness,
            channel: input.channel,
            userPrompt: [
              prompt,
              `캐러셀 ${position}번 ${roleLabels[role]} 이미지로 구성하세요.`,
            ].join('\n'),
            ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
          })
        : composeNeutralImagePrompt({
            channel: input.channel,
            userPrompt: [
              prompt,
              `슬라이드 ${position}번 ${roleLabels[role]} 이미지로 구성하세요.`,
            ].join('\n'),
            altText: input.neutralContext?.altText,
            sectionText: input.neutralContext?.sectionText,
            industry: input.neutralContext?.industry,
            tone: input.neutralContext?.tone,
            workspaceStyle,
            ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
          })

      const generated = await dependencies.generate({
        prompt: generatedPrompt,
        size: '1024x1536',
        workspaceId: input.workspaceId,
        referenceAssetIds: workspaceStyle?.referenceAssetIds ?? [],
      })
      if (generated.usage) input.onUsage?.(generated.usage)
      const stored = await dependencies.store({
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: access.role,
        bytes: generated.bytes,
        mimeType: generated.mimeType,
      })
      return Object.freeze({
        mediaAssetId: stored.assetId,
        altText: harness !== null
          ? `바이름 ${channelLabels[input.channel]} ${roleLabels[role]} 이미지 초안`
          : `${channelLabels[input.channel]} ${roleLabels[role]} 이미지 초안`,
      })
    },
    ...(dependencies.loadExisting ? { loadExisting: dependencies.loadExisting } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })
}
