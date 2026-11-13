import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const fakeGeminiClient = vi.hoisted(() => ({ responses: { create: vi.fn() } }))
const openAIConstructor = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({ default: openAIConstructor }))
vi.mock('@/lib/ai/gemini-responses-adapter', () => ({
  createProductionTextClient: vi.fn(() => fakeGeminiClient),
}))
const database = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => database }))
vi.mock('./naver-generation-context.server', () => ({ loadNaverGenerationContext: vi.fn() }))
vi.mock('./conversation-artifact-repository', () => ({
  createSupabaseConversationArtifactGateway: () => ({}), persistConversationArtifact: vi.fn(), persistConversationArtifactRetry: vi.fn(),
}))
vi.mock('./conversation-artifact-generation', () => ({ createConversationArtifactWorkflow: vi.fn() }))
vi.mock('./conversation-image-subrequests', () => ({ generateConversationImageBatchViaSubrequests: vi.fn() }))
vi.mock('./conversation-image-generation.server', () => ({
  createProductionConversationImageArtifact: vi.fn(), createProductionConversationImageBatchArtifacts: vi.fn(),
}))
vi.mock('./instagram-draft-provider', () => ({ createOpenAIInstagramDraftProvider: vi.fn() }))
vi.mock('./byreum-naver-reference-draft', () => ({ createByreumNaverReferenceDraft: vi.fn() }))
vi.mock('./naver-blog-draft-provider', () => ({ createProductionNaverBlogDraftProvider: vi.fn() }))

import { createProductionConversationArtifact } from './conversation-artifact-generation.server'
import { createConversationArtifactWorkflow } from './conversation-artifact-generation'
import { createByreumNaverReferenceDraft } from './byreum-naver-reference-draft'
import { createProductionNaverBlogDraftProvider } from './naver-blog-draft-provider'
import { createOpenAIInstagramDraftProvider } from './instagram-draft-provider'
import { buildBlogStrategyBrief } from '@/features/content/blog-strategy-brief'
import { marketingStrategyFixture } from '@/features/content/blog-strategy-brief.fixture'
import { createProductionConversationImageBatchArtifacts } from './conversation-image-generation.server'

beforeEach(() => vi.clearAllMocks())

