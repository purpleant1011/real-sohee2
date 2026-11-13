import { describe, expect, it, vi } from 'vitest'
import type { GeneratedImageBatch } from './conversation-image-batch'
import type { InstagramDraft } from './instagram-draft-provider'
import type { NaverBlogDraft } from './naver-blog-draft-provider'
import { buildBlogStrategyBrief } from '@/features/content/blog-strategy-brief'
import { marketingStrategyFixture } from '@/features/content/blog-strategy-brief.fixture'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  createSupabaseConversationArtifactGateway,
  listConversationArtifactsForMessage,
  listConversationArtifactsForMessages,
  persistConversationArtifact,
  persistConversationArtifactRetry,
  resolveConversationArtifactReference,
  resolveConversationArtifactRetryReference,
  type ConversationArtifactGateway,
} from './conversation-artifact-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const foreignWorkspaceId = '10000000-0000-4000-8000-000000000002'
const userId = '20000000-0000-4000-8000-000000000001'
const sourceMessageId = '30000000-0000-4000-8000-000000000001'
const assistantMessageId = '30000000-0000-4000-8000-000000000002'
const threadId = '35000000-0000-4000-8000-000000000001'
const artifactId = '40000000-0000-4000-8000-000000000001'
const batchId = '50000000-0000-4000-8000-000000000001'
const requestKey = '60000000-0000-4000-8000-000000000001'
const slideIds = [
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
] as const
const mediaIds = [
  '80000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000002',
] as const

const draft: InstagramDraft = Object.freeze({
  caption: '자연스러운 눈썹 디자인을 소개합니다.',
  hashtags: Object.freeze(['#눈썹']),
  cta: '상담 전 원하는 분위기를 알려 주세요.',
  disclosure: 'AI 초안이며 게시 전 검토가 필요합니다.',
  observations: Object.freeze(['자연스러운 결과를 요청했습니다.']),
  limitations: Object.freeze(['결과는 개인마다 다를 수 있습니다.']),
  evidence: Object.freeze(['현재 작업공간의 브랜드 말투']),
  unresolvedQuestions: Object.freeze(['예약 가능 시간을 확인해야 합니다.']),
})

const naverDraft: NaverBlogDraft = Object.freeze({
  title: '반영구 눈썹 상담 전 확인할 점',
  introduction: '원하는 느낌과 일상 습관을 정리해 보세요.',
  sections: Object.freeze([{ heading: '상담 전 체크', body: '평소 메이크업과 원하는 두께를 알려주세요.' }]),
  editorBlueprint: Object.freeze([
    Object.freeze({ kind: 'paragraph' as const, text: '원하는 느낌과 일상 습관을 정리해 보세요.' }),
    Object.freeze({ kind: 'image_slot' as const, position: 1, altText: '눈썹 디자인 표지' }),
    Object.freeze({ kind: 'quote' as const, text: '상담 전에 충분히 확인하세요.' }),
    Object.freeze({ kind: 'image_slot' as const, position: 2, altText: '상담 행동 유도' }),
    Object.freeze({ kind: 'link' as const, url: 'https://blog.naver.com/larlds', title: '바이름 블로그' }),
    Object.freeze({ kind: 'cta' as const, text: '상담으로 본인에게 맞는 방향을 확인해 보세요.' }),
  ]),
  keywords: Object.freeze(['반영구눈썹', '눈썹상담']),
  cta: '상담으로 본인에게 맞는 방향을 확인해 보세요.',
  disclosure: 'AI 보조로 제작한 일반 안내 초안입니다.',
  observations: Object.freeze([]), limitations: Object.freeze([]), evidence: Object.freeze([]),
  unresolvedQuestions: Object.freeze([]), visibility: 'public',
})

const batch: GeneratedImageBatch = Object.freeze({
  idempotencyKey: requestKey,
  status: 'ready_for_review',
  requestedCount: 2,
  startedCount: 2,
  succeededCount: 2,
  failedCount: 0,
  slides: Object.freeze([
    Object.freeze({
      id: slideIds[0],
      position: 1,
      role: 'cover',
      status: 'succeeded',
      mediaAssetId: mediaIds[0],
      altText: '눈썹 디자인 표지',
      retryable: false,
      safeErrorCode: null,
    }),
    Object.freeze({
      id: slideIds[1],
      position: 2,
      role: 'action',
      status: 'succeeded',
      mediaAssetId: mediaIds[1],
      altText: '상담 행동 유도',
      retryable: false,
      safeErrorCode: null,
    }),
  ]),
})

