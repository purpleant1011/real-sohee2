import type { CaptionStats } from './types'

const INVISIBLE_STRIP_REGEX = /^[\s⠀​-‍﻿]+|[\s⠀​-‍﻿]+$/gu
const INVISIBLE_ALL_REGEX = /[\s⠀​-‍﻿]/g
const HASHTAG_REGEX = /#\S+/g
const EMOJI_REGEX = /\p{Extended_Pictographic}/u

const EMPTY_STATS: CaptionStats = {
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
}

function cleanLine(line: string): string {
  return line.replace(INVISIBLE_STRIP_REGEX, '')
}

function isBlank(text: string): boolean {
  return text.replace(INVISIBLE_ALL_REGEX, '').length === 0
}

function isHashtagOnlyLine(line: string): boolean {
  const hashtags = line.match(HASHTAG_REGEX)
  if (!hashtags || hashtags.length === 0) return false
  const remainder = line.replace(HASHTAG_REGEX, '').replace(INVISIBLE_ALL_REGEX, '')
  return remainder.length === 0
}

function extractEmojis(text: string): readonly string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const result: string[] = []
    for (const { segment } of segmenter.segment(text)) {
      if (EMOJI_REGEX.test(segment)) {
        result.push(segment)
      }
    }
    return result
  }
  const matches = text.match(/\p{Extended_Pictographic}/gu)
  return matches ? [...matches] : []
}

/**
 * 인스타그램·스레드 수집 캡션 목록으로부터 결정적 텍스트 통계를 계산한다.
 *
 * - 빈 캡션(공백/점자 공백/제로폭 공백만 있는 경우 포함)은 제외하고 계산
 * - 해시태그: #\S+ 원문 유지 (한글 포함, 소문자 변환 없음), 빈도 내림차순 및 첫 등장순 정렬
 * - repeatedHeaderLine / repeatedSecondLine: 비어있지 않은 줄이 전체의 40% 이상에서 동일하면 추출
 * - endsWithHashtagBlockRatio: 마지막 줄이 해시태그만으로 구성된 게시물 비율 (0~1, 소수 2자리)
 * - averageBodyLines: 해시태그 전용 줄을 제외한 본문 줄 수 평균 (소수 1자리)
 */
export function computeCaptionStats(captions: readonly string[]): CaptionStats {
  const validCaptions = captions.filter(c => typeof c === 'string' && !isBlank(c))
  const postCount = validCaptions.length
  if (postCount === 0) {
    return EMPTY_STATS
  }

  // 글자 수 통계 (정수 반올림)
  const lengths = validCaptions.map(c => c.length)
  const totalLength = lengths.reduce((acc, len) => acc + len, 0)
  const averageLength = Math.round(totalLength / postCount)

  const sortedLengths = [...lengths].sort((a, b) => a - b)
  const medianLength =
    postCount % 2 === 1
      ? sortedLengths[Math.floor(postCount / 2)]
      : Math.round((sortedLengths[postCount / 2 - 1] + sortedLengths[postCount / 2]) / 2)

  // 각 게시물별 줄 분해 및 해시태그/이모지 수집
  const headerCounts = new Map<string, number>()
  const headerFirstSeen = new Map<string, number>()

  const secondLineCounts = new Map<string, number>()
  const secondLineFirstSeen = new Map<string, number>()

  const hashtagCounts = new Map<string, number>()
  const hashtagFirstSeen = new Map<string, number>()
  let totalHashtagCount = 0

  const emojiCounts = new Map<string, number>()
  const emojiFirstSeen = new Map<string, number>()
  let totalEmojiCount = 0

  let endsWithHashtagBlockCount = 0
  let totalBodyLines = 0

  for (let postIdx = 0; postIdx < validCaptions.length; postIdx++) {
    const caption = validCaptions[postIdx]
    const lines = caption
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(l => l.length > 0)

    // 헤더 줄 (첫 비어있지 않은 줄)
    if (lines.length > 0) {
      const firstLine = lines[0]
      headerCounts.set(firstLine, (headerCounts.get(firstLine) ?? 0) + 1)
      if (!headerFirstSeen.has(firstLine)) {
        headerFirstSeen.set(firstLine, postIdx)
      }
    }

    // 두 번째 줄
    if (lines.length > 1) {
      const secondLine = lines[1]
      secondLineCounts.set(secondLine, (secondLineCounts.get(secondLine) ?? 0) + 1)
      if (!secondLineFirstSeen.has(secondLine)) {
        secondLineFirstSeen.set(secondLine, postIdx)
      }
    }

    // 마지막 줄 해시태그 블록 판별
    if (lines.length > 0 && isHashtagOnlyLine(lines[lines.length - 1])) {
      endsWithHashtagBlockCount += 1
    }

    // 해시태그 전용 줄을 뺀 본문 줄 수
    const bodyLineCount = lines.filter(line => !isHashtagOnlyLine(line)).length
    totalBodyLines += bodyLineCount

    // 해시태그 추출
    const hashtags = caption.match(HASHTAG_REGEX) ?? []
    totalHashtagCount += hashtags.length
    for (const tag of hashtags) {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) ?? 0) + 1)
      if (!hashtagFirstSeen.has(tag)) {
        hashtagFirstSeen.set(tag, hashtagFirstSeen.size)
      }
    }

    // 이모지 추출
    const emojis = extractEmojis(caption)
    totalEmojiCount += emojis.length
    for (const emoji of emojis) {
      emojiCounts.set(emoji, (emojiCounts.get(emoji) ?? 0) + 1)
      if (!emojiFirstSeen.has(emoji)) {
        emojiFirstSeen.set(emoji, emojiFirstSeen.size)
      }
    }
  }

  // 40% 이상 등장 헤더/두 번째 줄 산출
  const threshold = postCount * 0.4

  const pickFrequentLine = (
    counts: Map<string, number>,
    firstSeen: Map<string, number>
  ): string | null => {
    const candidates = Array.from(counts.entries())
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        return (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0)
      })
    return candidates.length > 0 ? candidates[0][0] : null
  }

  const repeatedHeaderLine = pickFrequentLine(headerCounts, headerFirstSeen)
  const repeatedSecondLine = pickFrequentLine(secondLineCounts, secondLineFirstSeen)

  // 상위 해시태그 정렬 (최대 10개)
  const topHashtags = Array.from(hashtagCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return (hashtagFirstSeen.get(a[0]) ?? 0) - (hashtagFirstSeen.get(b[0]) ?? 0)
    })
    .slice(0, 10)
    .map(([tag]) => tag)

  // 상위 이모지 정렬 (최대 5개)
  const topEmojis = Array.from(emojiCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return (emojiFirstSeen.get(a[0]) ?? 0) - (emojiFirstSeen.get(b[0]) ?? 0)
    })
    .slice(0, 5)
    .map(([emoji]) => emoji)

  return {
    postCount,
    averageLength,
    medianLength,
    topHashtags,
    averageHashtagCount: Number((totalHashtagCount / postCount).toFixed(1)),
    repeatedHeaderLine,
    repeatedSecondLine,
    emojiPerPost: Number((totalEmojiCount / postCount).toFixed(1)),
    topEmojis,
    endsWithHashtagBlockRatio: Number((endsWithHashtagBlockCount / postCount).toFixed(2)),
    averageBodyLines: Number((totalBodyLines / postCount).toFixed(1)),
  }
}
