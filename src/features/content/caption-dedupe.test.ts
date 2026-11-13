import { describe, expect, it } from 'vitest'
import {
  collapseDuplicateCta,
  dedupeCaption,
  dedupeDraft,
  normalizeSentence,
} from './caption-dedupe'
import type { InstagramDraft } from '@/features/chat/instagram-draft-provider'
import type { NaverBlogDraft } from '@/features/chat/naver-blog-draft-provider'

describe('caption-dedupe', () => {
  describe('normalizeSentence', () => {
    it('normalizes whitespace, punctuation, symbols, and emoji', () => {
      expect(normalizeSentence('문의는 카카오톡 채널로 주세요.')).toBe('문의는카카오톡채널로주세요')
      expect(normalizeSentence('문의는 카카오톡 채널로 주세요!')).toBe('문의는카카오톡채널로주세요')
      expect(normalizeSentence('문의는 카카오톡 채널로 주세요~ 😊')).toBe('문의는카카오톡채널로주세요')
      expect(normalizeSentence('문의는 카카오톡채널로 주세요.')).toBe('문의는카카오톡채널로주세요')
    })

    it('preserves letters and numbers in unique facts', () => {
      expect(normalizeSentence('10월 1일부터 10월 5일까지입니다.')).toBe('10월1일부터10월5일까지입니다')
      expect(normalizeSentence('10월 2일부터 10월 5일까지입니다.')).toBe('10월2일부터10월5일까지입니다')
      expect(normalizeSentence('10월 1일부터 10월 5일까지입니다.')).not.toBe(
        normalizeSentence('10월 2일부터 10월 5일까지입니다.'),
      )
    })
  })

  describe('dedupeCaption', () => {
    it('collapses the exact duplicate sentence appearing twice in a row', () => {
      const input = '문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.'
      expect(dedupeCaption(input)).toBe('문의는 카카오톡 채널로 주세요.')
    })

    it('collapses exact duplicate sentences across lines', () => {
      const input = [
        '성수동 카페 소희입니다.',
        '문의는 카카오톡 채널로 주세요.',
        '문의는 카카오톡 채널로 주세요.',
      ].join('\n')
      expect(dedupeCaption(input)).toBe('성수동 카페 소희입니다.\n문의는 카카오톡 채널로 주세요.')
    })

    it('collapses near-duplicate sentences with different punctuation and keeps the first occurrence', () => {
      const input1 = '문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요!'
      expect(dedupeCaption(input1)).toBe('문의는 카카오톡 채널로 주세요.')

      const input2 = '문의는 카카오톡 채널로 주세요! 문의는 카카오톡 채널로 주세요.'
      expect(dedupeCaption(input2)).toBe('문의는 카카오톡 채널로 주세요!')

      const input3 = '문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요~ 😊'
      expect(dedupeCaption(input3)).toBe('문의는 카카오톡 채널로 주세요.')
    })

    it('preserves two different sentences containing unique facts', () => {
      const input = '이벤트 기간은 10월 1일부터 10월 5일까지입니다. 모든 방문 고객에게 아메리카노를 1잔 무료로 드립니다.'
      expect(dedupeCaption(input)).toBe(input)
    })

    it('leaves hashtags block completely untouched at the end', () => {
      const input = '문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.\n\n#소희 #성수카페 #홍대맛집'
      expect(dedupeCaption(input)).toBe('문의는 카카오톡 채널로 주세요.\n\n#소희 #성수카페 #홍대맛집')
    })

    it('preserves captions consisting only of hashtags untouched', () => {
      const input = '#소희 #성수카페 #홍대맛집'
      expect(dedupeCaption(input)).toBe(input)
    })

    it('handles empty and short captions safely', () => {
      expect(dedupeCaption('')).toBe('')
      expect(dedupeCaption('안녕')).toBe('안녕')
      expect(dedupeCaption('감사합니다.')).toBe('감사합니다.')
    })

    it('handles Korean spacing differences as duplicates and keeps the first', () => {
      const input = '문의는 카카오톡 채널로 주세요. 문의는 카카오톡채널로 주세요.'
      expect(dedupeCaption(input)).toBe('문의는 카카오톡 채널로 주세요.')

      const input2 = '성수동 카페에서 만나요. 성수동카페에서 만나요!'
      expect(dedupeCaption(input2)).toBe('성수동 카페에서 만나요.')
    })

    it('is idempotent and does not alter already-clean captions', () => {
      const clean = [
        '성수동 디저트 카페 소희입니다.',
        '매일 아침 구워내는 신선한 딸기 타르트를 준비했어요.',
        '방문 전 예약 문의는 DM으로 부탁드립니다.',
        '',
        '#성수카페 #디저트맛집',
      ].join('\n')

      expect(dedupeCaption(clean)).toBe(clean)
      expect(dedupeCaption(dedupeCaption(clean))).toBe(clean)
    })

    it('collapses paraphrased CTA sentences and keeps the first occurrence', () => {
      const input =
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요. 방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.'
      expect(dedupeCaption(input)).toBe(
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
      )
    })

    it('keeps both when a sentence contains unique facts (dates/hours) even if mentioning 문의 or 상담', () => {
      const input = [
        '성수동 카페 소희입니다.',
        '예약 문의는 11월 8일 오전 10시부터 가능합니다.',
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
      ].join('\n')
      expect(dedupeCaption(input)).toBe(input)
    })

    it('preserves sentences with unique facts such as prices, benefits, or addresses', () => {
      const input = [
        '선착순 10명에게 아메리카노 1잔 무료 쿠폰을 드립니다.',
        '방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
      ].join('\n')
      expect(dedupeCaption(input)).toBe(input)
    })

    it('preserves distinct non-CTA sentences and deduplicates near-duplicate non-CTA sentences', () => {
      const distinct = [
        '오늘 준비한 딸기 타르트가 모두 소진되었습니다.',
        '내일 더 신선한 재료로 준비해두겠습니다.',
      ].join('\n')
      expect(dedupeCaption(distinct)).toBe(distinct)

      const nearDup = '오늘 준비한 타르트가 소진되었습니다. 오늘 준비한 타르트가 소진되었습니다!'
      expect(dedupeCaption(nearDup)).toBe('오늘 준비한 타르트가 소진되었습니다.')
    })

    it('prefers the first occurrence carrying the most specific channel info', () => {
      const input1 = [
        '궁금한 점은 편하게 문의해주세요.',
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.',
      ].join('\n')
      expect(dedupeCaption(input1)).toBe(
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.',
      )

      const input2 = [
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.',
        '궁금한 점은 편하게 문의해주세요.',
      ].join('\n')
      expect(dedupeCaption(input2)).toBe(
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.',
      )
    })

    it('preserves hashtags untouched and is idempotent for paraphrased CTA deduplication', () => {
      const input = [
        '성수동 카페 소희입니다.',
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.',
        '',
        '#소희 #성수카페',
      ].join('\n')
      const expected = [
        '성수동 카페 소희입니다.',
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
        '',
        '#소희 #성수카페',
      ].join('\n')

      const result = dedupeCaption(input)
      expect(result).toBe(expected)
      expect(dedupeCaption(result)).toBe(expected)
    })

    it('handles Korean spacing and emoji in paraphrased CTAs', () => {
      const input = [
        '궁금한 점이나 방문상담은 카카오톡채널로 편하게 문의해주세요! 😊',
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요~ 🙏',
      ].join('\n')
      expect(dedupeCaption(input)).toBe(
        '궁금한 점이나 방문상담은 카카오톡채널로 편하게 문의해주세요! 😊',
      )
    })

    it('deduplicates paraphrased inquiry sentences in production Threads caption', () => {
      const input =
        '이번 주 토요일, 바이름 청라점에서 소소하지만 달콤한 이벤트를 준비했어요.\n\n11월 8일(토) 하루 동안 매장에 방문해 주시는 모든 분들께 시원하고 달콤한 딸기우유 한 잔을 선물로 드려요.\n\n처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.\n\n궁금하신 점이나 상담은 카카오톡 채널로 편하게 문의해 주세요.\n\n#바이름청라점 #청라뷰티샵 #바이름 #퍼스널뷰티'

      const expected =
        '이번 주 토요일, 바이름 청라점에서 소소하지만 달콤한 이벤트를 준비했어요.\n\n11월 8일(토) 하루 동안 매장에 방문해 주시는 모든 분들께 시원하고 달콤한 딸기우유 한 잔을 선물로 드려요.\n\n처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.\n\n#바이름청라점 #청라뷰티샵 #바이름 #퍼스널뷰티'

      const result = dedupeCaption(input)
      expect(result).toBe(expected)
      expect(dedupeCaption(result)).toBe(expected)
    })

    it('regression: collapses earlier Instagram pair keeping first and preserving hashtags', () => {
      const input = [
        '바이름 청라점입니다.',
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
        '방문 상담과 자세한 문의는 카카오톡 채널로 편하게 연락해주세요.',
        '',
        '#바이름청라점 #청라뷰티샵',
      ].join('\n')

      const expected = [
        '바이름 청라점입니다.',
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
        '',
        '#바이름청라점 #청라뷰티샵',
      ].join('\n')

      const result = dedupeCaption(input)
      expect(result).toBe(expected)
      expect(dedupeCaption(result)).toBe(expected)
    })

    it('regression: preserves legitimate caption with CTA and unique-fact inquiry line', () => {
      const input = [
        '바이름 청라점에서 11월 이벤트를 준비했어요.',
        '예약 문의는 11월 8일 오전 10시부터 시작됩니다.',
        '궁금한 점이나 방문 상담은 카카오톡 채널로 편하게 문의해주세요.',
        '',
        '#바이름 #청라뷰티',
      ].join('\n')

      const result = dedupeCaption(input)
      expect(result).toBe(input)
      expect(dedupeCaption(result)).toBe(input)
    })
  })

  describe('collapseDuplicateCta', () => {
    it('collapses paraphrased CTA when semantically equivalent to inquiry sentence in caption', () => {
      const cta = '궁금하신 점이나 상담은 카카오톡 채널로 편하게 문의해 주세요.'
      const caption = [
        '바이름 청라점입니다.',
        '처음 오시는 분들도 편안하게 들러서 따뜻한 시간 보내고 가셨으면 해요. 문의나 상담은 카카오톡 채널로 편하게 남겨주세요.',
        '',
        '#바이름 #청라뷰티',
      ].join('\n')

      expect(collapseDuplicateCta(cta, { caption })).toBe('')
    })

    it('preserves distinct CTA even if caption has a unique-fact inquiry line', () => {
      const cta = '방문 상담은 카카오톡 채널로 편하게 문의해주세요.'
      const caption = [
        '바이름 청라점입니다.',
        '예약 문의는 11월 8일 오전 10시부터 가능합니다.',
        '',
        '#바이름 #청라뷰티',
      ].join('\n')

      expect(collapseDuplicateCta(cta, { caption })).toBe(cta)
    })
    it('collapses CTA when identical to sentence in caption', () => {
      const cta = '문의는 카카오톡 채널로 주세요.'
      const caption = '이번 주말 신메뉴가 출시됩니다. 문의는 카카오톡 채널로 주세요.'
      expect(collapseDuplicateCta(cta, { caption })).toBe('')
    })

    it('collapses CTA when identical to owner-provided facts', () => {
      const cta = '문의는 카카오톡 채널로 주세요.'
      const ownerFacts = ['이벤트 기간: 10/1~10/5. 문의는 카카오톡 채널로 주세요.']
      expect(collapseDuplicateCta(cta, { ownerFacts })).toBe('')
    })

    it('collapses CTA near-duplicate with punctuation difference against owner facts', () => {
      const cta = '문의는 카카오톡 채널로 주세요!'
      const ownerFacts = ['문의는 카카오톡 채널로 주세요.']
      expect(collapseDuplicateCta(cta, { ownerFacts })).toBe('')
    })

    it('preserves distinct CTA that is not in caption or owner facts', () => {
      const cta = '프로필 링크를 눌러 예약해 주세요.'
      const caption = '이번 주말 신메뉴가 출시됩니다. 문의는 카카오톡 채널로 주세요.'
      const ownerFacts = ['문의는 카카오톡 채널로 주세요.']
      expect(collapseDuplicateCta(cta, { caption, ownerFacts })).toBe(cta)
    })
  })

  describe('dedupeDraft', () => {
    it('deduplicates InstagramDraft caption and collapses duplicate CTA', () => {
      const mockDraft: InstagramDraft = {
        caption: '신메뉴 안내입니다. 문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.\n\n#소희 #신메뉴',
        hashtags: ['#소희', '#신메뉴'],
        cta: '문의는 카카오톡 채널로 주세요.',
        disclosure: '',
        observations: [],
        limitations: [],
        evidence: [],
        unresolvedQuestions: [],
      }

      const deduped = dedupeDraft(mockDraft, {
        ownerFacts: ['문의는 카카오톡 채널로 주세요.'],
      })

      expect(deduped.caption).toBe('신메뉴 안내입니다. 문의는 카카오톡 채널로 주세요.\n\n#소희 #신메뉴')
      expect(deduped.cta).toBe('')
      expect(deduped.hashtags).toEqual(['#소희', '#신메뉴'])
    })

    it('deduplicates NaverBlogDraft body text and leaves non-body parts intact', () => {
      const mockNaverDraft: NaverBlogDraft = {
        title: '신메뉴 소개',
        introduction: '환영합니다. 문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요.',
        sections: [
          {
            heading: '소개',
            body: '매장 안내입니다. 문의는 카카오톡 채널로 주세요. 문의는 카카오톡 채널로 주세요!',
          },
        ],
        editorBlueprint: [
          { kind: 'heading', text: '소개' },
          { kind: 'paragraph', text: '중복 문장입니다. 중복 문장입니다.' },
        ],
        keywords: ['신메뉴'],
        cta: '매장에서 만나요!',
        disclosure: '',
        observations: [],
        limitations: [],
        evidence: [],
        unresolvedQuestions: [],
        visibility: 'public',
      }

      const deduped = dedupeDraft(mockNaverDraft)

      expect(deduped.introduction).toBe('환영합니다. 문의는 카카오톡 채널로 주세요.')
      expect(deduped.sections[0].body).toBe('매장 안내입니다. 문의는 카카오톡 채널로 주세요.')
      expect(deduped.editorBlueprint[1]).toEqual({ kind: 'paragraph', text: '중복 문장입니다.' })
      expect(deduped.title).toBe('신메뉴 소개')
      expect(deduped.cta).toBe('매장에서 만나요!')
    })
  })
})