function gateway(overrides: Partial<ConversationArtifactGateway> = {}): ConversationArtifactGateway {
  return {
    findByRequest: vi.fn(async () => null),
    insertArtifact: vi.fn(async () => ({ error: null })),
    insertBatch: vi.fn(async () => ({ error: null })),
    insertSlides: vi.fn(async () => ({ error: null })),
    linkMessage: vi.fn(async () => ({ error: null })),
    updateArtifactStatus: vi.fn(async () => ({ error: null })),
    updateSlide: vi.fn(async () => ({ error: null })),
    removeArtifact: vi.fn(async () => undefined),
    removeBatch: vi.fn(async () => undefined),
    messageBelongsToThread: vi.fn(async () => true),
    listArtifactIdsForMessage: vi.fn(async () => ({ data: [artifactId], error: null })),
    listForMessages: vi.fn(async () => ({ data: [], error: null })),
    getById: vi.fn(async () => null),
    ...overrides,
  }
}

const saveInput = {
  workspaceId,
  userId,
  sourceMessageId,
  assistantMessageId,
  artifactId,
  batchId,
  idempotencyKey: requestKey,
  channel: 'instagram',
  draft,
  batch,
} as const

describe('persistConversationArtifact', () => {
  it('stores the artifact, batch, ordered slides, and assistant message link', async () => {
    const source = gateway()
    const result = await persistConversationArtifact(saveInput, source)

    expect(source.insertArtifact).toHaveBeenCalledBefore(source.insertBatch as ReturnType<typeof vi.fn>)
    expect(source.insertBatch).toHaveBeenCalledBefore(source.insertSlides as ReturnType<typeof vi.fn>)
    expect(source.insertSlides).toHaveBeenCalledBefore(source.linkMessage as ReturnType<typeof vi.fn>)
    expect(source.insertSlides).toHaveBeenCalledWith([
      expect.objectContaining({ id: slideIds[0], position: 1, media_asset_id: mediaIds[0] }),
      expect.objectContaining({ id: slideIds[1], position: 2, media_asset_id: mediaIds[1] }),
    ])
    expect(source.linkMessage).toHaveBeenCalledWith({
      workspace_id: workspaceId,
      message_id: assistantMessageId,
      artifact_id: artifactId,
    })
    expect(result.slides.map((slide) => slide.id)).toEqual(slideIds)
  })

  it('returns an existing result for the same request key without new inserts', async () => {
    const existing = await persistConversationArtifact(saveInput, gateway())
    const source = gateway({ findByRequest: vi.fn(async () => existing) })

    await expect(persistConversationArtifact(saveInput, source)).resolves.toBe(existing)
    expect(source.insertArtifact).not.toHaveBeenCalled()
    expect(source.insertBatch).not.toHaveBeenCalled()
    expect(source.insertSlides).not.toHaveBeenCalled()
    expect(source.linkMessage).not.toHaveBeenCalled()
  })

  it('persists a Threads proposal with the Threads artifact type', async () => {
    const source = gateway()

    const result = await persistConversationArtifact({ ...saveInput, channel: 'threads' }, source)

    expect(source.insertArtifact).toHaveBeenCalledWith(expect.objectContaining({ type: 'threads_post' }))
    expect(result.type).toBe('threads_post')
  })

  it('uses a public-safe AI disclosure when a social draft returns an empty disclosure', async () => {
    const source = gateway()

    await persistConversationArtifact({
      ...saveInput,
      draft: { ...draft, disclosure: '' },
    }, source)

    expect(source.insertArtifact).toHaveBeenCalledWith(expect.objectContaining({
      disclosure: 'AI를 활용해 제작한 이미지와 문안입니다.',
    }))
  })

  it('uses the database-safe empty title for a social artifact without a title', async () => {
    const source = gateway()

    await persistConversationArtifact(saveInput, source)

    expect(source.insertArtifact).toHaveBeenCalledWith(expect.objectContaining({
      type: 'instagram_post',
      title: '',
    }))
  })

  it('rejects a strategy from another workspace before writing any artifact', async () => {
    const source = gateway()
    const strategyBrief = buildBlogStrategyBrief(marketingStrategyFixture, marketingStrategyFixture)
    await expect(persistConversationArtifact({
      ...saveInput, channel: 'naver_blog', draft: { ...naverDraft, strategyBrief },
    }, source)).rejects.toThrow('BLOG_STRATEGY_SCOPE_MISMATCH')
    expect(source.insertArtifact).not.toHaveBeenCalled()
    expect(source.insertBatch).not.toHaveBeenCalled()
  })

  it('rejects approved fact provenance from another workspace before persistence', async () => {
    const source = gateway()
    const factBasis = { workspaceId: '90000000-0000-4000-8000-000000000001', snapshotHash: 'a'.repeat(64), resolvedAt: '2026-10-28T00:00:00Z', sources: [] }
    await expect(persistConversationArtifact({ ...saveInput, channel: 'naver_blog', draft: { ...naverDraft, factBasis } }, source))
      .rejects.toThrow('FACT_WORKSPACE_MISMATCH')
    expect(source.insertArtifact).not.toHaveBeenCalled()
  })

  it('preserves the strategy and approved fact provenance in the persisted structured manuscript', async () => {
    const source = gateway()
    const brief = { ...marketingStrategyFixture, workspaceId: saveInput.workspaceId }
    const strategyBrief = buildBlogStrategyBrief(brief, brief)
    const factBasis = { workspaceId, snapshotHash: 'a'.repeat(64), resolvedAt: '2026-10-28T00:00:00Z', sources: [{ factId: 'fact-1', sourceCandidateId: 'source-1', approvedAt: '2026-10-01T00:00:00Z' }] }
    const result = await persistConversationArtifact({
      ...saveInput, channel: 'naver_blog', draft: { ...naverDraft, strategyBrief, factBasis },
    }, source)
    expect(source.insertArtifact).toHaveBeenCalledWith(expect.objectContaining({
      structured_payload: expect.objectContaining({ strategyBrief }),
    }))
    expect(result.naverBlog?.strategyBrief).toEqual(strategyBrief)

    // 실제 gateway의 strict payload parser로 저장 직후와 같은 전략이 재조회되는지 확인한다.
    const row = vi.mocked(source.insertArtifact).mock.calls[0]![0]
    const from = vi.fn((table: string) => {
      const data = table === 'conversation_artifacts' ? JSON.parse(JSON.stringify(row))
        : table === 'generation_batches' ? { id: batchId } : []
      return {
        data, error: null,
        select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
        async maybeSingle() { return { data, error: null } },
      }
    })
    const reader = createSupabaseConversationArtifactGateway({ from } as unknown as ServerSupabaseClient)
    const replayed = await reader.getById({ workspaceId, artifactId })
    expect(replayed?.naverBlog?.strategyBrief).toEqual(strategyBrief)
    expect(replayed?.naverBlog?.factBasis).toEqual(factBasis)
  })

  it('persists a public API-only Naver Blog proposal with its exact structured draft', async () => {
    const source = gateway()

    const result = await persistConversationArtifact({
      ...saveInput,
      channel: 'naver_blog',
      draft: naverDraft,
      generationMode: 'api_only',
    }, source)

    expect(source.insertArtifact).toHaveBeenCalledWith(expect.objectContaining({
      type: 'naver_blog_post',
      title: naverDraft.title,
      structured_payload: expect.objectContaining({
        channel: 'naver_blog',
        introduction: naverDraft.introduction,
        sections: naverDraft.sections,
        editorBlueprint: naverDraft.editorBlueprint,
        keywords: naverDraft.keywords,
        visibility: 'public',
        generation: {
          mode: 'api_only',
          text: 'openai_responses_api',
          images: 'openai_images_api',
        },
      }),
    }))
    expect(result).toMatchObject({
      type: 'naver_blog_post',
      title: naverDraft.title,
      naverBlog: expect.objectContaining({
        visibility: 'public',
        generation: expect.objectContaining({ mode: 'api_only' }),
      }),
    })
  })
})

