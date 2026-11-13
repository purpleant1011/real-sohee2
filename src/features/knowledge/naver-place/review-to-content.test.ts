import { describe, expect, it } from 'vitest'
import {
  generateReviewContent,
  type ReviewContentInput,
} from './review-to-content'

describe('generateReviewContent', () => {
  it('generates instagram caption and threads text based on place review facts', () => {
    const input: ReviewContentInput = {
      businessName: '바이름 청라점',
      location: '인천 청라',
      rating: 4.98,
      reviewCount: 87,
      highlights: ['25년 경력 원장 직접 시술', '하루 3명 예약제', '꼼꼼하고 자연스러운 손길'],
    }

    const result = generateReviewContent(input)

    expect(result.options).toHaveLength(3)
    expect(result.options[0].style).toBe('gratitude')
    expect(result.options[0].instagramCaption).toContain('바이름')
    expect(result.options[0].instagramCaption).toContain('4.98')
    expect(result.options[0].threadsText).toContain('바이름')
    expect(result.options[0].threadsText.length).toBeLessThanOrEqual(500)
    expect(result.options[0].hashtags).toContain('#바이름후기')
    expect(result.options[0].hashtags).toContain('#네이버평점4_98')

    expect(result.options[1].style).toBe('trust')
    expect(result.options[2].style).toBe('conversation')
  })

  it('fails closed and does not invent rating or hashtags when rating is null or omitted', () => {
    const input: ReviewContentInput = {
      businessName: '로즈헤어스튜디오',
      location: '서울 강남',
      rating: null,
      reviewCount: null,
    }

    const result = generateReviewContent(input)

    expect(result.options).toHaveLength(3)
    for (const option of result.options) {
      // 4.98 또는 5.0 만점 등 허위 평점을 일체 날조하지 않아야 함
      expect(option.instagramCaption).not.toContain('4.98')
      expect(option.instagramCaption).not.toContain('5.0점 만점')
      expect(option.threadsText).not.toContain('4.98')
      expect(option.threadsText).not.toContain('5.0점')
      expect(option.title).not.toContain('4.98')
      expect(option.title).not.toContain('5.0점')

      // 평점 해시태그 날조 방지
      for (const tag of option.hashtags) {
        expect(tag).not.toMatch(/#네이버평점/)
      }
    }
  })

  it('does not leak Byreum or 25-year history fixtures into other businesses', () => {
    const input: ReviewContentInput = {
      businessName: '모던네일샵',
      location: '수원 영통',
      rating: 4.8,
      reviewCount: 12,
    }

    const result = generateReviewContent(input)

    for (const option of result.options) {
      expect(option.instagramCaption).not.toContain('바이름')
      expect(option.instagramCaption).not.toContain('25년')
      expect(option.threadsText).not.toContain('바이름')
      expect(option.threadsText).not.toContain('25년')
      expect(option.title).not.toContain('25년')
    }
  })

  it('does not inject beauty/eyebrow/salon phrases or beauty shop hashtags for non-Byreum cafe', () => {
    const input: ReviewContentInput = {
      businessName: '연남 디저트 카페',
      location: '서울 마포구 연남동',
      industry: '카페',
      rating: 4.95,
      reviewCount: 45,
    }

    const result = generateReviewContent(input)

    expect(result.options).toHaveLength(3)
    for (const option of result.options) {
      // 뷰티/눈썹/원장님 손길/시술/골격 등 특화 문구 미주입 검증
      expect(option.instagramCaption).not.toContain('원장님 손길')
      expect(option.instagramCaption).not.toContain('공장형 시술')
      expect(option.instagramCaption).not.toContain('골격')
      expect(option.instagramCaption).not.toContain('결을')
      expect(option.instagramCaption).not.toContain('눈매')
      expect(option.instagramCaption).not.toContain('시술')
      expect(option.instagramCaption).not.toContain('1인샵')

      expect(option.threadsText).not.toContain('1인샵')
      expect(option.threadsText).not.toContain('공장형 시술')
      expect(option.threadsText).not.toContain('골격')
      expect(option.threadsText).not.toContain('눈매')
      expect(option.threadsText).not.toContain('결 케어')

      // 해시태그에 무조건 '뷰티샵' 접미사 고정 부여 방지
      for (const tag of option.hashtags) {
        expect(tag).not.toContain('뷰티샵')
        expect(tag).not.toContain('눈썹')
      }
    }
  })

  it('omits location hashtags when location is missing or empty', () => {
    const input: ReviewContentInput = {
      businessName: '어반 랩',
      location: '',
      rating: 4.8,
    }

    const result = generateReviewContent(input)

    for (const option of result.options) {
      for (const tag of option.hashtags) {
        expect(tag).not.toContain('뷰티샵')
        expect(tag).not.toContain('청라')
      }
    }
  })

  it('fails closed with empty options or throws when businessName is missing', () => {
    const input: ReviewContentInput = {
      businessName: '',
      location: '서울',
    }

    expect(() => generateReviewContent(input)).toThrow('BUSINESS_NAME_REQUIRED')
  })
})
