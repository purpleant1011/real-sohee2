import { z } from 'zod'
import { blogStrategyBriefSchema } from '@/features/content/blog-strategy-brief'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { DEFAULT_AI_DISCLOSURE } from '@/features/publishing/meta-content-text'
import type { Database } from '@/lib/supabase/database.types'
import type { GeneratedImageBatch } from './conversation-image-batch'
import type { InstagramDraft } from './instagram-draft-provider'
import { approvedFactBasisSchema } from '@/features/content/approved-fact-basis'
import { assertProvenanceSourceIntegrity } from '@/features/content/approved-fact-source-integrity'
import type { NaverBlogDraft } from './naver-blog-draft-provider'
import type {
  ConversationArtifact,
  ConversationArtifactSlide,
} from './types'

type ArtifactInsert = Database['public']['Tables']['conversation_artifacts']['Insert']
type BatchInsert = Database['public']['Tables']['generation_batches']['Insert']
type SlideInsert = Database['public']['Tables']['artifact_slides']['Insert']
type MessageArtifactInsert = Database['public']['Tables']['message_artifacts']['Insert']
type ProviderResult = Readonly<{ error: unknown }>

const uuidSchema = z.string().uuid()

export type ConversationArtifactGateway = Readonly<{
  findByRequest(input: {
    workspaceId: string
    sourceMessageId: string
    idempotencyKey: string
  }): Promise<ConversationArtifact | null>
  insertArtifact(row: ArtifactInsert): Promise<ProviderResult>
  insertBatch(row: BatchInsert): Promise<ProviderResult>
  insertSlides(rows: readonly SlideInsert[]): Promise<ProviderResult>
  linkMessage(row: MessageArtifactInsert): Promise<ProviderResult>
  updateArtifactStatus(input: {
    workspaceId: string
    artifactId: string
    status: ConversationArtifact['status']
  }): Promise<ProviderResult>
  updateSlide(input: {
    workspaceId: string
    artifactId: string
    slideId: string
    batchId: string
    status: ConversationArtifactSlide['status']
    mediaAssetId: string | null
    altText: string
    retryable: boolean
    safeErrorCode: ConversationArtifactSlide['safeErrorCode']
  }): Promise<ProviderResult>
  removeArtifact(input: { workspaceId: string; artifactId: string }): Promise<unknown>
  removeBatch(input: { workspaceId: string; batchId: string }): Promise<unknown>
  messageBelongsToThread(input: {
    workspaceId: string
    threadId: string
    messageId: string
  }): Promise<boolean>
  listArtifactIdsForMessage(input: {
    workspaceId: string
    messageId: string
  }): Promise<Readonly<{ data: readonly string[] | null; error: unknown }>>
  listForMessages(input: {
    workspaceId: string
    messageIds: readonly string[]
  }): Promise<Readonly<{
    data: readonly Readonly<{
      messageId: string
      artifact: ConversationArtifact
    }>[] | null
    error: unknown
  }>>
  getById(input: { workspaceId: string; artifactId: string }): Promise<ConversationArtifact | null>
}>

type PersistConversationArtifactInput = Readonly<{
  workspaceId: string
  userId: string
  sourceMessageId: string
  assistantMessageId: string
  artifactId: string
  batchId: string
  idempotencyKey: string
  channel: 'instagram' | 'threads' | 'naver_blog'
  draft: InstagramDraft | NaverBlogDraft
  batch: GeneratedImageBatch
  generationMode?: 'api_only' | 'existing_media'
}>

const apiOnlyGeneration = Object.freeze({
  mode: 'api_only' as const,
  text: 'openai_responses_api' as const,
  images: 'openai_images_api' as const,
})

export type ArtifactReferenceResult =
  | Readonly<{
      ok: true
      artifact: ConversationArtifact
      slide: ConversationArtifactSlide
    }>
  | Readonly<{
      ok: false
      reason: 'not_found' | 'archived' | 'missing_slide' | 'failed_slide' | 'unavailable_slide' | 'slide_not_retryable'
    }>