describe('production Naver strategy routing', () => {
  it.each(['instagram', 'threads'] as const)('reuses exact owner photos for %s without calling an image model', async channel => {
    const workspaceId = marketingStrategyFixture.workspaceId
    const ids = ['60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002']
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query), limit: vi.fn(async () => ({ data: ids.slice().reverse().map(id => ({ id, workspace_id: workspaceId, rights_status: 'confirmed', created_at: '2026-11-02T00:00:00Z' })), error: null })) }
    database.from.mockReturnValue(query)
    await createProductionConversationArtifact({ workspaceId, userId: 'test-user', sourceMessageId: 'test-source', assistantMessageId: 'test-assistant', idempotencyKey: 'photo-request', channel, count: 2, prompt: '이 사진 원본을 그대로 사용해줘', attachmentIds: ids, generationMode: 'existing_media' })
    const deps = vi.mocked(createConversationArtifactWorkflow).mock.calls[0]![1]
    const batch = await deps.generateBatch({ workspaceId, userId: 'test-user', prompt: '이 사진 원본을 그대로 사용해줘', channel, count: 2, idempotencyKey: 'photo-request', attachmentIds: ids, generationMode: 'existing_media' })
    expect(createProductionConversationImageBatchArtifacts).not.toHaveBeenCalled()
    expect(batch.slides.map(slide => slide.mediaAssetId)).toEqual(ids)
    expect(batch.slides.every(slide => slide.status === 'succeeded' && !slide.altText.includes('바이름'))).toBe(true)
    expect(query.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(query.eq).toHaveBeenCalledWith('rights_status', 'confirmed')
  })

  it.each(['foreign-workspace', 'pending-rights', 'missing-asset'])('never replaces an invalid original photo with an AI image: %s', async scenario => {
    const workspaceId = marketingStrategyFixture.workspaceId
    const id = '60000000-0000-4000-8000-000000000001'
    const row = { id, workspace_id: scenario === 'foreign-workspace' ? 'other-shop' : workspaceId, rights_status: scenario === 'pending-rights' ? 'pending' : 'confirmed', created_at: '2026-11-02T00:00:00Z' }
    const query = { select: () => query, eq: () => query, in: () => query, limit: async () => ({ data: scenario === 'missing-asset' ? [] : [row], error: null }) }
    database.from.mockReturnValue(query)
    await createProductionConversationArtifact({ workspaceId, userId: 'test-user', sourceMessageId: 'test-source', assistantMessageId: 'test-assistant', idempotencyKey: 'photo-request', channel: 'instagram', count: 1, prompt: '이 사진 원본을 그대로 사용해줘', attachmentIds: [id], generationMode: 'existing_media' })
    const deps = vi.mocked(createConversationArtifactWorkflow).mock.calls[0]![1]
    await expect(deps.generateBatch({ workspaceId, userId: 'test-user', prompt: '이 사진 원본을 그대로 사용해줘', channel: 'instagram', count: 1, idempotencyKey: 'photo-request', attachmentIds: [id], generationMode: 'existing_media' })).rejects.toThrow('NAVER_ATTACHED_MEDIA_FORBIDDEN')
    expect(createProductionConversationImageBatchArtifacts).not.toHaveBeenCalled()
  })

  it('uses the strategy-aware provider rather than a fixed reference draft when reusing photos', async () => {
    await createProductionConversationArtifact({
      workspaceId: marketingStrategyFixture.workspaceId, userId: 'test-user', sourceMessageId: 'test-source',
      assistantMessageId: 'test-assistant', idempotencyKey: 'test-request', channel: 'naver_blog', count: 1,
      prompt: '기존 사진을 재사용해서 네이버 블로그 글을 만들어줘. 새 이미지는 생성하지 마',
    })
    const dependencies = vi.mocked(createConversationArtifactWorkflow).mock.calls[0]![1]
    const generate = vi.fn().mockResolvedValue({ title: '목표 기반 원고' })
    vi.mocked(createProductionNaverBlogDraftProvider).mockReturnValue({ generate })
    const blogStrategyBrief = buildBlogStrategyBrief(marketingStrategyFixture, marketingStrategyFixture)
    const request = {
      prompt: '기존 사진을 재사용해서 네이버 블로그 글을 만들어줘. 새 이미지는 생성하지 마', channel: 'naver_blog' as const,
      imageCount: 1 as const, attachmentIds: [], blogStrategyBrief,
      context: { businessName: '서비스', industry: null, location: null, businessSummary: null, brandVoice: null, keywords: [], prohibitedTerms: [] },
    }
    await dependencies.generateDraft(request)
    expect(createByreumNaverReferenceDraft).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ blogStrategyBrief }))
  })

  it('uses Gemini production text client for instagram drafts without constructing OpenAI text client', async () => {
    await createProductionConversationArtifact({
      workspaceId: marketingStrategyFixture.workspaceId, userId: 'test-user', sourceMessageId: 'test-source',
      assistantMessageId: 'test-assistant', idempotencyKey: 'test-request-insta', channel: 'instagram', count: 1,
      prompt: '인스타 피드 글을 작성해줘',
    })
    const dependencies = vi.mocked(createConversationArtifactWorkflow).mock.calls[0]![1]
    const generate = vi.fn().mockResolvedValue({ caption: '생성된 인스타 본문', hashtags: [] })
    vi.mocked(createOpenAIInstagramDraftProvider).mockReturnValue({ generate })
    const request = {
      prompt: '인스타 피드 글을 작성해줘', channel: 'instagram' as const,
      imageCount: 1 as const, attachmentIds: [],
      context: { businessName: '서비스', industry: null, location: null, businessSummary: null, brandVoice: null, keywords: [], prohibitedTerms: [] },
    }
    await dependencies.generateDraft(request)
    expect(createOpenAIInstagramDraftProvider).toHaveBeenCalledWith(fakeGeminiClient, 'gemini')
    expect(openAIConstructor).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ channel: 'instagram' }))
  })

  it('uses Byreum reference draft for Byreum workspace when reusing photos without strategy brief', async () => {
    await createProductionConversationArtifact({
      workspaceId: marketingStrategyFixture.workspaceId, userId: 'test-user', sourceMessageId: 'test-source',
      assistantMessageId: 'test-assistant', idempotencyKey: 'test-byreum-reuse', channel: 'naver_blog', count: 1,
      prompt: '기존 사진을 재사용해서 네이버 블로그 글을 만들어줘. 새 이미지는 생성하지 마',
    })
    const dependencies = vi.mocked(createConversationArtifactWorkflow).mock.calls[0]![1]
    const byreumDraft = { title: '바이름 참조 초안' }
    vi.mocked(createByreumNaverReferenceDraft).mockReturnValue(byreumDraft as never)
    const request = {
      prompt: '기존 사진을 재사용해서 네이버 블로그 글을 만들어줘. 새 이미지는 생성하지 마',
      channel: 'naver_blog' as const,
      imageCount: 1 as const,
      attachmentIds: [],
      context: {
        businessName: '바이름 뷰티샵',
        industry: null,
        location: null,
        businessSummary: null,
        brandVoice: null,
        keywords: [],
        prohibitedTerms: [],
      },
    }
    const result = await dependencies.generateDraft(request)
    expect(createByreumNaverReferenceDraft).toHaveBeenCalledWith(request.context, 1)
    expect(result).toBe(byreumDraft)
  })

  it('routes to general draft provider when non-Byreum workspace reuses photos without strategy brief', async () => {
    await createProductionConversationArtifact({
      workspaceId: marketingStrategyFixture.workspaceId, userId: 'test-user', sourceMessageId: 'test-source',
      assistantMessageId: 'test-assistant', idempotencyKey: 'test-non-byreum-reuse', channel: 'naver_blog', count: 1,
      prompt: '기존 사진을 재사용해서 네이버 블로그 글을 만들어줘. 새 이미지는 생성하지 마',
    })
    const dependencies = vi.mocked(createConversationArtifactWorkflow).mock.calls[0]![1]
    const generalDraft = { title: '일반 블로그 원고' }
    const generate = vi.fn().mockResolvedValue(generalDraft)
    vi.mocked(createProductionNaverBlogDraftProvider).mockReturnValue({ generate })
    const request = {
      prompt: '기존 사진을 재사용해서 네이버 블로그 글을 만들어줘. 새 이미지는 생성하지 마',
      channel: 'naver_blog' as const,
      imageCount: 1 as const,
      attachmentIds: [],
      context: {
        businessName: '성수 카페',
        industry: null,
        location: null,
        businessSummary: null,
        brandVoice: null,
        keywords: [],
        prohibitedTerms: [],
      },
    }
    const result = await dependencies.generateDraft(request)
    expect(createByreumNaverReferenceDraft).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: request.prompt }))
    expect(result).toBe(generalDraft)
  })
})