describe('artifact replay and follow-up reference', () => {
  it('loads ten message artifacts through one batched gateway call', async () => {
    const artifact = await persistConversationArtifact(saveInput, gateway())
    const messageIds = Array.from({ length: 10 }, (_, index) =>
      `30000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`)
    const listForMessages = vi.fn(async () => ({
      data: messageIds.map((messageId) => ({ messageId, artifact })),
      error: null,
    }))
    const source = gateway({ listForMessages })

    const replayed = await listConversationArtifactsForMessages({
      workspaceId,
      messageIds,
    }, source)

    expect(listForMessages).toHaveBeenCalledOnce()
    expect(listForMessages).toHaveBeenCalledWith({ workspaceId, messageIds })
    expect(source.listArtifactIdsForMessage).not.toHaveBeenCalled()
    expect(source.getById).not.toHaveBeenCalled()
    expect(Object.keys(replayed)).toHaveLength(10)
    expect(replayed[messageIds[0]]?.[0]?.slides.map((slide) => slide.id)).toEqual(slideIds)
  })

  it('replays artifacts and slides in their persisted order after refresh', async () => {
    const artifact = await persistConversationArtifact(saveInput, gateway())
    const reversed = { ...artifact, slides: Object.freeze([...artifact.slides].reverse()) }
    const source = gateway({ getById: vi.fn(async () => reversed) })

    const replayed = await listConversationArtifactsForMessage({
      workspaceId,
      messageId: assistantMessageId,
    }, source)

    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.slides.map((slide) => slide.id)).toEqual(slideIds)
  })

  it.each([
    ['foreign workspace', foreignWorkspaceId, 'ready_for_review', 'succeeded', 'not_found'],
    ['archived artifact', workspaceId, 'archived', 'succeeded', 'archived'],
    ['failed slide', workspaceId, 'ready_for_review', 'failed', 'failed_slide'],
  ] as const)('rejects a %s reference safely', async (_label, artifactWorkspaceId, artifactStatus, slideStatus, reason) => {
    const artifact = await persistConversationArtifact(saveInput, gateway())
    const referenced = {
      ...artifact,
      workspaceId: artifactWorkspaceId,
      status: artifactStatus,
      slides: Object.freeze(artifact.slides.map((slide, index) => index === 1
        ? { ...slide, status: slideStatus, mediaAssetId: slideStatus === 'failed' ? null : slide.mediaAssetId }
        : slide)),
    }
    const source = gateway({ getById: vi.fn(async () => referenced) })

    await expect(resolveConversationArtifactReference({
      workspaceId,
      threadId,
      replyToMessageId: assistantMessageId,
      selectedSlideId: slideIds[1],
    }, source)).resolves.toEqual({ ok: false, reason })
  })

  it('rejects a result reference owned by another conversation thread', async () => {
    const source = gateway({ messageBelongsToThread: vi.fn(async () => false) })

    await expect(resolveConversationArtifactReference({
      workspaceId,
      threadId,
      replyToMessageId: assistantMessageId,
      selectedSlideId: slideIds[0],
    }, source)).resolves.toEqual({ ok: false, reason: 'not_found' })
    expect(source.listArtifactIdsForMessage).not.toHaveBeenCalled()
  })

  it('allows only a retryable failed slide through the retry reference path', async () => {
    const artifact = await persistConversationArtifact(saveInput, gateway())
    const failed = {
      ...artifact,
      status: 'partial' as const,
      slides: Object.freeze(artifact.slides.map((slide, index) => index === 1
        ? { ...slide, status: 'failed' as const, mediaAssetId: null, retryable: true,
            safeErrorCode: 'IMAGE_RETRYABLE' as const }
        : slide)),
    }
    const source = gateway({ getById: vi.fn(async () => failed) })

    await expect(resolveConversationArtifactRetryReference({
      workspaceId,
      threadId,
      replyToMessageId: assistantMessageId,
      retryFailedSlideId: slideIds[1],
    }, source)).resolves.toEqual({ ok: true, artifact: failed, slide: failed.slides[1] })

    await expect(resolveConversationArtifactRetryReference({
      workspaceId,
      threadId,
      replyToMessageId: assistantMessageId,
      retryFailedSlideId: slideIds[0],
    }, source)).resolves.toEqual({ ok: false, reason: 'slide_not_retryable' })
  })
})

