import { describe, expect, it } from 'vitest'
import {
  findPlaceholders,
  findPlaceholdersInVersion,
  INFO_REQUEST_PLACEHOLDER,
  isInformationRequest,
} from './placeholder-detect'

describe('findPlaceholders', () => {
  it('Precision rule: detects exact real-world blanks [이벤트 기간] and compound [문의 방법 또는 예약 방법]', () => {
    const text = '이번 행사 안내입니다.\n기간: [이벤트 기간]\n참여: [문의 방법 또는 예약 방법]'
    expect(findPlaceholders(text)).toEqual(['[이벤트 기간]', '[문의 방법 또는 예약 방법]'])
  })

  it('Precision rule: detects bare slot brackets with at most 2 words containing slot words without heading noun endings', () => {
    const text = '일시: [행사 일시], 장소: [모임 장소], 가격: [할인 가격], 연락처: [대표 연락처]'
    expect(findPlaceholders(text)).toEqual([
      '[행사 일시]',
      '[모임 장소]',
      '[할인 가격]',
      '[대표 연락처]',
    ])
  })

  it('Precision rule: ignores heading-like brackets ending with 안내, 소개, 후기, 혜택, 문의, 방법', () => {
    const text = `
      [예약 문의]
      [할인 안내]
      [가격 안내]
      [이벤트 혜택]
      [시술 후기]
      [메뉴 소개]
      [문의 방법]
    `
    expect(findPlaceholders(text)).toEqual([])
  })

  it('Precision rule: does not flag line-start bracket groups followed by body text on the same line (heading/tag style)', () => {
    const text = `
      [예약 문의] 카카오톡으로 예약 상담을 도와드립니다.
      [이벤트 혜택] 지금 방문하시면 다양한 할인을 받으실 수 있어요.
      [이벤트 기간] 2026년 11월 한 달간 진행됩니다.
    `
    expect(findPlaceholders(text)).toEqual([])
  })

  it('Precision rule: detects brackets ending with explicit blank markers 입력, 기재, 작성, OOO, XXX, __', () => {
    const text = '매장: [매장명 입력], 전화번호: [전화번호 기재], 작성자: [성함 작성], 금액: [금액 OOO], 번호: [번호 XXX], 장소: [장소 __]'
    expect(findPlaceholders(text)).toEqual([
      '[매장명 입력]',
      '[전화번호 기재]',
      '[성함 작성]',
      '[금액 OOO]',
      '[번호 XXX]',
      '[장소 __]',
    ])
  })

  it('ignores false-positives like [광고], [이벤트], [후기], [Before/After], #태그, [1], URLs, and markdown links', () => {
    const text = `
      [광고] 봄맞이 [이벤트] 소식입니다! #태그1 #태그2
      [후기] 고객님의 소중한 후기입니다.
      [Before/After] 사진을 확인하세요.
      참고 자료 [1] 확인 바랍니다.
      홈페이지: https://example.com/[test]
      예약 링크: [예약 방법 안내](https://example.com/booking)
    `
    expect(findPlaceholders(text)).toEqual([])
  })

  it('returns unique placeholders preserving first appearance order', () => {
    const text = '기간: [이벤트 기간]\n참여: [모임 장소]\n다시 기간: [이벤트 기간]'
    expect(findPlaceholders(text)).toEqual(['[이벤트 기간]', '[모임 장소]'])
  })

  it('returns empty array for empty, null, undefined, or text without placeholders', () => {
    expect(findPlaceholders('')).toEqual([])
    expect(findPlaceholders(null)).toEqual([])
    expect(findPlaceholders(undefined)).toEqual([])
    expect(findPlaceholders('평범한 본문 내용입니다.')).toEqual([])
  })

  it('ignores brackets that are too short (<2 chars) or too long (>24 chars) or multiline', () => {
    const text = '[값] [1] [\n이벤트 기간\n] [이것은너무길어서템플릿슬롯으로간주되지않는긴괄호문구입니다기간안내]'
    expect(findPlaceholders(text)).toEqual([])
  })
})