function artifactStatus(batch: GeneratedImageBatch): ConversationArtifact['status'] {
  if (batch.status === 'ready_for_review') return 'ready_for_review'
  if (batch.status === 'partial') return 'partial'
  return 'failed'
}

function persistedBatchStatus(batch: GeneratedImageBatch): BatchInsert['status'] {
  if (batch.status === 'ready_for_review') return 'succeeded'
  if (batch.slides.some((slide) => slide.status === 'cancelled')) return 'cancelled'
  return batch.status
}

function normalizeArtifact(artifact: ConversationArtifact): ConversationArtifact {
  return Object.freeze({
    ...artifact,
    hashtags: Object.freeze([...artifact.hashtags]),
    naverBlog: artifact.naverBlog ? Object.freeze({
      ...artifact.naverBlog,
      sections: Object.freeze(artifact.naverBlog.sections.map((section) => Object.freeze({ ...section }))),
      editorBlueprint: Object.freeze((artifact.naverBlog.editorBlueprint ?? []).map((block) => Object.freeze({ ...block }))),
      keywords: Object.freeze([...artifact.naverBlog.keywords]),
    }) : null,
    observations: Object.freeze([...artifact.observations]),
    limitations: Object.freeze([...artifact.limitations]),
    evidence: Object.freeze([...artifact.evidence]),
    unresolvedQuestions: Object.freeze([...artifact.unresolvedQuestions]),
    ...(artifact.needs_facts ? { needs_facts: true } : {}),
    slides: Object.freeze([...artifact.slides]
      .sort((left, right) => left.position - right.position)
      .map((slide) => Object.freeze({ ...slide }))),
  })
}

function artifactFromInput(input: PersistConversationArtifactInput): ConversationArtifact {
  if (input.channel === 'naver_blog') {
    const draft = input.draft as NaverBlogDraft
    return normalizeArtifact({
      id: input.artifactId,
      workspaceId: input.workspaceId,
      sourceMessageId: input.sourceMessageId,
      type: 'naver_blog_post',
      status: artifactStatus(input.batch),
      title: draft.title,
      caption: [draft.introduction, ...draft.sections.flatMap((section) => [section.heading, section.body])].join('\n\n'),
      hashtags: draft.keywords.map((keyword) => `#${keyword.replace(/^#+/u, '').replace(/\s+/gu, '')}`),
      cta: draft.cta,
      disclosure: draft.disclosure,
      observations: draft.observations,
      limitations: draft.limitations,
      evidence: draft.evidence,
      unresolvedQuestions: draft.unresolvedQuestions,
      idempotencyKey: input.idempotencyKey,
      naverBlog: {
        introduction: draft.introduction,
        sections: draft.sections,
        editorBlueprint: draft.editorBlueprint,
        keywords: draft.keywords,
        visibility: draft.visibility,
        ...(draft.strategyBrief ? { strategyBrief: blogStrategyBriefSchema.parse(draft.strategyBrief) } : {}),
        ...(draft.factBasis ? { factBasis: parseFactBasis(draft.factBasis) } : {}),
        ...(input.generationMode === 'api_only' ? { generation: apiOnlyGeneration } : {}),
      },
      slides: input.batch.slides,
    })
  }
  const draft = input.draft as InstagramDraft
  return normalizeArtifact({
    id: input.artifactId,
    workspaceId: input.workspaceId,
    sourceMessageId: input.sourceMessageId,
    type: input.channel === 'threads' ? 'threads_post' : 'instagram_post',
    status: artifactStatus(input.batch),
    caption: draft.caption,
    hashtags: draft.hashtags,
    cta: draft.cta,
    disclosure: draft.disclosure.trim() || DEFAULT_AI_DISCLOSURE,
    observations: draft.observations,
    limitations: draft.limitations,
    evidence: draft.evidence,
    unresolvedQuestions: draft.unresolvedQuestions,
    idempotencyKey: input.idempotencyKey,
    slides: input.batch.slides,
    ...(draft.needs_facts ? { needs_facts: true } : {}),
  })
}

