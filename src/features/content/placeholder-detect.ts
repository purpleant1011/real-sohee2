const SLOT_WORDS = [
  '기간',
  '날짜',
  '일시',
  '장소',
  '혜택',
  '가격',
  '할인',
  '이름',
  '이벤트명',
  '문의',
  '예약',
  '방법',
  '연락처',
  '링크',
  '주소',
  '시간',
  '내용',
  '상품',
  '메뉴',
  '시술',
] as const

export const INFO_REQUEST_PLACEHOLDER =
  '고객에게 보여줄 글이 아니라 소희의 정보 요청이에요. 이벤트 정보를 알려주고 다시 만들어 주세요.'

const STRONG_INFO_REQUEST_PATTERNS = [
  /(?:알려|말씀해)\s*주시면[\s\S]*작성해\s*드려(?:요|드릴게요|겠습니다)/u,
]

const INFO_REQUEST_CUE_PATTERNS = [
  /(?:작성|생성)하기\s*전에[\s\S]*확인해\s*주세요/u,
  /정보(?:를)?\s*(?:알려|말씀해)\s*주세요/u,
  /말씀해\s*주시면/u,
  /필요한\s*정보/u,
  /(?:몇\s*가지\s*)?정보를\s*확인해\s*주세요/u,
  /알려주시면/u,
]

/**
 * 어시스턴트가 고객을 위한 게시물이 아닌 점주에게 정보를 요청하는 문구인지 탐지합니다.
 *
 * 판정 기준:
 * - 강한 단일 큐 1개(예: '알려주시면.*작성해 드려요') 또는
 * - 일반 큐 2개 이상 일치
 */
export function isInformationRequest(text?: string | null): boolean {
  if (!text) return false

  if (STRONG_INFO_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    return true
  }

  let matchedCues = 0
  for (const pattern of INFO_REQUEST_CUE_PATTERNS) {
    if (pattern.test(text)) {
      matchedCues += 1
      if (matchedCues >= 2) {
        return true
      }
    }
  }

  return false
}

export function isInformationRequestPlaceholder(placeholder?: string | null): boolean {
  return placeholder === INFO_REQUEST_PLACEHOLDER
}

export function hasInformationRequestPlaceholder(placeholders?: readonly string[] | null): boolean {
  return (placeholders ?? []).some(isInformationRequestPlaceholder)
}

const ACTION_PLACEHOLDER_SUFFIX_PATTERN = /(?:입력|기재|작성|___*|[oO]{3,}|[xX]{3,})$/u

const HEADING_NOUN_ENDINGS_PATTERN = /(?:안내|소개|후기|혜택|문의|방법)$/u

const BRACKET_PATTERN = /\[([^\]\n]{2,24})\]/gu

/**
 * 괄호 문구가 줄의 시작(선행 공백 제외)에 위치하고,
 * 같은 줄 뒤에 본문 텍스트가 이어지는지(헤딩/태그 스타일) 확인합니다.
 */
function isLineStartHeading(text: string, matchIndex: number, afterIndex: number): boolean {
  const prevNewlineIndex = text.lastIndexOf('\n', matchIndex - 1)
  const lineStartToMatch = text.slice(prevNewlineIndex + 1, matchIndex)
  if (lineStartToMatch.trim().length > 0) {
    return false
  }

  const nextNewlineIndex = text.indexOf('\n', afterIndex)
  const afterMatchToLineEnd = nextNewlineIndex === -1 ? text.slice(afterIndex) : text.slice(afterIndex, nextNewlineIndex)
  return afterMatchToLineEnd.trim().length > 0
}

/**
 * 한국어 원고/캡션에서 채워지지 않은 템플릿 슬롯(빈칸)을 정밀하게 탐지합니다.
 *
 * 정밀 판정 규칙:
 * 1. 줄 시작에 나타나고 같은 줄에 본문이 이어지는 헤딩/태그 스타일([예약 문의] ...)은 제외
 * 2. 입력, 기재, 작성, OOO, XXX, __ 등 명시적 빈칸 접미사로 끝나는 경우 탐지
 * 3. [문의 방법 또는 예약 방법] 등 '또는'으로 연결된 슬롯 선택지 탐지
 * 4. 슬롯 단어를 포함하면서 최대 2단어 이하이고, 안내|소개|후기|혜택|문의|방법 등 헤딩성 명사로 끝나지 않는 순수 슬롯 탐지
 */
export function findPlaceholders(text?: string | null): string[] {
  if (!text) return []

  const results: string[] = []

  if (isInformationRequest(text)) {
    results.push(INFO_REQUEST_PLACEHOLDER)
  }

  const matches = text.matchAll(BRACKET_PATTERN)

  for (const match of matches) {
    const full = match[0]
    const inner = match[1]
    const matchIndex = match.index ?? 0
    const afterIndex = matchIndex + full.length

    // 마크다운 링크 [text](url) 형태 제외
    if (afterIndex < text.length && text[afterIndex] === '(') {
      continue
    }

    // 마크다운 이미지 ![alt] 형태 제외
    if (matchIndex > 0 && text[matchIndex - 1] === '!') {
      continue
    }

    // 줄 시작 헤딩/태그 스타일 ([예약 문의] 카카오톡으로 …) 제외
    if (isLineStartHeading(text, matchIndex, afterIndex)) {
      continue
    }

    const trimmedInner = inner.trim()

    // 1. 명시적 빈칸 접미사 (입력, 기재, 작성, OOO, XXX, __ 등)
    if (ACTION_PLACEHOLDER_SUFFIX_PATTERN.test(trimmedInner)) {
      results.push(full)
      continue
    }

    // 2. [문의 방법 또는 예약 방법] 등 '또는'으로 연결된 복합 슬롯 빈칸
    if (trimmedInner.includes(' 또는 ') && SLOT_WORDS.some((word) => trimmedInner.includes(word))) {
      results.push(full)
      continue
    }

    // 3. 일반 슬롯: 슬롯 단어 포함 + 2단어 이하 + 헤딩성 명사 접미사(안내|소개|후기|혜택|문의|방법) 아님
    const hasSlotWord = SLOT_WORDS.some((word) => trimmedInner.includes(word))
    const words = trimmedInner.split(/\s+/u)
    const isHeadingEnding = HEADING_NOUN_ENDINGS_PATTERN.test(trimmedInner)

    if (hasSlotWord && words.length <= 2 && !isHeadingEnding) {
      results.push(full)
    }
  }

  return Array.from(new Set(results))
}

/**
 * 캡션과 해시태그를 하나로 묶어 채워지지 않은 빈칸을 탐지하는 단일 공유 헬퍼입니다.
 */
export function findPlaceholdersInVersion(version?: {
  caption?: string | null
  hashtags?: readonly string[] | string[] | null
} | null): string[] {
  if (!version) return []
  const joined = [version.caption, (version.hashtags ?? []).join(' ')].filter(Boolean).join('\n')
  return findPlaceholders(joined)
}

