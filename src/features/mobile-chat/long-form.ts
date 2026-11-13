/**
 * 긴 원고 판정 — 접을지, 길게 쓰기를 열지.
 *
 * 기준은 '글자 수'와 '줄 수'뿐이다. 화면 높이를 재서 판정하지 않으므로
 * 같은 글이 기기마다 다르게 접히지 않는다. 접어도 내용은 지우지 않고
 * '더 보기'로 그대로 펼친다.
 */

/** 이 글자 수를 넘으면 대화 버블을 접는다. 390px 폭에서 8줄을 넘기는 분량이다. */
export const BUBBLE_COLLAPSE_CHARS = 320

/** 접었을 때 보여 줄 줄 수. */
export const BUBBLE_COLLAPSE_LINES = 8

/** 이 글자 수를 넘으면 입력창에 '길게 쓰기'를 연다. */
export const LONG_DRAFT_CHARS = 200

export function countLines(text: string): number {
  if (text === '') return 0
  return text.split('\n').length
}

/** 버블을 접을지. 아주 긴 줄바꿈 목록도 접는다. */
export function shouldCollapseBubble(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return trimmed.length >= BUBBLE_COLLAPSE_CHARS || countLines(trimmed) > BUBBLE_COLLAPSE_LINES
}

export interface DraftStats {
  /** 앞뒤 공백을 뺀 글자 수. 서버가 받는 본문과 같은 기준이다. */
  chars: number
  lines: number
  isLong: boolean
}

export function draftStats(text: string): DraftStats {
  const trimmed = text.trim()
  return {
    chars: trimmed.length,
    lines: countLines(trimmed),
    isLong: trimmed.length >= LONG_DRAFT_CHARS || countLines(trimmed) > BUBBLE_COLLAPSE_LINES,
  }
}

/** 입력창 옆에 붙는 글자 수. 짧으면 아무것도 보여 주지 않는다. */
export function draftCountLabel(text: string): string | null {
  const stats = draftStats(text)
  if (!stats.isLong) return null
  return `${stats.chars.toLocaleString('ko-KR')}자`
}
