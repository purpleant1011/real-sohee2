import { describe, expect, it } from 'vitest'
import { channelContentSchema, normalizeNaverPublicCopy, normalizeNaverPublicText, normalizeStoredChannelPayload, naverPublishSettings } from './channel-content-schema'

import { buildBlogStrategyBrief } from './blog-strategy-brief'
import { marketingStrategyFixture } from './blog-strategy-brief.fixture'

describe('channelContentSchema', () => {
  it('keeps strategy provenance when parsing and normalizing a stored Naver version', () => {
    const strategyBrief = buildBlogStrategyBrief(marketingStrategyFixture, marketingStrategyFixture)
    const stored = {
      channel: 'naver_blog', title: '안내', introduction: '도입',
      sections: [{ heading: '상담', body: '본문' }], keywords: ['상담'],
      imagePlacements: [{ mediaId: '00000000-0000-4000-8000-000000000001', placement: 'cover', altText: '사진' }],
      cta: '문의', strategyBrief,
    }
    const parsed = channelContentSchema.parse(normalizeStoredChannelPayload(stored))
    expect(normalizeNaverPublicCopy(parsed)).toMatchObject({ strategyBrief })
    expect(channelContentSchema.safeParse({ ...stored, strategyBrief: { ...strategyBrief, schemaVersion: 99 } }).success).toBe(false)
  })

  it('accepts the post plan (format, reaction, image style) stored with a Naver version', () => {
    const payload = {
      channel: 'naver_blog', title: '안내', introduction: '도입', sections: [{ heading: '안내', body: '본문' }], keywords: ['안내'],
      imagePlacements: [{ mediaId: '00000000-0000-4000-8000-000000000001', placement: 'cover', altText: '사진' }],
      cta: '문의', postMode: 'photo_story', reaction: 'inquiry', imageStyle: 'bright_space',
    }
    expect(channelContentSchema.parse(normalizeStoredChannelPayload(payload))).toMatchObject({ postMode: 'photo_story', reaction: 'inquiry', imageStyle: 'bright_space' })
    expect(channelContentSchema.safeParse({ ...payload, postMode: 'unknown_mode' }).success).toBe(false)
  })

  it('preserves approved fact provenance without presenting it as external verification', () => {
    const factBasis = { workspaceId: marketingStrategyFixture.workspaceId, snapshotHash: 'a'.repeat(64), resolvedAt: '2026-10-28T00:00:00Z', sources: [] }
    const payload = { channel: 'naver_blog', title: '안내', introduction: '도입', sections: [{ heading: '안내', body: '본문' }], keywords: ['안내'], imagePlacements: [{ mediaId: '00000000-0000-4000-8000-000000000001', placement: 'cover', altText: '사진' }], cta: '문의', factBasis }
    expect(channelContentSchema.parse(normalizeStoredChannelPayload(payload))).toMatchObject({ factBasis })
  })

  it('defaults Naver drafts to private visibility and no preselected category', () => {
    const draft = channelContentSchema.parse({
      channel: 'naver_blog',
      title: '비공개 검증 글',
      introduction: '검증 도입',
      sections: [{ heading: '검증', body: '검증 본문' }],
      keywords: ['소희'],
      imagePlacements: [{
        mediaId: '00000000-0000-4000-8000-000000000001', placement: 'cover', altText: '검증 이미지',
      }],
      cta: '문의',
    })
    if (draft.channel !== 'naver_blog') throw new Error('expected Naver draft')
    expect(naverPublishSettings(draft)).toEqual({ categoryId: null, visibility: 'private' })
  })

  it('removes private-draft wording from every public Naver text block', () => {
    const mediaId = '00000000-0000-4000-8000-000000000001'
    const publicPayload = normalizeNaverPublicCopy(channelContentSchema.parse({
      channel: 'naver_blog',
      title: '공개 안내',
      introduction: '외부 게시 전 사람이 검토하는 비공개 초안입니다.',
      sections: [{ heading: '확인 기준', body: '이 내용은 비공개 검토용 초안입니다.' }],
      keywords: ['바이름'],
      imagePlacements: [{ mediaId, placement: 'cover', altText: '첫 이미지' }],
      editorBlocks: [
        { kind: 'paragraph', text: '자동 게시되지 않는 사람 검토용 비공개 초안입니다.' },
        { kind: 'image', mediaId, altText: '첫 이미지' },
      ],
      cta: '비공개 초안을 확인해 주세요.',
      visibility: 'public',
    }))

    expect(JSON.stringify(publicPayload)).not.toContain('비공개')
    expect(publicPayload).toMatchObject({ visibility: 'public' })
    expect(normalizeNaverPublicText('외부 게시 전 사람이 검토하는 비공개 초안입니다.')).not.toContain('비공개')
  })

  it('keeps old stored values and supports four Naver visibility settings', () => {
    const base = {
      channel: 'naver_blog', title: '안내', introduction: '도입',
      sections: [{ heading: '구역', body: '본문' }], keywords: ['소희'],
      imagePlacements: [{ mediaId: '00000000-0000-4000-8000-000000000001', placement: 'cover', altText: '사진' }],
      cta: '문의',
    }
    for (const visibility of ['public', 'neighbor', 'mutual_neighbor', 'private']) {
      const parsed = channelContentSchema.parse({ ...base, visibility })
      if (parsed.channel !== 'naver_blog') throw new Error('expected Naver draft')
      expect(naverPublishSettings(parsed).visibility).toBe(visibility)
    }
    expect(channelContentSchema.safeParse({ ...base, visibility: 'unknown' }).success).toBe(false)
    expect(channelContentSchema.safeParse(base).success).toBe(true)
  })

  it('removes private-draft wording for neighbor-visible posts too', () => {
    const payload = channelContentSchema.parse({
      channel: 'naver_blog', title: '비공개 초안', introduction: '비공개 초안',
      sections: [{ heading: '구역', body: '비공개 초안' }], keywords: ['소희'],
      imagePlacements: [{ mediaId: '00000000-0000-4000-8000-000000000001', placement: 'cover', altText: '사진' }],
      cta: '비공개 초안', visibility: 'mutual_neighbor',
    })
    expect(JSON.stringify(normalizeNaverPublicCopy(payload))).not.toContain('비공개 초안')
  })

  it('requires sections and image placements for a Naver Blog draft', () => {
    expect(
      channelContentSchema.safeParse({
        channel: 'naver_blog',
        title: '청라 자연눈썹 상담 전 확인할 점',
        introduction: '상담 전에 확인하면 좋은 내용을 정리했어요.',
        sections: [],
        keywords: ['청라 자연눈썹'],
        imagePlacements: [],
        cta: '상담이 필요하면 문의해 주세요.',
      }).success,
    ).toBe(false)
  })

  it('allows a reference-level Naver image sequence while keeping Instagram at ten slides', () => {
    const placements = Array.from({ length: 12 }, (_, index) => ({
      mediaId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      placement: index === 0 ? 'cover' as const : 'detail' as const,
      altText: `상담 이미지 ${index + 1}`,
    }))
    expect(channelContentSchema.safeParse({
      channel: 'naver_blog', title: '상세 후기', introduction: '충분한 도입',
      sections: [{ heading: '강조 구간', body: '상세 본문' }], keywords: ['바이름'],
      imagePlacements: placements, cta: '문의해 주세요.',
    }).success).toBe(true)
    expect(channelContentSchema.safeParse({
      channel: 'instagram', caption: '안내', hashtags: ['#바이름'],
      slides: placements.slice(0, 11), cta: '문의해 주세요.',
    }).success).toBe(false)
  })

  it('allows empty cta string in Instagram and empty question string in Threads, but enforces nonblank caption/segments and Naver cta', () => {
    const singlePlacement = [{
      mediaId: '00000000-0000-4000-8000-000000000001',
      placement: 'cover' as const,
      altText: '테스트 이미지',
    }]

    // 1. 인스타그램: cta: '' 허용, caption: '' 거부
    const validInstagramEmptyCta = {
      channel: 'instagram',
      caption: '소희 모바일 게시 기능 점검을 위한 테스트 게시물입니다.',
      hashtags: [],
      slides: singlePlacement,
      cta: '',
    }
    expect(channelContentSchema.safeParse(validInstagramEmptyCta).success).toBe(true)
    expect(channelContentSchema.safeParse({ ...validInstagramEmptyCta, caption: '   ' }).success).toBe(false)

    // 2. 스레드: question: '' 허용, segments 빈칸 거부
    const validThreadsEmptyQuestion = {
      channel: 'threads',
      segments: ['소희 모바일 게시 기능 점검 테스트입니다.'],
      mediaIds: ['00000000-0000-4000-8000-000000000001'],
      question: '',
    }
    expect(channelContentSchema.safeParse(validThreadsEmptyQuestion).success).toBe(true)
    expect(channelContentSchema.safeParse({ ...validThreadsEmptyQuestion, segments: ['   '] }).success).toBe(false)

    // 3. 네이버 블로그: cta: '' 거부 (nonblank 필수 유지)
    const naverEmptyCta = {
      channel: 'naver_blog',
      title: '네이버 블로그 제목',
      introduction: '도입부입니다.',
      sections: [{ heading: '소제목', body: '본문 내용입니다.' }],
      keywords: ['키워드'],
      imagePlacements: singlePlacement,
      cta: '',
    }
    expect(channelContentSchema.safeParse(naverEmptyCta).success).toBe(false)
  })

  it('preserves an ordered rich Naver editor plan and rejects reordered image blocks', () => {
    const first = '00000000-0000-4000-8000-000000000001'
    const second = '00000000-0000-4000-8000-000000000002'
    const input = {
      channel: 'naver_blog' as const, title: '상세 후기', introduction: '충분한 도입',
      sections: [{ heading: '강조 구간', body: '상세 본문' }], keywords: ['바이름'],
      imagePlacements: [
        { mediaId: first, placement: 'cover' as const, altText: '첫 이미지' },
        { mediaId: second, placement: 'detail' as const, altText: '둘째 이미지' },
      ],
      editorBlocks: [
        { kind: 'paragraph' as const, text: '충분한 도입' },
        { kind: 'image' as const, mediaId: first, altText: '첫 이미지' },
        { kind: 'quote' as const, text: '중요한 확인 기준' },
        { kind: 'link' as const, url: 'https://example.com/place', title: '위치 확인' },
        { kind: 'image' as const, mediaId: second, altText: '둘째 이미지' },
        { kind: 'cta' as const, text: '문의해 주세요.' },
      ],
      cta: '문의해 주세요.',
    }
    expect(channelContentSchema.parse(input)).toMatchObject({ editorBlocks: input.editorBlocks })
    expect(channelContentSchema.safeParse({
      ...input,
      editorBlocks: input.editorBlocks.map((block) => block.kind === 'image' && block.mediaId === first
        ? { ...block, mediaId: second }
        : block.kind === 'image' ? { ...block, mediaId: first } : block),
    }).success).toBe(false)
  })

  it('removes Naver generation metadata before strict publishing parsing', () => {
    const mediaId = '00000000-0000-4000-8000-000000000001'
    const stored = {
      channel: 'naver_blog', title: '상세 후기', introduction: '충분한 도입',
      sections: [{ heading: '강조 구간', body: '상세 본문' }], keywords: ['바이름'],
      imagePlacements: [{ mediaId, placement: 'cover', altText: '첫 이미지' }],
      editorBlueprint: [{ kind: 'image_slot', position: 1, altText: '첫 이미지' }],
      generation: { mode: 'api_only', text: 'openai_responses_api', images: 'openai_images_api' },
      editorBlocks: [{ kind: 'image', mediaId, altText: '첫 이미지' }],
      cta: '문의해 주세요.', visibility: 'private',
    }
    expect(channelContentSchema.safeParse(stored).success).toBe(false)
    expect(channelContentSchema.safeParse(normalizeStoredChannelPayload(stored)).success).toBe(true)
    expect(normalizeStoredChannelPayload(stored)).not.toHaveProperty('editorBlueprint')
    expect(normalizeStoredChannelPayload(stored)).not.toHaveProperty('generation')
  })

  it('preserves the ordered media IDs supplied by an Instagram draft', () => {
    const draft = channelContentSchema.parse({
      channel: 'instagram',
      caption: '새로운 소식을 전합니다.',
      hashtags: ['#소희'],
      slides: [
        {
          mediaId: '00000000-0000-4000-8000-000000000002',
          placement: 'cover',
          altText: '상담 안내 표지',
        },
        {
          mediaId: '00000000-0000-4000-8000-000000000001',
          placement: 'detail',
          altText: '상담 안내 상세',
        },
      ],
      cta: '상담을 예약해 주세요.',
    })

    if (draft.channel !== 'instagram') throw new Error('expected Instagram draft')
    expect(draft.slides.map((slide) => slide.mediaId)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ])
  })

  it('keeps Daangn local CTA separate from the channel-neutral body', () => {
    expect(
      channelContentSchema.safeParse({
        channel: 'daangn_business',
        title: '청라동 이웃 상담 안내',
        body: '이번 주 상담 가능 시간을 알려드려요.',
        mediaIds: ['00000000-0000-4000-8000-000000000001'],
        localCta: '채팅으로 상담 시간을 물어보세요.',
        targetNeighborhood: '청라동',
      }).success,
    ).toBe(true)
  })
})
