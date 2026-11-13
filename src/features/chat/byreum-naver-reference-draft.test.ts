import { describe, expect, it } from 'vitest'
import { parseChannelContent } from '@/features/content/channel-content-schema'
import { assessNaverContentQuality } from '@/features/content/naver-reference-quality'
import { createByreumNaverReferenceDraft } from './byreum-naver-reference-draft'

describe('BY.REUM Naver reference draft', () => {
  it('creates a private quality-gated draft from owned sources and twelve images', () => {
    const draft = createByreumNaverReferenceDraft({
      businessName: '소희', industry: null, location: null, businessSummary: null,
      brandVoice: null, keywords: [], prohibitedTerms: [],
      ownedKnowledgeSources: [
        { channel: 'naver_blog', url: 'https://blog.naver.com/larlds', status: 'collection_pending' },
        { channel: 'naver_place', url: 'https://naver.me/5xgJJEBa', status: 'collection_pending' },
      ],
    }, 12)
    const mediaIds = Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000001`)
    const content = parseChannelContent({
      channel: 'naver_blog' as const,
      title: draft.title,
      introduction: draft.introduction,
      sections: draft.sections.map((section) => ({ ...section })),
      keywords: [...draft.keywords],
      cta: draft.cta,
      imagePlacements: mediaIds.map((mediaId, index) => ({ mediaId, placement: index === 0 ? 'cover' : index === 11 ? 'action' : 'detail', altText: `이미지 ${index + 1}` })),
      editorBlocks: draft.editorBlueprint.map((block) => block.kind === 'image_slot'
        ? { kind: 'image' as const, mediaId: mediaIds[block.position - 1], altText: block.altText }
        : block),
      visibility: 'private' as const,
    })
    if (content.channel !== 'naver_blog') throw new Error('unexpected channel')

    expect(assessNaverContentQuality(content)).toMatchObject({
      ready: true,
      metrics: { imageCount: 12, highlightCount: 3, linkCount: 2 },
    })
    expect(draft.evidence).toEqual(['https://blog.naver.com/larlds', 'https://naver.me/5xgJJEBa'])
    expect(draft.visibility).toBe('public')
  })

  it('keeps the reference layout publishable for a seven-image Naver post', () => {
    const draft = createByreumNaverReferenceDraft({
      businessName: '바이름', industry: null, location: null, businessSummary: null,
      brandVoice: null, keywords: [], prohibitedTerms: [],
      ownedKnowledgeSources: [
        { channel: 'naver_blog', url: 'https://blog.naver.com/larlds', status: 'collection_pending' },
        { channel: 'naver_place', url: 'https://naver.me/5xgJJEBa', status: 'collection_pending' },
      ],
    }, 7)

    expect(draft.editorBlueprint.filter((block) => block.kind === 'image_slot')).toHaveLength(7)
    expect(draft.visibility).toBe('public')
  })
})