export async function persistConversationArtifact(
  input: PersistConversationArtifactInput,
  gateway: ConversationArtifactGateway,
): Promise<ConversationArtifact> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const sourceMessageId = uuidSchema.parse(input.sourceMessageId)
  const assistantMessageId = uuidSchema.parse(input.assistantMessageId)
  const userId = uuidSchema.parse(input.userId)
  const artifactId = uuidSchema.parse(input.artifactId)
  const batchId = uuidSchema.parse(input.batchId)
  const idempotencyKey = uuidSchema.parse(input.idempotencyKey)
  const artifact = artifactFromInput(input)
  if (artifact.naverBlog?.factBasis && artifact.naverBlog.factBasis.workspaceId !== workspaceId) {
    throw new Error('FACT_WORKSPACE_MISMATCH')
  }
  if (artifact.naverBlog?.strategyBrief && artifact.naverBlog.strategyBrief.workspaceId !== workspaceId) {
    throw new Error('BLOG_STRATEGY_SCOPE_MISMATCH')
  }
  const existing = await gateway.findByRequest({ workspaceId, sourceMessageId, idempotencyKey })
  if (existing) return existing
  const now = new Date().toISOString()
  const batchStatus = persistedBatchStatus(input.batch)
  const safeErrorCode = input.batch.slides.find((slide) => slide.safeErrorCode)?.safeErrorCode ?? null

  try {
    const createdArtifact = await gateway.insertArtifact({
      id: artifactId,
      workspace_id: workspaceId,
      source_message_id: sourceMessageId,
      created_by_user_id: userId,
      type: artifact.type,
      title: artifact.title ?? '',
      structured_payload: artifact.naverBlog ? {
        channel: 'naver_blog',
        title: artifact.title ?? '',
        introduction: artifact.naverBlog.introduction,
        sections: artifact.naverBlog.sections.map((section) => ({ ...section })),
        editorBlueprint: (artifact.naverBlog.editorBlueprint ?? []).map((block) => ({ ...block })),
        keywords: [...artifact.naverBlog.keywords],
        cta: artifact.cta,
        visibility: artifact.naverBlog.visibility,
        ...(artifact.naverBlog.generation ? { generation: artifact.naverBlog.generation } : {}),
        ...(artifact.naverBlog.factBasis ? { factBasis: artifact.naverBlog.factBasis } : {}),
        ...(artifact.naverBlog.strategyBrief ? { strategyBrief: JSON.parse(JSON.stringify(artifact.naverBlog.strategyBrief)) } : {}),
      } : {},
      status: artifact.status,
      caption: artifact.caption,
      hashtags: [...artifact.hashtags],
      cta: artifact.cta,
      disclosure: artifact.disclosure,
      observations: [...artifact.observations],
      limitations: [...artifact.limitations],
      evidence: [...artifact.evidence],
      unresolved_questions: [...artifact.unresolvedQuestions],
      idempotency_key: idempotencyKey,
    })
    if (createdArtifact.error) throw new Error('artifact_insert_failed')

    const createdBatch = await gateway.insertBatch({
      id: batchId,
      workspace_id: workspaceId,
      artifact_id: artifactId,
      idempotency_key: idempotencyKey,
      requested_count: input.batch.requestedCount,
      started_count: input.batch.startedCount,
      succeeded_count: input.batch.succeededCount,
      failed_count: input.batch.failedCount,
      status: batchStatus,
      safe_error_code: safeErrorCode,
      started_at: now,
      completed_at: now,
    })
    if (createdBatch.error) throw new Error('batch_insert_failed')

    const createdSlides = await gateway.insertSlides(input.batch.slides.map((slide) => ({
      id: uuidSchema.parse(slide.id),
      workspace_id: workspaceId,
      artifact_id: artifactId,
      batch_id: batchId,
      position: slide.position,
      role: slide.role,
      status: slide.status,
      media_asset_id: slide.mediaAssetId,
      alt_text: slide.altText,
      retryable: slide.retryable,
      safe_error_code: slide.safeErrorCode,
      rights_status: slide.status === 'succeeded' ? 'confirmed' : 'pending',
    })))
    if (createdSlides.error) throw new Error('slides_insert_failed')

    const linked = await gateway.linkMessage({
      workspace_id: workspaceId,
      message_id: assistantMessageId,
      artifact_id: artifactId,
    })
    if (linked.error) throw new Error('message_artifact_link_failed')
    return artifact
  } catch {
    await gateway.removeArtifact({ workspaceId, artifactId }).catch(() => undefined)
    throw new Error('conversation_artifact_persist_failed')
  }
}

