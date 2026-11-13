import type { CategoryKey } from './types'

/** 서비스가 미리 채워 두는 문구. 사업자가 가르친 내용이 아니므로 0점으로 본다. */
export const DEFAULT_PROFILE_TEXTS: ReadonlySet<string> = new Set([
  '신규 매장',
  '매장명 설정 대기',
  '매장 위치 등록 대기',
  '고객 맞춤 전문 서비스를 제공합니다.',
  '따뜻하고 신뢰감 있는 전문가 톤, 친절한 설명체 (~해요, ~해 드려요)',
])

export function isMeaningfulText(value: unknown, minLength = 2): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= minLength && !DEFAULT_PROFILE_TEXTS.has(trimmed)
}

export const CATEGORY_WEIGHTS: Readonly<Record<CategoryKey, number>> = {
  shop: 25,
  customer: 15,
  style: 15,
  caution: 15,
  materials: 20,
  manual: 10,
}

export const CATEGORY_LABELS: Readonly<Record<CategoryKey, string>> = {
  shop: '가게·상품·가격',
  customer: '고객·상권·질문',
  style: '말투·이미지 기준',
  caution: '조심할 표현',
  materials: '자료·사례',
  manual: '운영 규칙·매뉴얼',
}

export const FAQ_TARGET = 3

export const LEVEL_NAMES = ['입사 준비', '신입', '사원', '주임', '대리'] as const
export const FINAL_LEVEL_NAME = '상담원'
