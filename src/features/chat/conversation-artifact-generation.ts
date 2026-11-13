import type { ApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import { checkApprovedNaverDraft } from '@/features/channel-studio/naver/approved-draft-qa'
import { findPlaceholdersInVersion, isInformationRequest } from '@/features/content/placeholder-detect'
import { dedupeDraft } from '@/features/content/caption-dedupe'
import type { InstagramGenerationContext } from '@/features/auth/workspace-context'
import type {
  ArtifactReferenceResult,
  PersistConversationArtifactRetryInput,
} from './conversation-artifact-repository'
import type { GeneratedImageBatch, GeneratedSlide } from './conversation-image-batch'
import type { ConversationImageRequest } from './conversation-image-intent'
import type { InstagramDraft } from './instagram-draft-provider'
import type { NaverBlogDraft } from './naver-blog-draft-provider'
import { createNaverBlogImagePrompts } from './naver-blog-image-brief'
import type { ConversationArtifact } from './types'
import type { ContentBrief } from './content-interview'
import type { UsageEventInput } from '@/features/credits/usage-event'
import { blogStrategyBriefSchema, buildBlogStrategyBrief, type BlogStrategyBrief, type BlogStrategyScope } from '@/features/content/blog-strategy-brief'

/** 서버가 실제로 확인한 수치만 담는다. 자유 문장은 허용하지 않는다. */
export type TaskPhaseDetail = Readonly<{ sampleSize?: number; coverage?: Readonly<{ covered: number; total: number }> }>

export const STRICTER_FACTS_INSTRUCTION =
  '점주에게 추가 정보를 묻거나 확인을 요청하는 안내 문구를 절대로 작성하지 마세요. 이는 고객에게 노출되는 SNS 게시물이므로 매장 소개 중심의 티저 게시글 본문만 작성하고, 확정되지 않은 항목은 [이벤트 기간]과 같은 대괄호 슬롯으로 남기세요.'

function isDraftInformationRequest(draft: InstagramDraft | NaverBlogDraft): boolean {
  if ('caption' in draft) {
    if (isInformationRequest(draft.caption)) return true
    const placeholders = findPlaceholdersInVersion({ caption: draft.caption, hashtags: draft.hashtags })
    return placeholders.some((p) => p.includes('정보 요청'))
  }
  const naver = draft as NaverBlogDraft
  const naverText = [naver.introduction, ...naver.sections.flatMap((s) => [s.heading, s.body])].join('\n\n')
  return isInformationRequest(naverText)
}

export type ConversationArtifactWorkflowInput = Readonly<{
  workspaceId: string
  userId: string
  sourceMessageId: string
  assistantMessageId: string
  idempotencyKey: string
  prompt: string
  channel: Extract<ConversationImageRequest['channel'], 'instagram' | 'threads' | 'naver_blog'>
  count: ConversationImageRequest['count']
  generationMode?: 'api_only' | 'existing_media'
  attachmentIds?: readonly string[]
  imageSubrequest?: Readonly<{ origin: string; cookie: string }>
  onSlideProgress?(slide: GeneratedSlide): void
  onTaskPhase?(phase: 'facts' | 'draft' | 'images' | 'save', state: 'started' | 'completed' | 'incomplete', detail?: TaskPhaseDetail): Promise<void>
  reference?: Extract<ArtifactReferenceResult, { ok: true }>
  contentBrief?: ContentBrief
  marketingStrategy?: Readonly<{ brief: unknown; datasetMode: BlogStrategyScope['datasetMode']; lineage: BlogStrategyScope['lineage'] }>
  referenceMediaIds?: readonly string[]
  signal?: AbortSignal
  onUsage?(usage: UsageEventInput): void
}>

export type ConversationArtifactWorkflowDependencies = Readonly<{
  loadApprovedFacts?(workspaceId: string): Promise<ApprovedFactSnapshot>
  findExisting(input: {
    workspaceId: string
    sourceMessageId: string
    idempotencyKey: string
  }): Promise<ConversationArtifact | null>
  loadContext(input: {
    workspaceId: string
    channel: Extract<ConversationImageRequest['channel'], 'instagram' | 'threads' | 'naver_blog'>
  }): Promise<InstagramGenerationContext>
  generateDraft(input: {
    prompt: string
    context: InstagramGenerationContext
    channel: Extract<ConversationImageRequest['channel'], 'instagram' | 'threads' | 'naver_blog'>
    imageCount: ConversationImageRequest['count']
    blogStrategyBrief?: BlogStrategyBrief
    approvedFacts?: readonly Readonly<{ category: string; content: string }>[]
    attachmentIds: readonly string[]
    contentBrief?: ContentBrief
    referenceMediaIds?: readonly string[]
    stricterInstruction?: string
    signal?: AbortSignal
    onUsage?(usage: UsageEventInput): void
  }): Promise<InstagramDraft | NaverBlogDraft>
  generateBatch(input: {
    workspaceId: string
    userId: string
    prompt: string
    channel: ConversationImageRequest['channel']
    count: ConversationImageRequest['count']
    idempotencyKey: string
    attachmentIds: readonly string[]
    generationMode?: 'api_only' | 'existing_media'
    contentBrief?: ContentBrief
    referenceMediaIds?: readonly string[]
    slidePrompts?: readonly string[]
    imageSubrequest?: Readonly<{ origin: string; cookie: string }>
    onSlideProgress?(slide: GeneratedSlide): void
    signal?: AbortSignal
    onUsage?(usage: UsageEventInput): void
  }): Promise<GeneratedImageBatch>
  regenerateSlide(input: {
    workspaceId: string
    userId: string
    prompt: string
    channel: ConversationImageRequest['channel']
    artifact: ConversationArtifact
    selectedSlideId: string
    idempotencyKey: string
    signal?: AbortSignal
    onUsage?(usage: UsageEventInput): void
  }): Promise<GeneratedImageBatch>
  persistFresh(input: {
    workspaceId: string
    userId: string
    sourceMessageId: string
    assistantMessageId: string
    artifactId: string
    batchId: string
    idempotencyKey: string
    channel: Extract<ConversationImageRequest['channel'], 'instagram' | 'threads' | 'naver_blog'>
    draft: InstagramDraft | NaverBlogDraft
    batch: GeneratedImageBatch
    generationMode?: 'api_only' | 'existing_media'
  }): Promise<ConversationArtifact>
  persistRetry(input: PersistConversationArtifactRetryInput): Promise<ConversationArtifact>
  createId(): string
}>

export async function createConversationArtifactWorkflow(
  input: ConversationArtifactWorkflowInput,
  dependencies: ConversationArtifactWorkflowDependencies,
): Promise<ConversationArtifact> {
  if (!Number.isInteger(input.count) || input.count < 1
    || input.count > (input.channel === 'naver_blog' ? 20 : 3)) {
    throw new Error('CONVERSATION_IMAGE_COUNT_INVALID')
  }
  if (input.reference && input.generationMode === 'existing_media') {
    throw new Error('CONVERSATION_ORIGINAL_MEDIA_SELECTION_CONFLICT')
  }
  if (input.marketingStrategy && (input.channel !== 'naver_blog' || input.reference)) {
    throw new Error('BLOG_STRATEGY_UNSUPPORTED_OPERATION')
  }
  const blogStrategyBrief = input.marketingStrategy ? buildBlogStrategyBrief(input.marketingStrategy.brief, {
    workspaceId: input.workspaceId,
    datasetMode: input.marketingStrategy.datasetMode,
    lineage: input.marketingStrategy.lineage,
  }) : undefined
  const existing = await dependencies.findExisting({
    workspaceId: input.workspaceId,
    sourceMessageId: input.sourceMessageId,
    idempotencyKey: input.idempotencyKey,
  })
  if (existing) {
    if (blogStrategyBrief) {
      const stored = blogStrategyBriefSchema.safeParse(existing.naverBlog?.strategyBrief)
      if (!stored.success || JSON.stringify(stored.data) !== JSON.stringify(blogStrategyBrief)) {
        throw new Error('BLOG_STRATEGY_REQUEST_CONFLICT')
      }
    }
    return existing
  }

  if (input.reference) {
    const batch = await dependencies.regenerateSlide({
      workspaceId: input.workspaceId,
      userId: input.userId,
      prompt: input.prompt,
      channel: input.channel,
      artifact: input.reference.artifact,
      selectedSlideId: input.reference.slide.id,
      idempotencyKey: input.idempotencyKey,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onUsage ? { onUsage: input.onUsage } : {}),
    })
    return dependencies.persistRetry({
      workspaceId: input.workspaceId,
      assistantMessageId: input.assistantMessageId,
      artifact: input.reference.artifact,
      selectedSlideId: input.reference.slide.id,
      batchId: dependencies.createId(),
      idempotencyKey: input.idempotencyKey,
      batch,
    })
  }

  await input.onTaskPhase?.('facts', 'started')
  const context = await dependencies.loadContext({ workspaceId: input.workspaceId, channel: input.channel })
  const approvedFacts = input.channel === 'naver_blog'
    ? await (async () => {
      try {
        if (!dependencies.loadApprovedFacts) throw new Error('NAVER_FACTS_UNAVAILABLE')
        const snapshot = await dependencies.loadApprovedFacts(input.workspaceId)
        if (snapshot.workspaceId !== input.workspaceId || snapshot.facts.some((fact) => fact.workspace_id !== input.workspaceId)) {
          throw new Error('NAVER_FACTS_UNAVAILABLE')
        }
        return snapshot
      } catch {
        throw new Error('NAVER_FACTS_UNAVAILABLE')
      }
    })()
    : null
  await input.onTaskPhase?.('facts', 'completed', approvedFacts ? { sampleSize: approvedFacts.facts.length } : undefined)
  await input.onTaskPhase?.('draft', 'started')
  const draftGenerationInput = {
    prompt: input.prompt,
    context,
    channel: input.channel,
    imageCount: input.count,
    ...(blogStrategyBrief ? { blogStrategyBrief } : {}),
    ...(approvedFacts ? { approvedFacts: approvedFacts.facts.map(({ category, content }) => ({ category, content })) } : {}),
    attachmentIds: input.attachmentIds ?? [],
    ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
    ...(input.referenceMediaIds ? { referenceMediaIds: input.referenceMediaIds } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onUsage ? { onUsage: input.onUsage } : {}),
  }
  let generatedDraft = await dependencies.generateDraft(draftGenerationInput)

  if (isDraftInformationRequest(generatedDraft)) {
    const retriedDraft = await dependencies.generateDraft({
      ...draftGenerationInput,
      stricterInstruction: STRICTER_FACTS_INSTRUCTION,
      prompt: `${input.prompt}\n\n[추가 지시: ${STRICTER_FACTS_INSTRUCTION}]`,
      contentBrief: input.contentBrief ? {
        ...input.contentBrief,
        mustInclude: [...input.contentBrief.mustInclude, STRICTER_FACTS_INSTRUCTION],
      } : undefined,
    })

    if (isDraftInformationRequest(retriedDraft)) {
      generatedDraft = Object.freeze({
        ...retriedDraft,
        needs_facts: true,
      })
    } else {
      generatedDraft = retriedDraft
    }
  }

  const ownerFacts = [
    input.prompt,
    ...(approvedFacts?.facts.map((fact) => fact.content) ?? []),
    ...(input.contentBrief?.mustInclude ?? []),
  ]
  const dedupedDraft = dedupeDraft(generatedDraft, { ownerFacts })

  let checkedDraft = dedupedDraft
  if (approvedFacts) {
    const naver = dedupedDraft as NaverBlogDraft
    const qa = checkApprovedNaverDraft(input.workspaceId, {
      title: naver.title, introduction: naver.introduction, sections: naver.sections,
      editorBlueprint: naver.editorBlueprint, keywords: naver.keywords, cta: naver.cta, disclosure: naver.disclosure,
    }, approvedFacts)
    if (qa.status !== 'OK') throw new Error('NAVER_CLAIMS_NEED_REVIEW')
    checkedDraft = { ...naver, factBasis: { workspaceId: input.workspaceId, snapshotHash: qa.snapshotHash, resolvedAt: qa.resolvedAt, sources: qa.sources, provenance: qa.provenance } }
  }
  if (input.generationMode === 'existing_media' && input.attachmentIds?.length) {
    checkedDraft = { ...checkedDraft, disclosure: '사용 권리가 확인된 첨부 이미지와 AI가 작성한 문안입니다. 게시 전 내용을 확인해 주세요.' }
  }
  // 모델 출력이 전략의 출처·버전을 덮어쓸 수 없도록 서버에서 붙인다.
  const draft = blogStrategyBrief
    ? Object.freeze({ ...checkedDraft, strategyBrief: blogStrategyBrief })
    : checkedDraft
  await input.onTaskPhase?.('draft', 'completed')
  await input.onTaskPhase?.('images', 'started')
  const batch = await dependencies.generateBatch({
    workspaceId: input.workspaceId,
    userId: input.userId,
    prompt: input.prompt,
    channel: input.channel,
    count: input.count,
    idempotencyKey: input.idempotencyKey,
    attachmentIds: input.attachmentIds ?? [],
    ...(input.generationMode ? { generationMode: input.generationMode } : {}),
    ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
    ...(input.referenceMediaIds ? { referenceMediaIds: input.referenceMediaIds } : {}),
    ...(input.channel === 'naver_blog' ? {
      slidePrompts: createNaverBlogImagePrompts({
        draft: draft as NaverBlogDraft,
        count: input.count,
        userPrompt: input.prompt,
        ...(input.contentBrief ? { contentBrief: input.contentBrief } : {}),
      }),
    } : {}),
    ...(input.imageSubrequest ? { imageSubrequest: input.imageSubrequest } : {}),
    ...(input.onSlideProgress ? { onSlideProgress: input.onSlideProgress } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onUsage ? { onUsage: input.onUsage } : {}),
  })
  if (batch.status === 'failed') {
    const code = batch.slides.find(slide => slide.status === 'failed')?.safeErrorCode ?? 'IMAGE_PROVIDER_UNAVAILABLE'
    throw Object.assign(new Error(code), { code })
  }
  if (input.generationMode === 'existing_media' && input.attachmentIds?.length
    && (batch.requestedCount !== input.attachmentIds.length || batch.slides.length !== input.attachmentIds.length
      || batch.slides.some((slide, index) => slide.status !== 'succeeded' || slide.mediaAssetId !== input.attachmentIds![index]))) {
    throw new Error('CONVERSATION_ORIGINAL_MEDIA_MISMATCH')
  }
  const imageCoverage = { coverage: { covered: batch.succeededCount, total: batch.requestedCount } }
  if (batch.status === 'ready_for_review') await input.onTaskPhase?.('images', 'completed', imageCoverage)
  else if (batch.status === 'partial') await input.onTaskPhase?.('images', 'incomplete', imageCoverage)
  if (approvedFacts) {
    const current = await dependencies.loadApprovedFacts!(input.workspaceId).catch(() => {
      throw new Error('NAVER_FACTS_UNAVAILABLE')
    })
    if (current.workspaceId !== approvedFacts.workspaceId || current.hash !== approvedFacts.hash) {
      throw new Error('FACT_SNAPSHOT_STALE')
    }
  }
  await input.onTaskPhase?.('save', 'started')
  const persisted = await dependencies.persistFresh({
    workspaceId: input.workspaceId,
    userId: input.userId,
    sourceMessageId: input.sourceMessageId,
    assistantMessageId: input.assistantMessageId,
    artifactId: dependencies.createId(),
    batchId: dependencies.createId(),
    idempotencyKey: input.idempotencyKey,
    channel: input.channel,
    draft,
    batch,
    ...(input.generationMode ? { generationMode: input.generationMode } : {}),
  })
  await input.onTaskPhase?.('save', 'completed')
  return persisted
}
