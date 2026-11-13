import type { LengthMeasurementType } from './types';

const textEncoder = new TextEncoder();

/**
 * UTF-16 code units 기준 길이 (JS 기본 string.length)
 * - ASCII/한글: 1
 * - 서로게이트 페어 이모지(예: 😀): 2
 * - 복합 ZWJ 이모지(예: 👨‍👩‍👧‍👦): 11
 */
export function countUtf16CodeUnits(text: string): number {
  return text.length;
}

/**
 * 유니코드 코드포인트(codepoints) 기준 길이
 * - [...text].length 또는 Array.from(text).length
 * - 서로게이트 페어 단일 이모지(예: 😀): 1
 * - 복합 ZWJ 이모지: ZWJ 및 각 이모지 코드포인트 합산
 */
export function countCodepoints(text: string): number {
  return Array.from(text).length;
}

/**
 * 유니코드 그래핌 클러스터(Grapheme Cluster) 기준 길이
 * 사용자가 시각적으로 인식하는 글자 수 (Intl.Segmenter 기반)
 * - 한글 음절: 1
 * - 단일 이모지(😀): 1
 * - 복합 ZWJ 이모지(👨‍👩‍👧‍👦): 1
 * - 피부색 수정 이모지(👍🏽): 1
 */
export function countGraphemes(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const segment of segmenter.segment(text)) {
      void segment;
      count += 1;
    }
    return count;
  }
  // Fallback if Intl.Segmenter is unavailable
  return Array.from(text).length;
}

/**
 * UTF-8 바이트(bytes) 기준 길이
 * - ASCII: 1 byte
 * - 한글: 3 bytes
 * - 이모지: 4+ bytes
 */
export function countUtf8Bytes(text: string): number {
  return textEncoder.encode(text).length;
}

const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * Meta Threads 공식 API 텍스트 길이 측정 방식:
 * "Text posts are limited to 500 characters. Emojis are counted as the number of UTF-8 bytes."
 * (https://developers.facebook.com/docs/threads/posts)
 *
 * - 일반 문자(영문/한글/기호): 코드포인트(1자)로 계산
 * - 이모지(단일/복합): 해당 이모지의 UTF-8 바이트 수로 계산
 */
export function countThreadsLength(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let totalLength = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (EMOJI_REGEX.test(segment)) {
        totalLength += countUtf8Bytes(segment);
      } else {
        totalLength += countCodepoints(segment);
      }
    }
    return totalLength;
  }

  // Fallback
  let totalLength = 0;
  for (const char of Array.from(text)) {
    if (EMOJI_REGEX.test(char)) {
      totalLength += countUtf8Bytes(char);
    } else {
      totalLength += 1;
    }
  }
  return totalLength;
}

/**
 * 채널 정책별 측정 전략에 따른 길이 계산 디스패처
 */
export function countLength(text: string, strategy: LengthMeasurementType): number {
  switch (strategy) {
    case 'grapheme':
      return countGraphemes(text);
    case 'codepoint':
      return countCodepoints(text);
    case 'utf16_code_units':
      return countUtf16CodeUnits(text);
    case 'utf8_bytes':
      return countUtf8Bytes(text);
    case 'threads_hybrid':
      return countThreadsLength(text);
    default:
      return countCodepoints(text);
  }
}
