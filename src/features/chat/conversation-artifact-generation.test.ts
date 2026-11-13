import { describe, expect, it, vi } from 'vitest'
import type { ArtifactReferenceResult } from './conversation-artifact-repository'
import { createConversationArtifactWorkflow, type ConversationArtifactWorkflowDependencies } from './conversation-artifact-generation'
import type { NaverBlogDraft } from './naver-blog-draft-provider'
import type { GeneratedImageBatch } from './conversation-image-batch'
import type { InstagramDraft } from './instagram-draft-provider'
import type { ConversationArtifact } from './types'
import type { ContentBrief } from './content-interview'
import { marketingStrategyFixture } from '@/features/content/blog-strategy-brief.fixture'
import { resolveApprovedFacts } from '@/features/knowledge/approved-fact-resolver'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const userId = '20000000-0000-4000-8000-000000000001'
const sourceMessageId = '30000000-0000-4000-8000-000000000001'
const assistantMessageId = '30000000-0000-4000-8000-000000000002'
const requestKey = '40000000-0000-4000-8000-000000000001'

const draft: InstagramDraft = Object.freeze({
  caption: '눈썹 디자인 초안',
  hashtags: Object.freeze(['#눈썹']),
  cta: '상담해 주세요.',
  disclosure: '게시 전 검토가 필요합니다.',
  observations: Object.freeze([]),
  limitations: Object.freeze([]),
  evidence: Object.freeze([]),
  unresolvedQuestions: Object.freeze([]),
})

const batch: GeneratedImageBatch = Object.freeze({
  idempotencyKey: requestKey,
  status: 'ready_for_review',
  requestedCount: 1,
  startedCount: 1,
  succeededCount: 1,
  failedCount: 0,
  slides: Object.freeze([Object.freeze({
    id: '50000000-0000-4000-8000-000000000001',
    position: 1,
    role: 'cover',
    status: 'succeeded',
    mediaAssetId: '60000000-0000-4000-8000-000000000001',
    altText: '눈썹 디자인 표지',
    retryable: false,
    safeErrorCode: null,
  })]),
})

const artifact: ConversationArtifact = Object.freeze({
  id: '70000000-0000-4000-8000-000000000001',
  workspaceId,
  sourceMessageId,
  type: 'instagram_post',
  status: 'ready_for_review',
  ...draft,
  idempotencyKey: requestKey,
  slides: batch.slides,
})

function dependencies() {
  return {
    findExisting: vi.fn(async (): Promise<ConversationArtifact | null> => null),
    loadContext: vi.fn(async () => ({
      businessName: '바이름',
      industry: null,
      location: null,
      businessSummary: null,
      brandVoice: null,
      keywords: [],
      prohibitedTerms: [],
    })),
    generateDraft: vi.fn<ConversationArtifactWorkflowDependencies['generateDraft']>(async () => draft),
    loadApprovedFacts: vi.fn<NonNullable<ConversationArtifactWorkflowDependencies['loadApprovedFacts']>>(async () => ({ workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'empty', facts: [] })),
    generateBatch: vi.fn(async () => batch),
    regenerateSlide: vi.fn(async () => batch),
    persistFresh: vi.fn<ConversationArtifactWorkflowDependencies['persistFresh']>(async () => artifact),
    persistRetry: vi.fn(async () => artifact),
    createId: vi.fn()
      .mockReturnValueOnce(artifact.id)
      .mockReturnValueOnce('80000000-0000-4000-8000-000000000001'),
  }
}

const input = {
  workspaceId,
  userId,
  sourceMessageId,
  assistantMessageId,
  idempotencyKey: requestKey,
  prompt: '인스타 이미지 한 장 만들어줘',
  channel: 'instagram' as const,
  count: 1 as const,
}

