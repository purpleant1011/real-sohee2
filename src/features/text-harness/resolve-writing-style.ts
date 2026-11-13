const MAX_WRITING_STYLE_LENGTH = 2_000

/**
 * 위험한 비인쇄 제어 문자(\u0000-\u0008, \u000b, \u000c, \u000e-\u001f, \u007f-\u009f)를 제거하고 trim한다.
 * 지시문 포맷팅을 위해 줄바꿈(\n, \r)과 탭(\t)은 보존한다.
 */
function cleanInstructionText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '').trim()
}

/**
 * fallback 인자(문자열 또는 지식 객체)에서 스타일 문자열을 추출한다.
 */
function extractFallback(fallback: unknown): string {
  if (typeof fallback === 'string') return cleanInstructionText(fallback)
  if (fallback && typeof fallback === 'object') {
    const obj = fallback as Record<string, unknown>
    return (
      cleanInstructionText(obj.brandVoice) ||
      cleanInstructionText(obj.text) ||
      cleanInstructionText(obj.voice) ||
      ''
    )
  }
  return ''
}

/**
 * structured_rule 또는 룰 객체에서 brandVoice와 toneAndManner를 안전하게 추출하여 결합한다.
 * - brandVoice 요약(최대 200자)과 toneAndManner 지시문(최대 1,200자)이 모두 있을 때 결합 전달하여 지침 누락을 방지한다.
 * - brandVoice가 없어도 toneAndManner만 있으면 유효하게 처리한다.
 * - 룰에 스타일이 없으면 기존 지식 fallback을 보존한다.
 * - 합계 2,000자 상한(기본값)으로 슬라이스하여 안전 범위를 보장한다.
 */
export function resolveWritingStyle(
  source: unknown,
  fallback?: unknown,
  maxLength = MAX_WRITING_STYLE_LENGTH,
): string {
  let ruleObj: Record<string, unknown> | null = null
  if (source && typeof source === 'object') {
    const raw = source as Record<string, unknown>
    if (raw.structured_rule && typeof raw.structured_rule === 'object') {
      ruleObj = raw.structured_rule as Record<string, unknown>
    } else if (raw.structuredRule && typeof raw.structuredRule === 'object') {
      ruleObj = raw.structuredRule as Record<string, unknown>
    } else {
      ruleObj = raw
    }
  }

  const brandVoice = ruleObj ? cleanInstructionText(ruleObj.brandVoice) : ''
  const toneAndManner = ruleObj ? cleanInstructionText(ruleObj.toneAndManner) : ''

  let combined = ''
  if (brandVoice && toneAndManner) {
    if (brandVoice === toneAndManner || toneAndManner.startsWith(brandVoice)) {
      combined = toneAndManner
    } else if (toneAndManner.includes('[글 구조·말투 지시]')) {
      combined = `${brandVoice}\n\n${toneAndManner}`
    } else {
      combined = `${brandVoice}\n\n[글 구조·말투 지시]\n${toneAndManner}`
    }
  } else if (brandVoice) {
    combined = brandVoice
  } else if (toneAndManner) {
    combined = toneAndManner
  } else {
    combined = extractFallback(fallback)
  }

  return combined.slice(0, maxLength)
}