describe('findPlaceholdersInVersion', () => {
  it('checks joined caption and hashtags as single shared input', () => {
    const version = {
      caption: '행사 안내입니다.\n기간: [이벤트 기간]',
      hashtags: ['#이벤트', '[매장명 입력]', '#뷰티'],
    }
    expect(findPlaceholdersInVersion(version)).toEqual(['[이벤트 기간]', '[매장명 입력]'])
  })

  it('handles null, undefined, or empty caption and hashtags gracefully', () => {
    expect(findPlaceholdersInVersion(null)).toEqual([])
    expect(findPlaceholdersInVersion(undefined)).toEqual([])
    expect(findPlaceholdersInVersion({ caption: null, hashtags: null })).toEqual([])
    expect(findPlaceholdersInVersion({ caption: '일반 텍스트', hashtags: [] })).toEqual([])
  })
})

describe('information-request caption detection (assistant talking to owner)', () => {
  const REAL_WORLD_BUG_CAPTION =
    '이벤트 문안을 작성하기 전에 몇 가지 정보를 확인해 주세요.\n\n이벤트명, 진행 기간, 대상, 제공 혜택, 참여 방법을 알려주시면 바이름 청라점의 따뜻하고 세련된 말투에 맞춰 작성해 드려요.'

  it('detects real-world bug caption where assistant asks owner for information instead of generating post', () => {
    expect(isInformationRequest(REAL_WORLD_BUG_CAPTION)).toBe(true)
    expect(findPlaceholders(REAL_WORLD_BUG_CAPTION)).toEqual([INFO_REQUEST_PLACEHOLDER])
    expect(
      findPlaceholdersInVersion({
        caption: REAL_WORLD_BUG_CAPTION,
        hashtags: ['#바이름청라점'],
      }),
    ).toEqual([INFO_REQUEST_PLACEHOLDER])
  })

  it('detects strong cue: 알려주시면.*작성해 드려요', () => {
    const text = '이벤트 세부 혜택을 알려주시면 바로 인스타그램 본문으로 작성해 드려요.'
    expect(isInformationRequest(text)).toBe(true)
    expect(findPlaceholders(text)).toEqual([INFO_REQUEST_PLACEHOLDER])
  })

  it('detects two or more cues: 작성하기 전에 … 확인해 주세요 + 필요한 정보', () => {
    const text = '문안을 작성하기 전에 확인해 주세요. 필요한 정보를 먼저 입력해야 합니다.'
    expect(isInformationRequest(text)).toBe(true)
    expect(findPlaceholders(text)).toEqual([INFO_REQUEST_PLACEHOLDER])
  })

  it('detects two or more cues: 정보를 알려 주세요 + 말씀해 주시면', () => {
    const text = '행사 관련 정보를 알려 주세요. 말씀해 주시면 반영하겠습니다.'
    expect(isInformationRequest(text)).toBe(true)
    expect(findPlaceholders(text)).toEqual([INFO_REQUEST_PLACEHOLDER])
  })

  it('preserves both info-request message and slot brackets if both exist', () => {
    const text = `${REAL_WORLD_BUG_CAPTION}\n참고: [이벤트 기간]`
    expect(findPlaceholders(text)).toEqual([
      INFO_REQUEST_PLACEHOLDER,
      '[이벤트 기간]',
    ])
  })

  it('negative tests: does NOT flag normal customer marketing captions', () => {
    const normalCaptions = [
      '자세한 내용은 DM으로 문의해 주세요.',
      '예약은 카카오톡으로 알려주세요.',
      '궁금하신 점이 있다면 언제든 편하게 말씀해 주세요.',
      '시술 전 주의사항을 꼭 확인해 주세요.',
      '더 많은 정보와 후기는 프로필 링크에서 확인해 보세요!',
      '이번 달 특별 혜택! 놓치지 말고 지금 예약해 주세요.',
    ]

    for (const caption of normalCaptions) {
      expect(isInformationRequest(caption)).toBe(false)
      expect(findPlaceholders(caption)).toEqual([])
      expect(findPlaceholdersInVersion({ caption, hashtags: ['#뷰티', '#청라'] })).toEqual([])
    }
  })
})

