import { describe, expect, it } from 'vitest'
import { computeCaptionStats } from './caption-stats'

describe('computeCaptionStats', () => {
  describe('empty and blank inputs', () => {
    it('returns postCount 0 and safe default null/0 values for empty array', () => {
      const stats = computeCaptionStats([])
      expect(stats).toEqual({
        postCount: 0,
        averageLength: 0,
        medianLength: 0,
        topHashtags: [],
        averageHashtagCount: 0,
        repeatedHeaderLine: null,
        repeatedSecondLine: null,
        emojiPerPost: 0,
        topEmojis: [],
        endsWithHashtagBlockRatio: 0,
        averageBodyLines: 0,
      })
    })

    it('filters out empty or whitespace-only/braille-space captions', () => {
      const stats = computeCaptionStats(['', '   ', '\n\n', '⠀\n⠀', '​﻿'])
      expect(stats.postCount).toBe(0)
      expect(stats.topHashtags).toEqual([])
      expect(stats.repeatedHeaderLine).toBeNull()
    })

    it('correctly handles mixed valid and missing/empty captions without skewing averages', () => {
      const stats = computeCaptionStats([
        '첫 번째 유효 캡션 #해시태그',
        '',
        '   ',
        '두 번째 유효 캡션 #해시태그',
        '⠀',
      ])
      expect(stats.postCount).toBe(2)
      expect(stats.averageHashtagCount).toBe(1)
      expect(stats.topHashtags).toEqual(['#해시태그'])
    })
  })

  describe('Korean sample caption and exact stats calculation', () => {
    it('computes stats for the representative Korean beauty salon caption', () => {
      const sample = '𝐁𝐘.𝐑𝐄𝐔𝐌 𝐁𝐄𝐀𝐔𝐓𝐘🤍\n\n눈썹 디자인, 어떤 분위기를 원하세요?\n\n#청라눈썹문신 #바이름'
      const stats = computeCaptionStats([sample])

      expect(stats.postCount).toBe(1)
      expect(stats.repeatedHeaderLine).toBe('𝐁𝐘.𝐑𝐄𝐔𝐌 𝐁𝐄𝐀𝐔𝐓𝐘🤍')
      expect(stats.repeatedSecondLine).toBe('눈썹 디자인, 어떤 분위기를 원하세요?')
      expect(stats.topHashtags).toEqual(['#청라눈썹문신', '#바이름'])
      expect(stats.averageHashtagCount).toBe(2)
      expect(stats.emojiPerPost).toBe(1)
      expect(stats.topEmojis).toEqual(['🤍'])
      expect(stats.endsWithHashtagBlockRatio).toBe(1)
      // Non-empty lines: 3. Hashtag-only line: 1. Body lines: 2.
      expect(stats.averageBodyLines).toBe(2)
      expect(stats.averageLength).toBe(sample.length)
      expect(stats.medianLength).toBe(sample.length)
    })
  })

  describe('braille space (U+2800) and zero-width spaces in headers', () => {
    it('strips leading and trailing braille spaces (U+2800) and zero-width spaces from repeated header lines', () => {
      const captions = [
        '⠀​ 𝐁𝐘.𝐑𝐄𝐔𝐌 𝐁𝐄𝐀𝐔𝐓𝐘🤍 ⠀\n본문 첫 번째 글입니다.\n#해시태그',
        '⠀ 𝐁𝐘.𝐑𝐄𝐔𝐌 𝐁𝐄𝐀𝐔𝐓𝐘🤍﻿\n본문 두 번째 글입니다.\n#해시태그',
      ]
      const stats = computeCaptionStats(captions)
      expect(stats.repeatedHeaderLine).toBe('𝐁𝐘.𝐑𝐄𝐔𝐌 𝐁𝐄𝐀𝐔𝐓𝐘🤍')
    })
  })

  describe('Korean hashtags and hashtag ranking rules', () => {
    it('preserves Korean hashtags and casing without lowercasing', () => {
      const captions = ['#청라눈썹문신 #MicroBlading #바이름\n본문 내용']
      const stats = computeCaptionStats(captions)
      expect(stats.topHashtags).toContain('#청라눈썹문신')
      expect(stats.topHashtags).toContain('#MicroBlading')
      expect(stats.topHashtags).toContain('#바이름')
      expect(stats.topHashtags[1]).toBe('#MicroBlading') // Case preserved
    })

    it('limits topHashtags to 10 sorted by frequency descending and breaks ties by first occurrence order', () => {
      const captions = [
        '#A #B #C #D #E #F #G #H #I #J #K #L',
        '#A #B #C', // A, B, C count = 2
        '#A', // A count = 3
      ]
      const stats = computeCaptionStats(captions)
      // A (3), B (2), C (2), D~J (1 each), K, L (exceeding 10 omitted)
      expect(stats.topHashtags).toHaveLength(10)
      expect(stats.topHashtags[0]).toBe('#A')
      expect(stats.topHashtags[1]).toBe('#B')
      expect(stats.topHashtags[2]).toBe('#C')
      expect(stats.topHashtags.slice(3)).toEqual(['#D', '#E', '#F', '#G', '#H', '#I', '#J'])
      expect(stats.topHashtags).not.toContain('#K')
      expect(stats.topHashtags).not.toContain('#L')
    })
  })

  describe('40% threshold boundary for repeatedHeaderLine and repeatedSecondLine', () => {
    it('detects repeatedHeaderLine when appearing in exactly 40% (2 of 5) posts', () => {
      const captions = [
        '시그니처 헤더\n본문 1\n#태그',
        '시그니처 헤더\n본문 2\n#태그',
        '다른 헤더 1\n본문 3\n#태그',
        '다른 헤더 2\n본문 4\n#태그',
        '다른 헤더 3\n본문 5\n#태그',
      ]
      const stats = computeCaptionStats(captions)
      expect(stats.repeatedHeaderLine).toBe('시그니처 헤더')
    })

    it('returns null for repeatedHeaderLine when most frequent header is under 40% (e.g. 1 of 5 = 20%)', () => {
      const captions = [
        '헤더 1\n본문\n#태그',
        '헤더 2\n본문\n#태그',
        '헤더 3\n본문\n#태그',
        '헤더 4\n본문\n#태그',
        '헤더 5\n본문\n#태그',
      ]
      const stats = computeCaptionStats(captions)
      expect(stats.repeatedHeaderLine).toBeNull()
    })

    it('detects repeatedSecondLine at 40% boundary and null when below 40%', () => {
      const passCaptions = [
        '헤더 1\n반복 소제목\n본문\n#태그',
        '헤더 2\n반복 소제목\n본문\n#태그',
        '헤더 3\n소제목 A\n본문\n#태그',
        '헤더 4\n소제목 B\n본문\n#태그',
        '헤더 5\n소제목 C\n본문\n#태그',
      ]
      const passStats = computeCaptionStats(passCaptions)
      expect(passStats.repeatedSecondLine).toBe('반복 소제목')

      const failCaptions = [
        '헤더 1\n소제목 1\n본문\n#태그',
        '헤더 2\n소제목 2\n본문\n#태그',
        '헤더 3\n소제목 3\n본문\n#태그',
        '헤더 4\n소제목 4\n본문\n#태그',
        '헤더 5\n소제목 5\n본문\n#태그',
      ]
      const failStats = computeCaptionStats(failCaptions)
      expect(failStats.repeatedSecondLine).toBeNull()
    })
  })

  describe('emoji metrics (emojiPerPost, topEmojis)', () => {
    it('computes emojiPerPost to 1 decimal place and topEmojis up to 5 by frequency then first appearance', () => {
      const captions = [
        '첫 글 ✨✨🤍', // 2x ✨, 1x 🤍
        '두 번째 글 ✨🤍🌿', // 1x ✨, 1x 🤍, 1x 🌿
        '세 번째 글 🤍🌸☕', // 1x 🤍, 1x 🌸, 1x ☕
      ]
      // ✨: 3, 🤍: 3, 🌿: 1, 🌸: 1, ☕: 1
      // Total emojis = 3 + 3 + 1 + 1 + 1 = 9
      // emojiPerPost = 9 / 3 = 3.0
      // ✨ was first seen before 🤍 in captions[0], so ✨ comes first in tie
      const stats = computeCaptionStats(captions)
      expect(stats.emojiPerPost).toBe(3)
      expect(stats.topEmojis).toEqual(['✨', '🤍', '🌿', '🌸', '☕'])
    })
  })

  describe('endsWithHashtagBlockRatio and averageBodyLines', () => {
    it('computes endsWithHashtagBlockRatio to 2 decimal places and averageBodyLines to 1 decimal place', () => {
      const captions = [
        '제목\n본문 내용\n#태그1 #태그2', // ends with hashtag block (yes), body lines = 2
        '제목\n본문 내용 2\n#태그1', // ends with hashtag block (yes), body lines = 2
        '제목\n본문 내용 3\n문의는 DM 주세요', // ends with text (no), body lines = 3
        '제목\n본문 4\n#태그1 #태그2', // ends with hashtag block (yes), body lines = 2
      ]
      // endsWithHashtagBlock: 3 of 4 => 0.75
      // body lines: (2 + 2 + 3 + 2) / 4 = 9 / 4 = 2.25 => 2.3
      const stats = computeCaptionStats(captions)
      expect(stats.endsWithHashtagBlockRatio).toBe(0.75)
      expect(stats.averageBodyLines).toBe(2.3)
    })
  })

  describe('averageLength and medianLength rounding', () => {
    it('rounds averageLength and medianLength to nearest integer', () => {
      // lengths: 10, 20, 31 => sum = 61, avg = 20.333... -> 20, median = 20
      const c1 = 'a'.repeat(10)
      const c2 = 'b'.repeat(20)
      const c3 = 'c'.repeat(31)
      const stats = computeCaptionStats([c1, c2, c3])
      expect(stats.averageLength).toBe(20)
      expect(stats.medianLength).toBe(20)

      // Even count: 10, 20, 30, 41 => sum = 101, avg = 101/4 = 25.25 -> 25, median = (20+30)/2 = 25
      const e1 = 'a'.repeat(10)
      const e2 = 'b'.repeat(20)
      const e3 = 'c'.repeat(30)
      const e4 = 'd'.repeat(41)
      const statsEven = computeCaptionStats([e1, e2, e3, e4])
      expect(statsEven.averageLength).toBe(25)
      expect(statsEven.medianLength).toBe(25)
    })
  })
})
