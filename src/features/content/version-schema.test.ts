import { describe, expect, it } from 'vitest'
import { revisionInputSchema, versionSchema } from './version-schema'
import { buildBlogStrategyBrief } from './blog-strategy-brief'
import { marketingStrategyFixture } from './blog-strategy-brief.fixture'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const contentId = '22222222-2222-4222-8222-222222222222'
const versionId = '33333333-3333-4333-8333-333333333333'

function mediaId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function validVersionInput() {
  return {
    workspaceId,
    contentId,
    channel: 'instagram' as const,
    caption: '새로운 소식을 전해요.',
    hashtags: ['#소희', '#콘텐츠'],
    disclosure: '예시 콘텐츠입니다.',
    rightsConfirmed: true as const,
    generationEvidenceConfirmed: true as const,
    mediaIds: [mediaId(1)],
    revisionReason: '표현을 더 명확하게 다듬었어요.',
  }
}

function validRevisionInput() {
  return {
    workspaceId,
    contentId,
    versionId,
    channel: 'instagram' as const,
    instruction: '더 따뜻한 말투로 수정해 줘.',
    inputType: 'caption' as const,
    currentVersionFingerprint: 'a'.repeat(64),
  }
}

describe('versionSchema', () => {
  it('rejects a foreign-workspace strategy on a new Naver version', () => {
    const strategyBrief = buildBlogStrategyBrief(marketingStrategyFixture, marketingStrategyFixture)
    const input = {
      ...validVersionInput(), channel: 'naver_blog', structuredPayload: {
        channel: 'naver_blog', title: '안내', introduction: '도입',
        sections: [{ heading: '상담', body: '본문' }], keywords: ['상담'],
        imagePlacements: [{ mediaId: mediaId(1), placement: 'cover', altText: '사진' }],
        cta: '문의', strategyBrief,
      },
    }
    expect(versionSchema.safeParse(input).success).toBe(false)
    const scoped = { ...marketingStrategyFixture, workspaceId }
    expect(versionSchema.safeParse({
      ...input, structuredPayload: { ...input.structuredPayload, strategyBrief: buildBlogStrategyBrief(scoped, scoped) },
    }).success).toBe(true)
  })

  it('rejects foreign-workspace approved fact provenance', () => {
    const input = { ...validVersionInput(), channel: 'naver_blog', structuredPayload: {
      channel: 'naver_blog', title: '안내', introduction: '도입', sections: [{ heading: '안내', body: '본문' }], keywords: ['안내'],
      imagePlacements: [{ mediaId: mediaId(1), placement: 'cover', altText: '사진' }], cta: '문의',
      factBasis: { workspaceId: contentId, snapshotHash: 'a'.repeat(64), resolvedAt: '2026-10-28T00:00:00Z', sources: [] },
    } }
    expect(versionSchema.safeParse(input).success).toBe(false)
    expect(versionSchema.safeParse({ ...input, structuredPayload: { ...input.structuredPayload, factBasis: { ...input.structuredPayload.factBasis, workspaceId } } }).success).toBe(true)
  })

  it('accepts the exact text and collection boundaries', () => {
    const input = {
      ...validVersionInput(),
      caption: '가'.repeat(2_200),
      hashtags: Array.from({ length: 30 }, (_, index) => `#태그${index}`),
      disclosure: '나'.repeat(500),
      mediaIds: Array.from({ length: 10 }, (_, index) => mediaId(index + 1)),
      revisionReason: '다'.repeat(500),
    }

    expect(versionSchema.safeParse(input).success).toBe(true)
    expect(versionSchema.safeParse({ ...input, mediaIds: [mediaId(1)] }).success).toBe(true)
  })

  it.each([
    ['caption', { caption: '' }],
    ['revision reason', { revisionReason: '' }],
  ])('rejects a missing-length %s', (_label, override) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), ...override }).success).toBe(false)
  })

  it.each([
    ['caption', { caption: ' \n\t ' }],
    ['revision reason', { revisionReason: '\t \n' }],
  ])('rejects a whitespace-only %s', (_label, override) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), ...override }).success).toBe(false)
  })

  it.each([
    ['caption', { caption: '가'.repeat(2_201) }],
    ['disclosure', { disclosure: '나'.repeat(501) }],
    ['revision reason', { revisionReason: '다'.repeat(501) }],
  ])('rejects a %s one character over its limit', (_label, override) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), ...override }).success).toBe(false)
  })

  it.each([
    ['missing hash', ['소희']],
    ['embedded whitespace', ['#소 희']],
    ['second hash', ['#소#희']],
    ['only a hash', ['#']],
    ['too many hashtags', Array.from({ length: 31 }, (_, index) => `#태그${index}`)],
  ])('rejects hashtags with %s', (_label, hashtags) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), hashtags }).success).toBe(false)
  })

  it.each([
    ['rights confirmation set to false', { rightsConfirmed: false }],
    ['generation evidence confirmation set to false', { generationEvidenceConfirmed: false }],
    ['rights confirmation missing', { rightsConfirmed: undefined }],
    ['generation evidence confirmation missing', { generationEvidenceConfirmed: undefined }],
  ])('rejects %s', (_label, override) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), ...override }).success).toBe(false)
  })

  it.each([
    ['eleven media items', Array.from({ length: 11 }, (_, index) => mediaId(index + 1))],
    ['a duplicate media item', [mediaId(1), mediaId(2), mediaId(1)]],
    ['a malformed media ID', [mediaId(1), 'not-a-uuid']],
  ])('rejects %s', (_label, mediaIds) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), mediaIds }).success).toBe(false)
  })

  it('allows a text-only Threads version but still requires media for Instagram', () => {
    expect(
      versionSchema.safeParse({ ...validVersionInput(), channel: 'threads', mediaIds: [] }).success,
    ).toBe(true)
    expect(versionSchema.safeParse({ ...validVersionInput(), mediaIds: [] }).success).toBe(false)
  })

  it('allows twelve ordered media items only for a structured Naver Blog version', () => {
    const mediaIds = Array.from({ length: 12 }, (_, index) => mediaId(index + 1))
    const naver = {
      ...validVersionInput(), channel: 'naver_blog' as const, mediaIds,
      structuredPayload: {
        channel: 'naver_blog' as const, title: '상세 후기', introduction: '충분한 도입',
        sections: [{ heading: '강조 구간', body: '상세 본문' }], keywords: ['바이름'],
        imagePlacements: mediaIds.map((id, index) => ({
          mediaId: id, placement: index === 0 ? 'cover' as const : 'detail' as const,
          altText: `상담 이미지 ${index + 1}`,
        })),
        cta: '문의해 주세요.',
      },
    }
    expect(versionSchema.safeParse(naver).success).toBe(true)
    expect(versionSchema.safeParse({ ...validVersionInput(), mediaIds }).success).toBe(false)
  })

  it('rejects the same media UUID when only letter casing differs', () => {
    const lowercaseMediaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const uppercaseMediaId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'

    expect(
      versionSchema.safeParse({ ...validVersionInput(), mediaIds: [lowercaseMediaId] }).success,
    ).toBe(true)
    expect(
      versionSchema.safeParse({ ...validVersionInput(), mediaIds: [uppercaseMediaId] }).success,
    ).toBe(true)
    expect(
      versionSchema.safeParse({
        ...validVersionInput(),
        mediaIds: [lowercaseMediaId, uppercaseMediaId],
      }).success,
    ).toBe(false)
  })

  it('preserves the original casing and order of distinct media UUIDs', () => {
    const mediaIds = [
      'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ]

    expect(versionSchema.parse({ ...validVersionInput(), mediaIds }).mediaIds).toEqual(mediaIds)
  })

  it.each([
    ['workspace ID', { workspaceId: 'not-a-uuid' }],
    ['content ID', { contentId: 'not-a-uuid' }],
  ])('rejects a malformed %s', (_label, override) => {
    expect(versionSchema.safeParse({ ...validVersionInput(), ...override }).success).toBe(false)
  })

  it('rejects a missing required field', () => {
    const missingCaption: Partial<ReturnType<typeof validVersionInput>> = validVersionInput()
    delete missingCaption.caption

    expect(versionSchema.safeParse(missingCaption).success).toBe(false)
  })

  it('preserves non-empty leading and trailing whitespace', () => {
    const input = {
      ...validVersionInput(),
      caption: '  본문 \n',
      revisionReason: '\t수정 이유  ',
    }

    const parsed = versionSchema.parse(input)

    expect(parsed.caption).toBe(input.caption)
    expect(parsed.revisionReason).toBe(input.revisionReason)
  })

  it('requires a channel-matched structured payload and retains harness and knowledge IDs', () => {
    const input = {
      ...validVersionInput(),
      structuredPayload: {
        channel: 'instagram' as const,
        caption: '새로운 소식을 전해요.',
        hashtags: ['#소희', '#콘텐츠'],
        slides: [
          {
            mediaId: mediaId(1),
            placement: 'cover' as const,
            altText: '새 소식 표지 이미지',
          },
        ],
        cta: '상담을 예약해 주세요.',
      },
      knowledgeIds: ['70000000-0000-4000-8000-000000000001'],
      harnessRuleIds: ['80000000-0000-4000-8000-000000000001'],
    }

    const parsed = versionSchema.parse(input)

    expect(parsed.structuredPayload).toEqual(input.structuredPayload)
    expect(parsed.knowledgeIds).toEqual(input.knowledgeIds)
    expect(parsed.harnessRuleIds).toEqual(input.harnessRuleIds)
    expect(
      versionSchema.safeParse({ ...input, channel: 'threads' }).success,
    ).toBe(false)
    expect(
      versionSchema.safeParse({ ...input, mediaIds: [mediaId(2)] }).success,
    ).toBe(false)
  })
})

