import { describe, expect, it } from 'vitest'
import {
  buildNaverStepSequence,
  type NaverStepSequenceInput,
} from './naver-step-sequence'

describe('buildNaverStepSequence', () => {
  it('텍스트와 이미지가 교차할 때 올바른 구간·사진 순서로 스텝을 생성한다', () => {
    const input: NaverStepSequenceInput = {
      title: '청라 피부관리 후기',
      blocks: [
        { kind: 'heading', text: '1. 맞춤 관리 시작' },
        { kind: 'paragraph', text: '첫 방문 상담을 진행했습니다.' },
        { kind: 'image', mediaId: 'img-1', altText: '상담실 사진' },
        { kind: 'heading', text: '2. 시술 진행' },
        { kind: 'paragraph', text: '꼼꼼하게 케어해 주셨어요.' },
        { kind: 'image', mediaId: 'img-2', altText: '케어 룸' },
        { kind: 'paragraph', text: '마무리 팩까지 완벽했습니다.' },
        { kind: 'cta', text: '예약 문의는 프로필 링크를 확인해 주세요.' },
      ],
      media: [
        { id: 'img-1', src: 'https://example.com/1.jpg', altText: '상담실' },
        { id: 'img-2', src: 'https://example.com/2.jpg', altText: '케어' },
      ],
      keywords: ['청라피부관리', '피부케어'],
      disclosure: '소정의 원고료를 지원받아 작성되었습니다.',
    }

    const { steps, missingPhotos } = buildNaverStepSequence(input)

    expect(missingPhotos).toEqual([])
    expect(steps).toHaveLength(7)

    // 1. 제목
    expect(steps[0]).toEqual({
      type: 'title',
      text: '청라 피부관리 후기',
    })

    // 2. 텍스트 1
    expect(steps[1]).toEqual({
      type: 'text',
      segmentIndex: 1,
      segmentCount: 3,
      heading: '1. 맞춤 관리 시작',
      text: '1. 맞춤 관리 시작\n\n첫 방문 상담을 진행했습니다.',
      previewText: '첫 방문 상담을 진행했습니다.',
    })

    // 3. 이미지 1
    expect(steps[2]).toEqual({
      type: 'image',
      photoIndex: 1,
      mediaId: 'img-1',
      src: 'https://example.com/1.jpg',
      alt: '상담실 사진',
      positionHint: '위 글을 붙여넣은 다음 사진 1을 넣어 주세요',
    })

    // 4. 텍스트 2
    expect(steps[3]).toEqual({
      type: 'text',
      segmentIndex: 2,
      segmentCount: 3,
      heading: '2. 시술 진행',
      text: '2. 시술 진행\n\n꼼꼼하게 케어해 주셨어요.',
      previewText: '꼼꼼하게 케어해 주셨어요.',
    })

    // 5. 이미지 2
    expect(steps[4]).toEqual({
      type: 'image',
      photoIndex: 2,
      mediaId: 'img-2',
      src: 'https://example.com/2.jpg',
      alt: '케어 룸',
      positionHint: '위 글을 붙여넣은 다음 사진 2를 넣어 주세요',
    })

    // 6. 텍스트 3 (마지막 구간에 disclosure 포함)
    expect(steps[5]).toEqual({
      type: 'text',
      segmentIndex: 3,
      segmentCount: 3,
      heading: undefined,
      text: '마무리 팩까지 완벽했습니다.\n\n예약 문의는 프로필 링크를 확인해 주세요.\n\n소정의 원고료를 지원받아 작성되었습니다.',
      previewText: '마무리 팩까지 완벽했습니다.\n\n예약 문의는 프로필 링크를 확인해 주세요.\n\n소정의 원고료를 지원받아 작성되었습니다.',
    })

    // 7. 태그
    expect(steps[6]).toEqual({
      type: 'tags',
      text: '#청라피부관리 #피부케어',
      count: 2,
    })
  })

  it('연속된 이미지 블록이 있어도 빈 텍스트 구간 없이 순서대로 처리한다', () => {
    const input: NaverStepSequenceInput = {
      title: '제목',
      blocks: [
        { kind: 'paragraph', text: '첫 번째 글' },
        { kind: 'image', mediaId: 'img-1', altText: '사진 1' },
        { kind: 'image', mediaId: 'img-2', altText: '사진 2' },
        { kind: 'paragraph', text: '두 번째 글' },
      ],
      media: [
        { id: 'img-1', src: 'https://example.com/1.jpg' },
        { id: 'img-2', src: 'https://example.com/2.jpg' },
      ],
      keywords: ['태그'],
    }

    const { steps } = buildNaverStepSequence(input)

    expect(steps).toHaveLength(6)
    expect(steps[0].type).toBe('title')
    expect(steps[1]).toMatchObject({
      type: 'text',
      segmentIndex: 1,
      segmentCount: 2,
      text: '첫 번째 글',
    })
    expect(steps[2]).toMatchObject({
      type: 'image',
      photoIndex: 1,
      mediaId: 'img-1',
    })
    expect(steps[3]).toMatchObject({
      type: 'image',
      photoIndex: 2,
      mediaId: 'img-2',
    })
    expect(steps[4]).toMatchObject({
      type: 'text',
      segmentIndex: 2,
      segmentCount: 2,
      text: '두 번째 글',
    })
    expect(steps[5].type).toBe('tags')
  })

  it('이미지가 전혀 없을 때 단일 텍스트 구간으로 생성된다', () => {
    const input: NaverStepSequenceInput = {
      title: '글만 있는 글',
      blocks: [
        { kind: 'heading', text: '소제목' },
        { kind: 'paragraph', text: '본문 내용' },
      ],
      keywords: ['글'],
      disclosure: '원고료 지원',
    }

    const { steps } = buildNaverStepSequence(input)

    expect(steps).toHaveLength(3)
    expect(steps[0].type).toBe('title')
    expect(steps[1]).toEqual({
      type: 'text',
      segmentIndex: 1,
      segmentCount: 1,
      heading: '소제목',
      text: '소제목\n\n본문 내용\n\n원고료 지원',
      previewText: '본문 내용\n\n원고료 지원',
    })
    expect(steps[2].type).toBe('tags')
  })

  it('keywords에 가운뎃점·특수문자가 포함된 경우 정규화된 태그 텍스트와 개수를 반환한다', () => {
    const input: NaverStepSequenceInput = {
      title: '제목',
      blocks: [{ kind: 'paragraph', text: '본문' }],
      keywords: ['인천미용·네일·뷰티', '#청라_에스테틱'],
    }

    const { steps } = buildNaverStepSequence(input)

    const tagStep = steps.find((s) => s.type === 'tags')
    expect(tagStep).toEqual({
      type: 'tags',
      text: '#인천미용 #네일 #뷰티 #청라 #에스테틱',
      count: 5,
    })
  })

  it('media에 없는 mediaId는 건너뛰고 missingPhotos로 반환한다', () => {
    const input: NaverStepSequenceInput = {
      title: '제목',
      blocks: [
        { kind: 'paragraph', text: '글' },
        { kind: 'image', mediaId: 'missing-id', altText: '누락' },
        { kind: 'image', mediaId: 'img-1', altText: '정상' },
      ],
      media: [{ id: 'img-1', src: 'https://example.com/1.jpg' }],
    }

    const { steps, missingPhotos } = buildNaverStepSequence(input)

    expect(missingPhotos).toEqual(['missing-id'])
    const imageSteps = steps.filter((s) => s.type === 'image')
    expect(imageSteps).toHaveLength(1)
    expect(imageSteps[0]).toMatchObject({
      type: 'image',
      photoIndex: 1,
      mediaId: 'img-1',
    })
  })

  it('지도와 링크 블록은 텍스트 구간에 포함된다', () => {
    const input: NaverStepSequenceInput = {
      title: '방문 안내',
      blocks: [
        { kind: 'paragraph', text: '위치 안내' },
        { kind: 'map', placeName: '청라에스테틱' },
        { kind: 'link', title: '예약 페이지', url: 'https://booking.example.com' },
      ],
      keywords: ['지도', '예약'],
    }

    const { steps } = buildNaverStepSequence(input)

    const textStep = steps.find((s) => s.type === 'text')
    expect(textStep).toBeDefined()
    if (textStep && textStep.type === 'text') {
      expect(textStep.text).toContain('청라에스테틱')
      expect(textStep.text).toContain('예약 페이지 (https://booking.example.com)')
    }
  })

  it('태그가 없을 때도 태그 스텝을 생성하며 count는 0이다', () => {
    const input: NaverStepSequenceInput = {
      title: '제목',
      blocks: [{ kind: 'paragraph', text: '본문' }],
    }

    const { steps } = buildNaverStepSequence(input)

    const tagStep = steps.find((s) => s.type === 'tags')
    expect(tagStep).toEqual({
      type: 'tags',
      text: '',
      count: 0,
    })
  })
})