export async function listConversationArtifactsForMessage(
  input: { workspaceId: string; messageId: string },
  gateway: ConversationArtifactGateway,
): Promise<readonly ConversationArtifact[]> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  const linked = await gateway.listArtifactIdsForMessage({ workspaceId, messageId })
  if (linked.error) throw new Error('conversation_artifact_list_failed')

  const artifacts: ConversationArtifact[] = []
  for (const artifactId of linked.data ?? []) {
    const artifact = await gateway.getById({ workspaceId, artifactId: uuidSchema.parse(artifactId) })
    if (artifact?.workspaceId === workspaceId) artifacts.push(normalizeArtifact(artifact))
  }
  return Object.freeze(artifacts)
}

export async function listConversationArtifactsForMessages(
  input: { workspaceId: string; messageIds: readonly string[] },
  gateway: ConversationArtifactGateway,
): Promise<Readonly<Record<string, readonly ConversationArtifact[]>>> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageIds = Object.freeze([
    ...new Set(z.array(uuidSchema).max(100).parse(input.messageIds)),
  ])
  if (messageIds.length === 0) return Object.freeze({})

  const listed = await gateway.listForMessages({ workspaceId, messageIds })
  if (listed.error) throw new Error('conversation_artifact_list_failed')

  const allowedMessageIds = new Set(messageIds)
  const grouped: Record<string, ConversationArtifact[]> = Object.fromEntries(
    messageIds.map((messageId) => [messageId, []]),
  )
  for (const entry of listed.data ?? []) {
    if (!allowedMessageIds.has(entry.messageId) || entry.artifact.workspaceId !== workspaceId) continue
    grouped[entry.messageId]?.push(normalizeArtifact(entry.artifact))
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(grouped).map(([messageId, artifacts]) => [
      messageId,
      Object.freeze(artifacts),
    ]),
  ))
}

export async function resolveConversationArtifactReference(
  input: { workspaceId: string; threadId: string; replyToMessageId: string; selectedSlideId: string },
  gateway: ConversationArtifactGateway,
): Promise<ArtifactReferenceResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const messageId = uuidSchema.parse(input.replyToMessageId)
  const selectedSlideId = uuidSchema.parse(input.selectedSlideId)
  if (!await gateway.messageBelongsToThread({ workspaceId, threadId, messageId })) {
    return Object.freeze({ ok: false, reason: 'not_found' as const })
  }
  const artifacts = await listConversationArtifactsForMessage({ workspaceId, messageId }, gateway)
  const artifact = artifacts.find((candidate) =>
    candidate.slides.some((slide) => slide.id === selectedSlideId),
  )
  if (!artifact || artifact.workspaceId !== workspaceId) {
    return Object.freeze({ ok: false, reason: 'not_found' as const })
  }
  if (artifact.status === 'archived') {
    return Object.freeze({ ok: false, reason: 'archived' as const })
  }
  const slide = artifact.slides.find((candidate) => candidate.id === selectedSlideId)
  if (!slide) return Object.freeze({ ok: false, reason: 'missing_slide' as const })
  if (slide.status === 'failed') {
    return Object.freeze({ ok: false, reason: 'failed_slide' as const })
  }
  if (slide.status !== 'succeeded') {
    return Object.freeze({ ok: false, reason: 'unavailable_slide' as const })
  }
  return Object.freeze({ ok: true, artifact, slide })
}

