import { describe, expect, it } from 'vitest'

import { assessNaverContentQuality, assessNaverReferenceQuality } from './naver-reference-quality'

describe('Naver reference-level quality gate', () => {
  it('rejects the current single-image short draft as a production-quality post', () => {
    expect(assessNaverReferenceQuality({ textCharacters: 900, imageCount: 1, highlightCount: 0, linkCount: 0 }))
      .toEqual({ ready: false, gaps: ['textCharacters', 'imageCount', 'highlightCount', 'linkCount'] })
  })

  it('accepts a dense multi-image post comparable to the Byreum reference structure', () => {
    expect(assessNaverReferenceQuality({ textCharacters: 3_200, imageCount: 15, highlightCount: 4, linkCount: 3 }))
      .toEqual({ ready: true, gaps: [] })
  })

  it('accepts an approved seven-image article when copy, highlights, and links are complete', () => {
    expect(assessNaverReferenceQuality({ textCharacters: 2_100, imageCount: 7, highlightCount: 3, linkCount: 2 }))
      .toEqual({ ready: true, gaps: [] })
  })

  it('derives reference metrics from the approved Naver content instead of caller-provided counts', () => {
    const longBody = `상담 전 확인할 내용입니다. ${'충분한 설명 '.repeat(260)} https://example.com/guide`
    expect(assessNaverContentQuality({
      channel: 'naver_blog',
      title: '인천 청라 눈썹 상담 전 확인 기준',
      introduction: `직접 확인한 내용을 정리했습니다. https://example.com/place`,
      sections: [
        { heading: '첫 번째 강조', body: longBody },
        { heading: '두 번째 강조', body: longBody },
        { heading: '세 번째 강조', body: longBody },
      ],
      keywords: ['바이름'],
      imagePlacements: Array.from({ length: 12 }, (_, index) => ({
        mediaId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        placement: index === 0 ? 'cover' as const : 'detail' as const,
        altText: `상담 이미지 ${index + 1}`,
      })),
      editorBlocks: [
        { kind: 'paragraph', text: longBody },
        { kind: 'paragraph', text: longBody },
        { kind: 'paragraph', text: longBody },
        ...Array.from({ length: 12 }, (_, index) => ({
          kind: 'image' as const,
          mediaId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          altText: `상담 이미지 ${index + 1}`,
        })),
        { kind: 'quote', text: '첫 번째 강조' },
        { kind: 'quote', text: '두 번째 강조' },
        { kind: 'quote', text: '세 번째 강조' },
        { kind: 'link', url: 'https://example.com/guide', title: '상담 안내' },
        { kind: 'link', url: 'https://example.com/place', title: '위치 안내' },
        { kind: 'cta', text: '궁금한 점을 확인해 주세요.' },
      ],
      cta: '궁금한 점을 확인해 주세요.',
    })).toMatchObject({ ready: true, gaps: [], metrics: {
      imageCount: 12, highlightCount: 3, linkCount: 2,
    } })
  })

  it('does not call a metrics-only legacy payload reference-quality ready', () => {
    expect(assessNaverContentQuality({
      channel: 'naver_blog', title: '제목', introduction: '도입 '.repeat(1_000),
      sections: Array.from({ length: 3 }, (_, index) => ({ heading: `강조 ${index + 1}`, body: '본문' })),
      keywords: ['바이름'],
      imagePlacements: Array.from({ length: 12 }, (_, index) => ({
        mediaId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        placement: index === 0 ? 'cover' as const : 'detail' as const,
        altText: `이미지 ${index + 1}`,
      })),
      cta: 'https://example.com/one https://example.com/two',
    })).toMatchObject({ ready: false, gaps: expect.arrayContaining(['editorBlocks']) })
  })
})