describe('createConversationArtifactWorkflow', () => {
  it('preserves a concrete image failure instead of masking it as an artifact storage failure', async () => {
    const deps = dependencies()
    deps.generateBatch.mockResolvedValueOnce({ ...batch, status: 'failed', succeededCount: 0, failedCount: 1,
      slides: [{ ...batch.slides[0], status: 'failed', mediaAssetId: null, safeErrorCode: 'IMAGE_AUTH_REQUIRED' }] } as never)
    await expect(createConversationArtifactWorkflow(input, deps)).rejects.toThrow('IMAGE_AUTH_REQUIRED')
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })
  it('reports actual facts, draft, images and storage boundaries in order', async () => {
    const phases: string[] = []
    const deps = dependencies()
    await createConversationArtifactWorkflow({ ...input, onTaskPhase: async (phase, state) => { phases.push(`${phase}:${state}`) } }, deps)
    expect(phases).toEqual(['facts:started', 'facts:completed', 'draft:started', 'draft:completed', 'images:started', 'images:completed', 'save:started', 'save:completed'])
  })
  it('reports the real fact count and image coverage with each completed boundary', async () => {
    const seen: unknown[] = []
    const deps = dependencies()
    await createConversationArtifactWorkflow({ ...input, onTaskPhase: async (phase, state, detail) => { seen.push([phase, state, detail]) } }, deps)
    expect(seen.find((e: any) => e[0] === 'images' && e[1] === 'completed')).toEqual(['images', 'completed', { coverage: { covered: 1, total: 1 } }])
    expect(seen.find((e: any) => e[0] === 'facts' && e[1] === 'completed')).toEqual(['facts', 'completed', undefined])
  })
  it('reports approved fact count for naver and a partial image result as incomplete, never completed', async () => {
    const seen: unknown[] = []
    const deps = dependencies()
    deps.loadApprovedFacts.mockResolvedValue({ workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'h', facts: [
      { id: 'f1', workspace_id: workspaceId, category: 'service', content: '상담은 사전 문의 후 진행합니다.' },
      { id: 'f2', workspace_id: workspaceId, category: 'hours', content: '평일 10시부터 19시까지 운영합니다.' },
    ] } as never)
    deps.generateDraft.mockResolvedValueOnce({
      title: '안내', introduction: '소개', sections: [], editorBlueprint: [], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    deps.generateBatch.mockResolvedValueOnce({ ...batch, status: 'partial', requestedCount: 3, startedCount: 3, succeededCount: 2, failedCount: 1 } as never)
    await createConversationArtifactWorkflow({ ...input, channel: 'naver_blog', count: 3 as never,
      onTaskPhase: async (phase, state, detail) => { seen.push([phase, state, detail]) } }, deps).catch(() => {})
    expect(seen).toContainEqual(['facts', 'completed', { sampleSize: 2 }])
    expect(seen).toContainEqual(['images', 'incomplete', { coverage: { covered: 2, total: 3 } }])
    expect(seen.some((e: any) => e[0] === 'images' && e[1] === 'completed')).toBe(false)
  })
  it('passes the server fact snapshot to the writer without approval identities', async () => {
    const deps = dependencies()
    const fact = {
      id: 'fact-1', workspace_id: workspaceId, category: 'service', content: '상담은 사전 문의 후 진행합니다.',
      status: 'active', source_candidate_id: 'source-1', approved_by_user_id: userId,
      approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null,
      supersedes_fact_id: null, created_at: '2026-10-27T00:00:00Z',
    }
    deps.loadApprovedFacts.mockResolvedValue(resolveApprovedFacts({
      workspaceId, at: '2026-10-28T00:00:00Z', rows: [
        fact,
        { ...fact, id: 'expired', content: '만료된 안내', valid_until: '2026-10-27T12:00:00Z' },
        { ...fact, id: 'unapproved', content: '승인되지 않은 안내', approved_by_user_id: '' },
        { ...fact, id: 'future', content: '아직 유효하지 않은 안내', valid_from: '2026-10-29T00:00:00Z' },
      ],
    }))
    deps.generateDraft.mockResolvedValueOnce({
      title: '상담 안내', introduction: '상담은 사전 문의 후 진행합니다.', sections: [], editorBlueprint: [], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    await createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps)
    expect(deps.persistFresh.mock.calls[0]?.[0]).toMatchObject({ draft: { factBasis: { provenance: [{
      factId: 'fact-1', sourceType: 'owner_approved_fact', sourceSpan: fact.content,
      ownerApproval: { approvedByUserId: userId, approvedAt: fact.approved_at },
    }] } } })
    expect(deps.generateDraft.mock.calls[0]?.[0]).toHaveProperty('approvedFacts', [
      { category: 'service', content: '상담은 사전 문의 후 진행합니다.' },
    ])
  })

  it('rejects another workspace fact snapshot before calling the writer', async () => {
    const deps = dependencies()
    deps.loadApprovedFacts.mockResolvedValue({ workspaceId: userId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'other', facts: [] })
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_FACTS_UNAVAILABLE')
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
  })

  it('fails closed with a safe reason when approved facts cannot be loaded', async () => {
    const deps = dependencies()
    deps.loadApprovedFacts.mockRejectedValue(new Error('private database details'))
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_FACTS_UNAVAILABLE')
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it('blocks an unsupported Naver price before images and persistence', async () => {
    const deps = dependencies()
    deps.generateDraft.mockResolvedValueOnce({
      title: '커트 안내', introduction: '커트 30,000원', sections: [],
      editorBlueprint: [{ kind: 'paragraph', text: '커트 30,000원' }], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_CLAIMS_NEED_REVIEW')
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })
  it.each([
    ['커트 1.5만원', '커트 5만원'],
    ['커트 10만5천원', '커트 5천원'],
    ['커트 ₩1.5', '커트 ₩1'],
    ['커트 5원', '커트 1.5원'],
    ['커트 5k', '커트 1.5k'],
  ])('blocks an altered price before buying images or saving: %s', async (text, content) => {
    const deps = dependencies()
    deps.loadApprovedFacts.mockResolvedValue(resolveApprovedFacts({
      workspaceId, at: '2026-10-28T00:00:00Z', rows: [{
        id: 'price-1', workspace_id: workspaceId, category: 'PRICE', content,
        status: 'active', source_candidate_id: 'source-1', approved_by_user_id: userId,
        approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null,
        supersedes_fact_id: null, created_at: '2026-10-27T00:00:00Z',
      }],
    }))
    deps.generateDraft.mockResolvedValueOnce({
      title: '커트 안내', introduction: text, sections: [],
      editorBlueprint: [{ kind: 'paragraph', text }], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_CLAIMS_NEED_REVIEW')
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it.each(['외부 음식 반입 금지', '금지: 외부 음식 반입, 반려동물 동반'])('blocks draft containing approved PROHIBITED terms before buying images: %s', async content => {
    const deps = dependencies()
    deps.loadApprovedFacts.mockResolvedValue(resolveApprovedFacts({
      workspaceId, at: '2026-10-28T00:00:00Z', rows: [{
        id: 'prohibited-1', workspace_id: workspaceId, category: 'PROHIBITED', content,
        status: 'active', source_candidate_id: 'source-1', approved_by_user_id: userId,
        approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null,
        supersedes_fact_id: null, created_at: '2026-10-27T00:00:00Z',
      }],
    }))
    deps.generateDraft.mockResolvedValueOnce({
      title: '매장 이용 안내', introduction: '외부 음식 반입 가능합니다', sections: [],
      editorBlueprint: [{ kind: 'paragraph', text: '외부 음식 반입 가능합니다' }], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_CLAIMS_NEED_REVIEW')
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it('refuses to persist when approved facts change during image generation', async () => {
    const deps = dependencies()
    deps.generateDraft.mockResolvedValueOnce({
      title: '매장 안내', introduction: '안녕하세요', sections: [], editorBlueprint: [], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    deps.generateBatch.mockImplementationOnce(async () => {
      deps.loadApprovedFacts.mockResolvedValue({ workspaceId, resolvedAt: '2026-10-28T00:01:00Z', hash: 'changed', facts: [] })
      return batch
    })
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('FACT_SNAPSHOT_STALE')
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it('uses a safe reason and refuses persistence when the final fact read fails', async () => {
    const deps = dependencies()
    deps.generateDraft.mockResolvedValueOnce({
      title: '매장 안내', introduction: '안녕하세요', sections: [], editorBlueprint: [], keywords: [],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    })
    deps.generateBatch.mockImplementationOnce(async () => {
      deps.loadApprovedFacts.mockRejectedValue(new Error('private database details'))
      return batch
    })
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_FACTS_UNAVAILABLE')
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it('fails closed on approved fact read failure without buying images', async () => {
    const deps = dependencies()
    deps.loadApprovedFacts.mockRejectedValueOnce(new Error('FACT_READ_INCOMPLETE'))
    await expect(createConversationArtifactWorkflow({ ...input, channel: 'naver_blog' }, deps))
      .rejects.toThrow('NAVER_FACTS_UNAVAILABLE')
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
  })

  it('keeps a versioned marketing strategy identical at generation and persistence boundaries', async () => {
    const deps = dependencies()
    const brief = { ...marketingStrategyFixture, workspaceId }
    const naverDraft: NaverBlogDraft = {
      title: '서비스 상담 안내', introduction: '도입', sections: [{ heading: '상담', body: '본문' }],
      editorBlueprint: [{ kind: 'image_slot', position: 1, altText: '상담 안내' }], keywords: ['상담'],
      cta: '문의', disclosure: '', observations: [], limitations: [], evidence: [], unresolvedQuestions: [], visibility: 'public',
    }
    deps.generateDraft.mockResolvedValueOnce(naverDraft)
    await createConversationArtifactWorkflow({
      ...input, channel: 'naver_blog',
      marketingStrategy: { brief, datasetMode: 'ACTUAL', lineage: brief.lineage },
    }, deps)
    const strategy = deps.generateDraft.mock.calls[0]?.[0]?.blogStrategyBrief
    expect(strategy).toMatchObject({
      sourceBrief: { id: brief.id, revision: brief.revision }, lineage: brief.lineage,
      businessGoal: brief.businessGoal, questions: brief.questions, evidence: brief.evidence,
    })
    expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({ strategyBrief: strategy, factBasis: expect.objectContaining({ workspaceId, snapshotHash: 'empty' }) }),
    }))
  })

  it('rejects cross-workspace strategy before any provider, image, or persistence operation', async () => {
    const deps = dependencies()
    await expect(createConversationArtifactWorkflow({
      ...input, channel: 'naver_blog',
      marketingStrategy: { brief: marketingStrategyFixture, datasetMode: 'ACTUAL', lineage: marketingStrategyFixture.lineage },
    }, deps)).rejects.toThrow()
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it('rejects a changed strategy on an existing request instead of returning an unrelated draft', async () => {
    const deps = dependencies()
    deps.findExisting.mockResolvedValueOnce(artifact)
    const brief = { ...marketingStrategyFixture, workspaceId }
    await expect(createConversationArtifactWorkflow({
      ...input, channel: 'naver_blog',
      marketingStrategy: { brief, datasetMode: 'ACTUAL', lineage: brief.lineage },
    }, deps)).rejects.toThrow('BLOG_STRATEGY_REQUEST_CONFLICT')
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
  })

  it('rejects a strategy on a social channel before context or provider calls', async () => {
    const deps = dependencies()
    const brief = { ...marketingStrategyFixture, workspaceId }
    await expect(createConversationArtifactWorkflow({
      ...input, marketingStrategy: { brief, datasetMode: 'ACTUAL', lineage: brief.lineage },
    }, deps)).rejects.toThrow('BLOG_STRATEGY_UNSUPPORTED_OPERATION')
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(deps.generateDraft).not.toHaveBeenCalled()
  })

  it('전달받은 ContentBrief와 ordered reference media를 draft와 batch 경계까지 유지한다', async () => {
    const deps = dependencies()
    const contentBrief = { goal: { value: 'consultation' } } as unknown as ContentBrief
    const referenceMediaIds = ['60000000-0000-4000-8000-000000000001']

    await createConversationArtifactWorkflow({
      ...input,
      contentBrief,
      referenceMediaIds,
    }, deps)

    expect(deps.generateDraft).toHaveBeenCalledWith(expect.objectContaining({ contentBrief, referenceMediaIds }))
    expect(deps.generateBatch).toHaveBeenCalledWith(expect.objectContaining({ contentBrief, referenceMediaIds }))
  })

  it.each([false, true])('rejects original mode combined with selected-slide regeneration before any image call, cached=%s', async cached => {
    const deps = dependencies()
    if (cached) deps.findExisting.mockResolvedValueOnce(artifact)
    const reference: Extract<ArtifactReferenceResult, { ok: true }> = { ok: true, artifact, slide: artifact.slides[0] }
    await expect(createConversationArtifactWorkflow({ ...input, reference, attachmentIds: ['60000000-0000-4000-8000-000000000001'], generationMode: 'existing_media' }, deps)).rejects.toThrow('CONVERSATION_ORIGINAL_MEDIA_SELECTION_CONFLICT')
    expect(deps.regenerateSlide).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.persistRetry).not.toHaveBeenCalled()
  })

  it('labels reused attachments separately from AI-written copy', async () => {
    const deps = dependencies()
    await createConversationArtifactWorkflow({ ...input, attachmentIds: ['60000000-0000-4000-8000-000000000001'], generationMode: 'existing_media' }, deps)
    expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({
      disclosure: '사용 권리가 확인된 첨부 이미지와 AI가 작성한 문안입니다. 게시 전 내용을 확인해 주세요.',
    }) }))
  })

  it('never persists substituted image ids for an exact original photo request', async () => {
    const deps = dependencies()
    await expect(createConversationArtifactWorkflow({ ...input, attachmentIds: ['60000000-0000-4000-8000-000000000099'], generationMode: 'existing_media' }, deps)).rejects.toThrow('CONVERSATION_ORIGINAL_MEDIA_MISMATCH')
    expect(deps.persistFresh).not.toHaveBeenCalled()
  })

  it('generates a grounded draft and image batch before persisting the result', async () => {
    const deps = dependencies()

    await expect(createConversationArtifactWorkflow(input, deps)).resolves.toBe(artifact)
    expect(deps.loadContext).toHaveBeenCalledWith({ workspaceId, channel: 'instagram' })
    expect(deps.generateDraft).toHaveBeenCalledWith(expect.objectContaining({
      prompt: input.prompt,
      context: expect.objectContaining({ businessName: '바이름' }),
      imageCount: input.count,
    }))
    expect(deps.generateBatch).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }))
    expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({ draft, batch }))
  })

  it('persists the API-only generation mode for a fresh Naver artifact', async () => {
    const deps = dependencies()

    await createConversationArtifactWorkflow({
      ...input,
      prompt: '바이름 네이버 블로그 글과 이미지 7장을 API로 만들어줘',
      channel: 'naver_blog',
      count: 7,
      generationMode: 'api_only',
    }, deps)

    expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
      generationMode: 'api_only',
    }))
  })

  it('forwards the isolated image transport to the image batch only', async () => {
    const deps = dependencies()
    const onSlideProgress = vi.fn()
    const imageSubrequest = { origin: 'https://example.com', cookie: 'session=opaque' }

    await createConversationArtifactWorkflow({
      ...input,
      count: 2,
      imageSubrequest,
      onSlideProgress,
    }, deps)

    expect(deps.generateDraft).not.toHaveBeenCalledWith(expect.objectContaining({ imageSubrequest }))
    expect(deps.generateBatch).toHaveBeenCalledWith(expect.objectContaining({
      imageSubrequest,
      onSlideProgress,
    }))
  })

  it('returns an existing request before any provider call', async () => {
    const deps = dependencies()
    deps.findExisting.mockResolvedValueOnce(artifact)

    await expect(createConversationArtifactWorkflow(input, deps)).resolves.toBe(artifact)
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
  })

  it('rejects more than three images outside Naver before any provider cost', async () => {
    const deps = dependencies()
    await expect(createConversationArtifactWorkflow({ ...input, count: 12 }, deps)).rejects.toThrow('CONVERSATION_IMAGE_COUNT_INVALID')
    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
  })

  it('preserves the structured draft and regenerates only the referenced slide', async () => {
    const deps = dependencies()
    const reference: Extract<ArtifactReferenceResult, { ok: true }> = {
      ok: true,
      artifact,
      slide: artifact.slides[0],
    }

    await createConversationArtifactWorkflow({ ...input, reference }, deps)

    expect(deps.generateDraft).not.toHaveBeenCalled()
    expect(deps.generateBatch).not.toHaveBeenCalled()
    expect(deps.regenerateSlide).toHaveBeenCalledWith(expect.objectContaining({
      artifact,
      selectedSlideId: artifact.slides[0].id,
    }))
    expect(deps.persistRetry).toHaveBeenCalledWith(expect.objectContaining({
      artifact,
      selectedSlideId: artifact.slides[0].id,
      batch,
    }))
  })

  describe('post-generation guard against info-request captions', () => {
    const infoRequestDraft: InstagramDraft = Object.freeze({
      caption: '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요. 이벤트명, 진행 기간을 알려주시면 작성해 드려요.',
      hashtags: Object.freeze(['#이벤트']),
      cta: '알려주세요.',
      disclosure: '',
      observations: Object.freeze([]),
      limitations: Object.freeze([]),
      evidence: Object.freeze([]),
      unresolvedQuestions: Object.freeze([]),
    })

    const fixedTeaserDraft: InstagramDraft = Object.freeze({
      caption: '올가을 특별한 이벤트를 준비하고 있어요. [이벤트 기간] 동안 진행되니 많은 관심 부탁드려요!',
      hashtags: Object.freeze(['#이벤트', '#소희']),
      cta: '자세한 사항은 매장으로 문의해 주세요.',
      disclosure: '',
      observations: Object.freeze([]),
      limitations: Object.freeze([]),
      evidence: Object.freeze([]),
      unresolvedQuestions: Object.freeze([]),
    })

    it('regenerates once with stricter instructions when the first draft is an info-request, and persists the fixed draft', async () => {
      const deps = dependencies()
      deps.generateDraft
        .mockResolvedValueOnce(infoRequestDraft)
        .mockResolvedValueOnce(fixedTeaserDraft)

      await createConversationArtifactWorkflow(input, deps)

      expect(deps.generateDraft).toHaveBeenCalledTimes(2)
      expect(deps.generateDraft.mock.calls[1]?.[0]).toMatchObject({
        stricterInstruction: expect.stringContaining('점주에게'),
      })
      expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
        draft: fixedTeaserDraft,
      }))
    })

    it('persists the draft with needs_facts=true when the draft is still an info-request after regeneration', async () => {
      const deps = dependencies()
      deps.generateDraft
        .mockResolvedValueOnce(infoRequestDraft)
        .mockResolvedValueOnce(infoRequestDraft)

      await createConversationArtifactWorkflow(input, deps)

      expect(deps.generateDraft).toHaveBeenCalledTimes(2)
      expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({
          caption: infoRequestDraft.caption,
          needs_facts: true,
        }),
      }))
    })

    it('does not trigger regeneration if the first draft is not an info-request', async () => {
      const deps = dependencies()
      deps.generateDraft.mockResolvedValueOnce(fixedTeaserDraft)

      await createConversationArtifactWorkflow(input, deps)

      expect(deps.generateDraft).toHaveBeenCalledTimes(1)
      expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
        draft: fixedTeaserDraft,
      }))
    })

    it('deduplicates repetitive sentences and collapses duplicate CTA before persistence', async () => {
      const deps = dependencies()
      const draftWithDuplicate: InstagramDraft = Object.freeze({
        caption: '성수동 카페 소희입니다. 문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.',
        hashtags: Object.freeze(['#소희']),
        cta: '문의는 카카오톡 채널로 주세요.',
        disclosure: '',
        observations: Object.freeze([]),
        limitations: Object.freeze([]),
        evidence: Object.freeze([]),
        unresolvedQuestions: Object.freeze([]),
      })
      deps.generateDraft.mockResolvedValue(draftWithDuplicate)

      await createConversationArtifactWorkflow({
        ...input,
        prompt: '이벤트 안내. 문의는 카카오톡 채널로 주세요.',
      }, deps)

      expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
        draft: expect.objectContaining({
          caption: '성수동 카페 소희입니다. 문의는 카카오톡 채널로 주세요.',
          cta: '',
        }),
      }))
    })

    it('deduplicates paraphrased inquiry sentences for Threads drafts at the workflow choke point', async () => {
      const deps = dependencies()
      const threadsDraft: InstagramDraft = Object.freeze({
        caption:
          '이번 주 토요일, 바이름 청라점에서 소소하지만 달콤한 이벤트를 준비했어요.\n\n11월 8일(토) 하루 동안 매장에 방문해 주시는 모든 분들께 시원하고 달콤한 딸기우유 한 잔을 선물로 드려요.\n\n처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.\n\n궁금하신 점이나 상담은 카카오톡 채널로 편하게 문의해 주세요.\n\n#바이름청라점 #청라뷰티샵 #바이름 #퍼스널뷰티',
        hashtags: Object.freeze(['#바이름청라점', '#청라뷰티샵', '#바이름', '#퍼스널뷰티']),
        cta: '궁금하신 점이나 상담은 카카오톡 채널로 편하게 문의해 주세요.',
        disclosure: '',
        observations: Object.freeze([]),
        limitations: Object.freeze([]),
        evidence: Object.freeze([]),
        unresolvedQuestions: Object.freeze([]),
      })
      deps.generateDraft.mockResolvedValue(threadsDraft)

      await createConversationArtifactWorkflow({
        ...input,
        channel: 'threads',
        prompt: '스레드 이벤트 홍보해줘',
      }, deps)

      expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'threads',
        draft: expect.objectContaining({
          caption:
            '이번 주 토요일, 바이름 청라점에서 소소하지만 달콤한 이벤트를 준비했어요.\n\n11월 8일(토) 하루 동안 매장에 방문해 주시는 모든 분들께 시원하고 달콤한 딸기우유 한 잔을 선물로 드려요.\n\n처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.\n\n#바이름청라점 #청라뷰티샵 #바이름 #퍼스널뷰티',
          cta: '',
        }),
      }))
    })

    it('deduplicates Naver blog body text before persistence even when approved facts are verified', async () => {
      const deps = dependencies()
      const fact = {
        id: 'fact-1',
        workspace_id: workspaceId,
        category: 'service',
        content: '상담은 사전 문의 후 진행합니다.',
        status: 'active',
        source_candidate_id: 'source-1',
        approved_by_user_id: userId,
        approved_at: '2026-10-27T00:00:00Z',
        valid_from: '2026-10-27T00:00:00Z',
        valid_until: null,
        supersedes_fact_id: null,
        created_at: '2026-10-27T00:00:00Z',
      }
      deps.loadApprovedFacts.mockResolvedValue(resolveApprovedFacts({
        workspaceId,
        at: '2026-10-28T00:00:00Z',
        rows: [fact],
      }))
      const rawNaverDraft: NaverBlogDraft = Object.freeze({
        title: '상담 안내',
        introduction: '상담은 사전 문의 후 진행합니다. 문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.',
        sections: Object.freeze([]),
        editorBlueprint: Object.freeze([
          Object.freeze({ kind: 'paragraph' as const, text: '중복 문장입니다. 중복 문장입니다.' }),
        ]),
        keywords: Object.freeze([]),
        cta: '문의',
        disclosure: '',
        observations: Object.freeze([]),
        limitations: Object.freeze([]),
        evidence: Object.freeze([]),
        unresolvedQuestions: Object.freeze([]),
        visibility: 'public' as const,
      })
      deps.generateDraft.mockResolvedValue(rawNaverDraft)

      await createConversationArtifactWorkflow({
        ...input,
        channel: 'naver_blog',
        prompt: '네이버 블로그 이벤트 작성해줘',
      }, deps)

      expect(deps.persistFresh).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'naver_blog',
        draft: expect.objectContaining({
          introduction: '문의는 카카오톡 채널로 주세요.',
          editorBlueprint: [
            { kind: 'paragraph', text: '중복 문장입니다.' },
          ],
        }),
      }))
    })

    it('propagates contentBrief with extraDirection and count 1 to both draft and image generation callsites', async () => {
      const deps = dependencies()
      const contentBrief: ContentBrief = {
        channels: ['instagram'],
        goal: { value: 'awareness' },
        audience: { value: 'local' },
        audienceProblem: '가게 소개',
        textDirection: { structure: { value: 'short_natural' }, tone: '자연스럽게', messageAngle: '소개' },
        imageDirection: {
          mood: { value: 'workspace_style' },
          composition: '자연스러운 구도',
          sceneRoles: ['대표 장면'],
          avoid: [],
          templateId: 'workspace_style',
          modelAge: '30s',
          framing: 'upper_body',
          pose: 'front',
          background: 'bright_studio',
          textOverlay: 'none',
          extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
        },
        callToAction: { value: 'explore' },
        mustInclude: [],
        mustAvoid: [],
        referenceMediaIds: [],
      }

      await createConversationArtifactWorkflow({
        ...input,
        channel: 'instagram',
        count: 1,
        contentBrief,
      }, deps)

      // draft generation callsite에 contentBrief와 imageCount 1이 온전히 전달되는지 확증
      expect(deps.generateDraft).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'instagram',
        imageCount: 1,
        contentBrief: expect.objectContaining({
          imageDirection: expect.objectContaining({
            extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
          }),
        }),
      }))

      // image batch generation callsite에 count 1과 contentBrief가 온전히 전달되는지 확증
      expect(deps.generateBatch).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'instagram',
        count: 1,
        contentBrief: expect.objectContaining({
          imageDirection: expect.objectContaining({
            extraDirection: '이미지는1장만. 인물·얼굴·전후·효과비교 금지, 비인물일러스트',
          }),
        }),
      }))
    })
  })
})
