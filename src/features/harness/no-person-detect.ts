const NO_PERSON_PATTERNS: readonly RegExp[] = Object.freeze([
  /비인물/u,
  /no\s*(?:people|person|human|portrait|face)/iu,
  /(?:인물|사람|얼굴|인간|모델)\s*(?:은|는|이|가|도)?\s*(?:없이|없는|없게|제외|금지|빼|말고|피하|피해|안\s*나오|나오지\s*않|안\s*보이|보이지\s*않)/u,
  /(?:인물|사람|얼굴|인간|모델)\s*(?:미포함|배제|불필요)/u,
])

export function isNoPersonRequest(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  return NO_PERSON_PATTERNS.some((pattern) => pattern.test(trimmed))
}
