import { describe, expect, it } from 'vitest'
import { channelContentSchema } from './channel-content-schema'
import { materializeNaverEditorBlocks } from './naver-editor-blocks'

describe('materializeNaverEditorBlocks', () => {
  const mediaId1 = '10000000-0000-4000-8000-000000000001'
  const mediaId2 = '10000000-0000-4000-8000-000000000002'
  const mediaId3 = '10000000-0000-4000-8000-000000000003'

  const samplePlacements = [
    { mediaId: mediaId1, placement: 'cover', altText: '첫번째 이미지 설명' },
    { mediaId: mediaId2, placement: 'inline', altText: '두번째 이미지 설명' },
    { mediaId: mediaId3, placement: 'inline', altText: '세번째 이미지 설명' },
  ]

  const sampleBlueprint = [
    { kind: 'heading', text: '자연스러운 눈썹 시술 안내' },
    { kind: 'image_slot', position: 1, altText: '표지 슬롯 설명' },
    { kind: 'paragraph', text: '시술 전 주의사항을 확인하세요.' },
    { kind: 'image_slot', position: 2, altText: '' },
    { kind: 'quote', text: '고객 만족 후기' },
    { kind: 'image_slot', position: 3, altText: '디테일 슬롯 설명' },
    { kind: 'cta', text: '예약 문의하기' },
    { kind: 'link', url: 'https://example.com/booking', title: '예약 링크' },
    { kind: 'map', placeName: '바이름 청라점' },
  ]

  it('materializes blueprint and placements correctly', () => {
    const blocks = materializeNaverEditorBlocks(sampleBlueprint, samplePlacements)

    expect(blocks).toEqual([
      { kind: 'heading', text: '자연스러운 눈썹 시술 안내' },
      { kind: 'image', mediaId: mediaId1, altText: '표지 슬롯 설명' },
      { kind: 'paragraph', text: '시술 전 주의사항을 확인하세요.' },
      { kind: 'image', mediaId: mediaId2, altText: '두번째 이미지 설명' }, // falls back to placement altText
      { kind: 'quote', text: '고객 만족 후기' },
      { kind: 'image', mediaId: mediaId3, altText: '디테일 슬롯 설명' },
      { kind: 'cta', text: '예약 문의하기' },
      { kind: 'link', url: 'https://example.com/booking', title: '예약 링크' },
      { kind: 'map', placeName: '바이름 청라점' },
    ])
  })

  it('satisfies naverBlogContentSchema order and refinement rules in a round-trip', () => {
    const blocks = materializeNaverEditorBlocks(sampleBlueprint, samplePlacements)

    const fullContent = {
      channel: 'naver_blog',
      title: '블로그 포스팅 제목',
      introduction: '도입부 텍스트입니다.',
      sections: [{ heading: '섹션 1', body: '섹션 본문 내용입니다.' }],
      keywords: ['눈썹', '반영구'],
      imagePlacements: samplePlacements,
      editorBlocks: blocks,
      cta: '지금 상담받으세요.',
      visibility: 'public',
      categoryId: null,
    }

    const parsed = channelContentSchema.safeParse(fullContent)
    expect(parsed.success).toBe(true)
  })

  it('throws on non-array input', () => {
    expect(() => materializeNaverEditorBlocks(null as any, samplePlacements)).toThrow(
      '네이버 편집 블록 입력을 확인해 주세요.',
    )
    expect(() => materializeNaverEditorBlocks(sampleBlueprint, {} as any)).toThrow(
      '네이버 편집 블록 입력을 확인해 주세요.',
    )
  })

  it('throws when blueprint length or placement count is outside allowed limits', () => {
    expect(() => materializeNaverEditorBlocks([], samplePlacements)).toThrow(
      '네이버 편집 블록 수를 확인해 주세요.',
    )
    expect(() => materializeNaverEditorBlocks(sampleBlueprint, [])).toThrow(
      '네이버 편집 블록 수를 확인해 주세요.',
    )
  })

  it('throws when slot positions are not contiguous 1..N', () => {
    const outOfOrderBlueprint = [
      { kind: 'image_slot', position: 2, altText: '두번째' },
      { kind: 'image_slot', position: 1, altText: '첫번째' },
    ]
    expect(() => materializeNaverEditorBlocks(outOfOrderBlueprint, samplePlacements.slice(0, 2))).toThrow(
      '네이버 이미지 자리 순서를 확인해 주세요.',
    )
  })

  it('throws when total slots do not match placements length', () => {
    const insufficientSlots = [
      { kind: 'paragraph', text: '본문' },
      { kind: 'image_slot', position: 1, altText: '첫번째' },
    ]
    expect(() => materializeNaverEditorBlocks(insufficientSlots, samplePlacements)).toThrow(
      '네이버 이미지 자리가 승인 이미지 수와 일치하지 않습니다.',
    )
  })

  it('throws on unsupported block kind', () => {
    const unknownKindBlueprint = [
      { kind: 'table', data: [] },
      { kind: 'image_slot', position: 1, altText: '첫번째' },
    ]
    expect(() =>
      materializeNaverEditorBlocks(unknownKindBlueprint, samplePlacements.slice(0, 1)),
    ).toThrow('지원하지 않는 네이버 편집 블록입니다.')
  })

  it('throws on invalid text or link blocks', () => {
    expect(() =>
      materializeNaverEditorBlocks(
        [{ kind: 'paragraph', text: '   ' }, { kind: 'image_slot', position: 1, altText: '1' }],
        samplePlacements.slice(0, 1),
      ),
    ).toThrow('네이버 텍스트 블록 내용을 확인해 주세요.')

    expect(() =>
      materializeNaverEditorBlocks(
        [{ kind: 'link', url: 'http://insecure.com', title: '링크' }, { kind: 'image_slot', position: 1, altText: '1' }],
        samplePlacements.slice(0, 1),
      ),
    ).toThrow('네이버 링크 블록 내용을 확인해 주세요.')
  })

  it('throws when altText is completely missing for a slot', () => {
    expect(() =>
      materializeNaverEditorBlocks(
        [{ kind: 'image_slot', position: 1, altText: '' }],
        [{ mediaId: mediaId1, placement: 'cover', altText: '' }],
      ),
    ).toThrow('네이버 이미지 자리 내용을 확인해 주세요.')
  })
})