export async function resolveConversationArtifactRetryReference(
  input: { workspaceId: string; threadId: string; replyToMessageId: string; retryFailedSlideId: string },
  gateway: ConversationArtifactGateway,
): Promise<ArtifactReferenceResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const messageId = uuidSchema.parse(input.replyToMessageId)
  const retryFailedSlideId = uuidSchema.parse(input.retryFailedSlideId)
  if (!await gateway.messageBelongsToThread({ workspaceId, threadId, messageId })) {
    return Object.freeze({ ok: false, reason: 'not_found' as const })
  }
  const artifacts = await listConversationArtifactsForMessage({ workspaceId, messageId }, gateway)
  const artifact = artifacts.find((candidate) =>
    candidate.slides.some((slide) => slide.id === retryFailedSlideId),
  )
  if (!artifact || artifact.workspaceId !== workspaceId) {
    return Object.freeze({ ok: false, reason: 'not_found' as const })
  }
  if (artifact.status === 'archived') {
    return Object.freeze({ ok: false, reason: 'archived' as const })
  }
  const slide = artifact.slides.find((candidate) => candidate.id === retryFailedSlideId)
  if (!slide) return Object.freeze({ ok: false, reason: 'missing_slide' as const })
  if (slide.status !== 'failed' || !slide.retryable) {
    return Object.freeze({ ok: false, reason: 'slide_not_retryable' as const })
  }
  return Object.freeze({ ok: true, artifact, slide })
}

export type PersistConversationArtifactRetryInput = Readonly<{
    workspaceId: string
    assistantMessageId: string
    artifact: ConversationArtifact
    selectedSlideId: string
    batchId: string
    idempotencyKey: string
    batch: GeneratedImageBatch
  }>

export async function persistConversationArtifactRetry(
  input: PersistConversationArtifactRetryInput,
  gateway: ConversationArtifactGateway,
): Promise<ConversationArtifact> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const assistantMessageId = uuidSchema.parse(input.assistantMessageId)
  const artifactId = uuidSchema.parse(input.artifact.id)
  const selectedSlideId = uuidSchema.parse(input.selectedSlideId)
  const batchId = uuidSchema.parse(input.batchId)
  const idempotencyKey = uuidSchema.parse(input.idempotencyKey)
  if (input.artifact.workspaceId !== workspaceId || input.artifact.status === 'archived') {
    throw new Error('conversation_artifact_retry_forbidden')
  }
  const selected = input.batch.slides.find((slide) => slide.id === selectedSlideId)
  if (!selected) throw new Error('conversation_artifact_retry_slide_missing')

  const succeeded = selected.status === 'succeeded' ? 1 : 0
  const failed = selected.status === 'failed' ? 1 : 0
  const started = selected.status === 'cancelled' ? 0 : 1
  const batchStatus: BatchInsert['status'] = selected.status === 'succeeded'
    ? 'succeeded'
    : selected.status === 'failed'
      ? 'failed'
      : 'cancelled'
  const now = new Date().toISOString()

  try {
    const createdBatch = await gateway.insertBatch({
      id: batchId,
      workspace_id: workspaceId,
      artifact_id: artifactId,
      idempotency_key: idempotencyKey,
      requested_count: 1,
      started_count: started,
      succeeded_count: succeeded,
      failed_count: failed,
      status: batchStatus,
      safe_error_code: selected.safeErrorCode,
      started_at: now,
      completed_at: now,
    })
    if (createdBatch.error) throw new Error('retry_batch_insert_failed')

    const updatedSlide = await gateway.updateSlide({
      workspaceId,
      artifactId,
      slideId: selectedSlideId,
      batchId,
      status: selected.status,
      mediaAssetId: selected.mediaAssetId,
      altText: selected.altText,
      retryable: selected.retryable,
      safeErrorCode: selected.safeErrorCode,
    })
    if (updatedSlide.error) throw new Error('retry_slide_update_failed')

    const status = artifactStatus(input.batch)
    const updatedArtifact = await gateway.updateArtifactStatus({ workspaceId, artifactId, status })
    if (updatedArtifact.error) throw new Error('retry_artifact_update_failed')

    const linked = await gateway.linkMessage({
      workspace_id: workspaceId,
      message_id: assistantMessageId,
      artifact_id: artifactId,
    })
    if (linked.error) throw new Error('retry_message_link_failed')

    return normalizeArtifact({
      ...input.artifact,
      status,
      idempotencyKey,
      slides: input.batch.slides,
    })
  } catch {
    await gateway.removeBatch({ workspaceId, batchId }).catch(() => undefined)
    throw new Error('conversation_artifact_retry_persist_failed')
  }
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? Object.freeze(value.filter((item): item is string => typeof item === 'string'))
    : Object.freeze([])
}