describe('persistConversationArtifactRetry', () => {
  it('adds a one-slide generation batch and updates only the selected existing slide', async () => {
    const existing = await persistConversationArtifact(saveInput, gateway())
    const regeneratedBatch: GeneratedImageBatch = Object.freeze({
      ...batch,
      idempotencyKey: '60000000-0000-4000-8000-000000000002',
      slides: Object.freeze(batch.slides.map((slide) => slide.id === slideIds[1]
        ? Object.freeze({ ...slide, mediaAssetId: '80000000-0000-4000-8000-000000000003' })
        : slide)),
    })
    const source = gateway()

    const retried = await persistConversationArtifactRetry({
      workspaceId,
      assistantMessageId,
      artifact: existing,
      selectedSlideId: slideIds[1],
      batchId: '50000000-0000-4000-8000-000000000002',
      idempotencyKey: regeneratedBatch.idempotencyKey,
      batch: regeneratedBatch,
    }, source)

    expect(source.insertArtifact).not.toHaveBeenCalled()
    expect(source.insertBatch).toHaveBeenCalledWith(expect.objectContaining({
      artifact_id: artifactId,
      requested_count: 1,
      started_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      status: 'succeeded',
    }))
    expect(source.updateSlide).toHaveBeenCalledTimes(1)
    expect(source.updateSlide).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      artifactId,
      slideId: slideIds[1],
      mediaAssetId: '80000000-0000-4000-8000-000000000003',
    }))
    expect(retried.slides[0]).toEqual(existing.slides[0])
    expect(retried.slides[1]?.id).toBe(slideIds[1])
  })
})