describe('revisionInputSchema', () => {
  it('accepts an instruction and fingerprint at their exact boundaries', () => {
    expect(
      revisionInputSchema.safeParse({
        ...validRevisionInput(),
        instruction: '가'.repeat(2_000),
        currentVersionFingerprint: '0123456789abcdef'.repeat(4),
      }).success,
    ).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \n\t '],
    ['one character over the limit', '가'.repeat(2_001)],
  ])('rejects a %s instruction', (_label, instruction) => {
    expect(
      revisionInputSchema.safeParse({ ...validRevisionInput(), instruction }).success,
    ).toBe(false)
  })

  it('preserves non-empty leading and trailing instruction whitespace', () => {
    const input = { ...validRevisionInput(), instruction: '  보다 짧게 \n' }

    expect(revisionInputSchema.parse(input).instruction).toBe(input.instruction)
  })

  it.each([
    ['workspace ID', { workspaceId: 'not-a-uuid' }],
    ['content ID', { contentId: 'not-a-uuid' }],
    ['version ID', { versionId: 'not-a-uuid' }],
    ['channel', { channel: 'facebook' }],
    ['input type', { inputType: 'image' }],
    ['uppercase fingerprint', { currentVersionFingerprint: 'A'.repeat(64) }],
    ['short fingerprint', { currentVersionFingerprint: 'a'.repeat(63) }],
    ['long fingerprint', { currentVersionFingerprint: 'a'.repeat(65) }],
    ['non-hex fingerprint', { currentVersionFingerprint: 'g'.repeat(64) }],
  ])('rejects a malformed %s', (_label, override) => {
    expect(revisionInputSchema.safeParse({ ...validRevisionInput(), ...override }).success).toBe(
      false,
    )
  })

  it.each(['instagram', 'threads'] as const)('accepts the %s channel', (channel) => {
    expect(revisionInputSchema.safeParse({ ...validRevisionInput(), channel }).success).toBe(true)
  })

  it.each(['caption', 'hashtags', 'disclosure', 'full'] as const)(
    'accepts the %s input type',
    (inputType) => {
      expect(revisionInputSchema.safeParse({ ...validRevisionInput(), inputType }).success).toBe(
        true,
      )
    },
  )
})