const naverBlogPayloadSchema = z.object({
  channel: z.literal('naver_blog'),
  title: z.string().min(1).max(200),
  introduction: z.string().min(1).max(2_000),
  sections: z.array(z.object({
    heading: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
  }).strict()).min(1).max(20),
  editorBlueprint: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['paragraph', 'heading', 'quote', 'cta']), text: z.string().min(1).max(8_000) }).strict(),
    z.object({ kind: z.literal('image_slot'), position: z.number().int().min(1).max(20), altText: z.string().min(1).max(500) }).strict(),
    z.object({ kind: z.literal('link'), url: z.string().url().max(2_048), title: z.string().min(1).max(300) }).strict(),
  ])).max(80).default([]),
  keywords: z.array(z.string().min(1).max(100)).min(1).max(30),
  cta: z.string().min(1).max(500),
  visibility: z.enum(['private', 'public']),
  strategyBrief: blogStrategyBriefSchema.optional(),
  factBasis: approvedFactBasisSchema.optional(),
  generation: z.object({
    mode: z.literal('api_only'),
    text: z.literal('openai_responses_api'),
    images: z.literal('openai_images_api'),
  }).strict().optional(),
}).strict()

function naverBlogFromPayload(value: unknown): ConversationArtifact['naverBlog'] {
  const parsed = naverBlogPayloadSchema.safeParse(value)
  if (!parsed.success) return null
  return Object.freeze({
    introduction: parsed.data.introduction,
    sections: Object.freeze(parsed.data.sections.map((section) => Object.freeze({ ...section }))),
    editorBlueprint: Object.freeze(parsed.data.editorBlueprint.map((block) => Object.freeze({ ...block }))),
    keywords: Object.freeze([...parsed.data.keywords]),
    visibility: parsed.data.visibility,
    ...(parsed.data.strategyBrief ? { strategyBrief: parsed.data.strategyBrief } : {}),
    ...(parsed.data.factBasis ? { factBasis: parsed.data.factBasis } : {}),
    ...(parsed.data.generation ? { generation: Object.freeze({ ...parsed.data.generation }) } : {}),
  })
}

