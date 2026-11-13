import { describe, expect, it } from 'vitest'

import {
  BUBBLE_COLLAPSE_CHARS,
  BUBBLE_COLLAPSE_LINES,
  LONG_DRAFT_CHARS,
  countLines,
  draftCountLabel,
  draftStats,
  shouldCollapseBubble,
} from './long-form'

describe('countLines', () => {
  it('빈 글은 0줄이다', () => {
    expect(countLines('')).toBe(0)
  })

  it('줄바꿈마다 한 줄씩 센다', () => {
    expect(countLines('한 줄')).toBe(1)
    expect(countLines('첫 줄\n둘째 줄')).toBe(2)
  })
})

describe('shouldCollapseBubble', () => {
  it('짧은 글은 접지 않는다', () => {
    expect(shouldCollapseBubble('초안을 준비했어요.')).toBe(false)
  })

  it('빈 글·공백만 있는 글은 접지 않는다', () => {
    expect(shouldCollapseBubble('')).toBe(false)
    expect(shouldCollapseBubble('   \n  ')).toBe(false)
  })

  it('글자 수 기준에 닿으면 접는다', () => {
    expect(shouldCollapseBubble('가'.repeat(BUBBLE_COLLAPSE_CHARS - 1))).toBe(false)
    expect(shouldCollapseBubble('가'.repeat(BUBBLE_COLLAPSE_CHARS))).toBe(true)
  })

  it('앞뒤 공백은 글자 수에서 빼고 센다', () => {
    expect(shouldCollapseBubble(`  ${'가'.repeat(BUBBLE_COLLAPSE_CHARS)}  `)).toBe(true)
  })

  it('줄 수 기준을 넘으면 글자 수가 짧아도 접는다', () => {
    const lines = (count: number) => Array.from({ length: count }, () => '한 줄').join('\n')
    expect(shouldCollapseBubble(lines(BUBBLE_COLLAPSE_LINES))).toBe(false)
    expect(shouldCollapseBubble(lines(BUBBLE_COLLAPSE_LINES + 1))).toBe(true)
  })
})

describe('draftStats', () => {
  it('앞뒤 공백을 뺀 글자 수와 줄 수를 센다', () => {
    expect(draftStats('  안녕하세요 \n 반가워요  ')).toEqual({
      chars: 12,
      lines: 2,
      isLong: false,
    })
  })

  it('길게 쓰기 기준에 닿으면 긴 초안이다', () => {
    expect(draftStats('가'.repeat(LONG_DRAFT_CHARS - 1)).isLong).toBe(false)
    expect(draftStats('가'.repeat(LONG_DRAFT_CHARS)).isLong).toBe(true)
  })

  it('줄이 많으면 글자 수가 짧아도 긴 초안이다', () => {
    const lines = Array.from({ length: BUBBLE_COLLAPSE_LINES + 1 }, () => '한 줄').join('\n')
    expect(draftStats(lines).isLong).toBe(true)
  })
})

describe('draftCountLabel', () => {
  it('짧은 초안에는 글자 수를 붙이지 않는다', () => {
    expect(draftCountLabel('안녕하세요')).toBeNull()
    expect(draftCountLabel('   ')).toBeNull()
  })

  it('긴 초안에는 글자 수를 붙인다', () => {
    expect(draftCountLabel('가'.repeat(250))).toBe('250자')
  })
})