export function createSupabaseConversationArtifactGateway(
  client: ServerSupabaseClient,
): ConversationArtifactGateway {
  const gateway: ConversationArtifactGateway = {
    async findByRequest({ workspaceId, sourceMessageId, idempotencyKey }) {
      const result = await client.from('conversation_artifacts').select('id')
        .eq('workspace_id', workspaceId)
        .eq('source_message_id', sourceMessageId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (result.error) throw new Error('conversation_artifact_lookup_failed')
      return result.data ? gateway.getById({ workspaceId, artifactId: result.data.id }) : null
    },
    async insertArtifact(row) {
      const { error } = await client.from('conversation_artifacts').insert(row)
      return { error }
    },
    async insertBatch(row) {
      const { error } = await client.from('generation_batches').insert(row)
      return { error }
    },
    async insertSlides(rows) {
      const { error } = await client.from('artifact_slides').insert([...rows])
      return { error }
    },
    async linkMessage(row) {
      const { error } = await client.from('message_artifacts').upsert(row, {
        onConflict: 'message_id,artifact_id',
        ignoreDuplicates: true,
      })
      return { error }
    },
    async updateArtifactStatus({ workspaceId, artifactId, status }) {
      const { error } = await client.from('conversation_artifacts')
        .update({ status })
        .eq('workspace_id', workspaceId)
        .eq('id', artifactId)
      return { error }
    },
    async updateSlide(input) {
      const { error } = await client.from('artifact_slides')
        .update({
          batch_id: input.batchId,
          status: input.status,
          media_asset_id: input.mediaAssetId,
          alt_text: input.altText,
          retryable: input.retryable,
          safe_error_code: input.safeErrorCode,
          rights_status: input.status === 'succeeded' ? 'confirmed' : 'pending',
        })
        .eq('workspace_id', input.workspaceId)
        .eq('artifact_id', input.artifactId)
        .eq('id', input.slideId)
      return { error }
    },
    async removeArtifact({ workspaceId, artifactId }) {
      await client.from('conversation_artifacts').delete()
        .eq('workspace_id', workspaceId)
        .eq('id', artifactId)
    },
    async removeBatch({ workspaceId, batchId }) {
      await client.from('generation_batches').delete()
        .eq('workspace_id', workspaceId)
        .eq('id', batchId)
    },
    async messageBelongsToThread({ workspaceId, threadId, messageId }) {
      const result = await client.from('messages').select('id')
        .eq('workspace_id', workspaceId)
        .eq('thread_id', threadId)
        .eq('id', messageId)
        .maybeSingle()
      if (result.error) throw new Error('conversation_message_lookup_failed')
      return Boolean(result.data)
    },
    async listArtifactIdsForMessage({ workspaceId, messageId }) {
      const result = await client.from('message_artifacts').select('artifact_id')
        .eq('workspace_id', workspaceId)
        .eq('message_id', messageId)
        .order('created_at', { ascending: true })
      return {
        data: result.data?.map((row) => row.artifact_id) ?? null,
        error: result.error,
      }
    },
    async listForMessages({ workspaceId, messageIds }) {
      if (messageIds.length === 0) return { data: [], error: null }

      const linked = await client.from('message_artifacts')
        .select('message_id, artifact_id')
        .eq('workspace_id', workspaceId)
        .in('message_id', [...messageIds])
        .order('created_at', { ascending: true })
      if (linked.error || !Array.isArray(linked.data)) {
        return { data: null, error: linked.error ?? new Error('conversation_artifact_read_failed') }
      }

      const artifactIds = [...new Set(linked.data.map((row) => row.artifact_id))]
      if (artifactIds.length === 0) return { data: [], error: null }

      const [artifacts, batches, slides] = await Promise.all([
        client.from('conversation_artifacts')
          .select('id, workspace_id, source_message_id, type, status, title, structured_payload, caption, hashtags, cta, disclosure, observations, limitations, evidence, unresolved_questions, idempotency_key, work_item_id, content_item_id, version_id')
          .eq('workspace_id', workspaceId)
          .in('id', artifactIds),
        client.from('generation_batches')
          .select('artifact_id')
          .eq('workspace_id', workspaceId)
          .in('artifact_id', artifactIds),
        client.from('artifact_slides')
          .select('id, artifact_id, position, role, status, media_asset_id, alt_text, retryable, safe_error_code')
          .eq('workspace_id', workspaceId)
          .in('artifact_id', artifactIds)
          .order('position', { ascending: true }),
      ])
      const queryError = artifacts.error ?? batches.error ?? slides.error
      if (queryError || !Array.isArray(artifacts.data) || !Array.isArray(batches.data) || !Array.isArray(slides.data)) {
        return { data: null, error: queryError ?? new Error('conversation_artifact_read_failed') }
      }

      const batchArtifactIds = new Set(batches.data.map((row) => row.artifact_id))
      const slidesByArtifact = new Map<string, typeof slides.data>()
      for (const slide of slides.data) {
        const current = slidesByArtifact.get(slide.artifact_id) ?? []
        current.push(slide)
        slidesByArtifact.set(slide.artifact_id, current)
      }
      const artifactsById = new Map<string, ConversationArtifact>()
      for (const row of artifacts.data) {
        if (!batchArtifactIds.has(row.id)) {
          return { data: null, error: new Error('conversation_artifact_read_failed') }
        }
        artifactsById.set(row.id, normalizeArtifact({
          id: row.id,
          workspaceId: row.workspace_id,
          sourceMessageId: row.source_message_id,
          type: row.type as ConversationArtifact['type'],
          status: row.status as ConversationArtifact['status'],
          title: row.title,
          naverBlog: naverBlogFromPayload(row.structured_payload),
          caption: row.caption,
          hashtags: row.hashtags,
          cta: row.cta,
          disclosure: row.disclosure,
          observations: row.observations,
          limitations: row.limitations,
          evidence: stringArray(row.evidence),
          unresolvedQuestions: row.unresolved_questions,
          idempotencyKey: row.idempotency_key,
          workItemId: row.work_item_id,
          contentItemId: row.content_item_id,
          versionId: row.version_id,
          slides: (slidesByArtifact.get(row.id) ?? []).map((slide) => ({
            id: slide.id,
            position: slide.position,
            role: slide.role as ConversationArtifactSlide['role'],
            status: slide.status as ConversationArtifactSlide['status'],
            mediaAssetId: slide.media_asset_id,
            altText: slide.alt_text,
            retryable: slide.retryable,
            safeErrorCode: slide.safe_error_code as ConversationArtifactSlide['safeErrorCode'],
          })),
        }))
      }

      return {
        data: linked.data.flatMap((row) => {
          const artifact = artifactsById.get(row.artifact_id)
          return artifact ? [{ messageId: row.message_id, artifact }] : []
        }),
        error: null,
      }
    },
    async getById({ workspaceId, artifactId }) {
      const [artifact, batch, slides] = await Promise.all([
        client.from('conversation_artifacts')
          .select('id, workspace_id, source_message_id, type, status, title, structured_payload, caption, hashtags, cta, disclosure, observations, limitations, evidence, unresolved_questions, idempotency_key, work_item_id, content_item_id, version_id')
          .eq('workspace_id', workspaceId).eq('id', artifactId).maybeSingle(),
        client.from('generation_batches').select('id')
          .eq('workspace_id', workspaceId).eq('artifact_id', artifactId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('artifact_slides')
          .select('id, position, role, status, media_asset_id, alt_text, retryable, safe_error_code')
          .eq('workspace_id', workspaceId).eq('artifact_id', artifactId)
          .order('position', { ascending: true }),
      ])
      if (artifact.error || batch.error || slides.error || !artifact.data || !batch.data || !Array.isArray(slides.data)) {
        if (!artifact.error && !artifact.data) return null
        throw new Error('conversation_artifact_read_failed')
      }
      const row = artifact.data
      return normalizeArtifact({
        id: row.id,
        workspaceId: row.workspace_id,
        sourceMessageId: row.source_message_id,
        type: row.type as ConversationArtifact['type'],
        status: row.status as ConversationArtifact['status'],
        title: row.title,
        naverBlog: naverBlogFromPayload(row.structured_payload),
        caption: row.caption,
        hashtags: row.hashtags,
        cta: row.cta,
        disclosure: row.disclosure,
        observations: row.observations,
        limitations: row.limitations,
        evidence: stringArray(row.evidence),
        unresolvedQuestions: row.unresolved_questions,
        idempotencyKey: row.idempotency_key,
        workItemId: row.work_item_id,
        contentItemId: row.content_item_id,
        versionId: row.version_id,
        slides: slides.data.map((slide) => ({
          id: slide.id,
          position: slide.position,
          role: slide.role as ConversationArtifactSlide['role'],
          status: slide.status as ConversationArtifactSlide['status'],
          mediaAssetId: slide.media_asset_id,
          altText: slide.alt_text,
          retryable: slide.retryable,
          safeErrorCode: slide.safe_error_code as ConversationArtifactSlide['safeErrorCode'],
        })),
      })
    },
  }
  return gateway
}

function parseFactBasis(value: unknown) {
  const basis = approvedFactBasisSchema.parse(value)
  assertProvenanceSourceIntegrity(basis.provenance ?? [])
  return basis
}
