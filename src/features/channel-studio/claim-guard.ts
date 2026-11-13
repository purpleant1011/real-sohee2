import type { ClaimChecker } from './ports'
import type { GroundedFact } from './types'

// Work on the same compact NFKC representation for both detection and evidence matching.
// Keep punctuation (except grouping commas) so 1+1, No.1 and time ranges remain distinguishable.
const PRICE = /(?:₩\d+(?:\.\d+)?|\d+(?:\.\d+)?(?:[천만억]\d+(?:\.\d+)?)*(?:천|만|억)?원|[일이삼사오육칠팔구십백천만억]+원|\d+(?:\.\d+)?(?:won|k)(?![a-z\d]))/gu
const DISCOUNT = /(?:\d+(?:\.\d+)?%(?:할인|세일|쿠폰|off)?|할인|쿠폰|무료|증정|이벤트|기간한정|한정판매|특가|사은품|프로모션|반값|세일|free(?!dom|lance|way)|halfprice|specialdeal|buy\d+get\d+|\d+\+\d+|\d+(?:\.\d+)?%off)/gu
const HOURS = /(?:영업시간|운영시간|영업(?:중|종료|시작)|연중무휴|24시간(?:영업|운영|케어)|매일(?:오전|오후|\d)|\d{1,2}:\d{2}(?:~|[-–]|부터|까지)?(?:\d{1,2}:\d{2})?|\d{1,2}시(?:부터|까지|오픈|마감)|open\d{1,2}(?::\d{2})?(?:am|pm)(?:-|~|to)\d{1,2}(?::\d{2})?(?:am|pm)(?:daily)?|24\/7)/gu
const MEDICAL = /(?:완치|치료|치유|통증(?:완화|개선)|질병(?:예방|치료)|부작용없|효능|효과보장|의학적으로입증|\d+%(?:개선|효과|교정|보장)|\d+등급을100%보장)/gu
const PERIOD = /(?:오늘(?:까지|만)|이번(?:주말|주|달)(?:까지|만)|기간한정|선착순\d+명)/gu
const BENEFIT = /(?:할인|쿠폰|무료|증정|이벤트|혜택|특가|사은품|프로모션|반값|세일|free|halfprice|specialdeal|buy\d+get\d+|\d+\+\d+|%off)/u
const NEGATED_BENEFIT = /(?:없음|없습니다|없는|진행하지않|안함)/u
const AWARD = /(?:대상수상|금상수상|금메달수상|최우수상|우수브랜드|장관상|국무총리상|그랑프리|챔피언십|월드컵|미쉐린|어워드|\d+(?:위|등)(?![\d])|no\.\d+|선정|인증|수상|최고)/gu

function strings(value: unknown): { texts: string[]; overflow: boolean } {
  const texts: string[] = []
  let overflow = false
  const visited = new Set<object>()
  function visit(part: unknown, depth: number): void {
    if (depth > 8) { overflow = true; return }
    if (typeof part === 'string') { texts.push(part); return }
    if (!part || typeof part !== 'object') return
    if (visited.has(part)) { overflow = true; return }
    visited.add(part)
    const values = Object.values(part)
    if (values.length > 200) overflow = true
    for (const entry of values.slice(0, 200)) visit(entry, depth + 1)
    visited.delete(part)
  }
  visit(value, 0)
  return { texts, overflow }
}

const normalized = (value: string) => value.normalize('NFKC')
  .replace(/[\s\p{Cf}\p{Cc}]/gu, '').replace(/,/gu, '').toLowerCase()

function containsExact(evidence: string, token: string): boolean {
  if (!/\d/u.test(token)) return evidence.includes(token)
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![\\d,])${escaped}(?![\\d,])`, 'u').test(evidence)
}

function factIsProductSpecific(label: string, value: string): boolean {
  return label.length > 1 && !/(?:메뉴|서비스|가격|요금|혜택|쿠폰|할인|영업시간|운영시간|안내)/u.test(label)
    && normalized(value).includes(normalized(label))
}

function supported(fragment: string, sentence: string, facts: GroundedFact[]): boolean {
  const needle = normalized(fragment)
  const isPrice = matches(needle, PRICE).includes(needle)
  const contextualWords: string[] = sentence.match(/[\p{L}]{2,}/gu) ?? []
  // Exact values and product names must agree, not just the presence of some other price or discount.
  return facts.some(({ label, value }) => {
    const evidence = normalized(`${label} ${value}`)
    if (BENEFIT.test(needle) && NEGATED_BENEFIT.test(normalized(value))) return false
    if (isPrice ? !matches(evidence, PRICE).includes(needle) : !containsExact(evidence, needle)) return false
    const productNames = facts.filter((fact) => fact.kind === 'offering')
      .map((fact) => fact.label).filter((name) => name.length > 1 && name !== '메뉴' && name !== '서비스')
    if (productNames.some((name) => contextualWords.includes(name) && !evidence.includes(normalized(name)))) return false
    if (factIsProductSpecific(label, value) && !normalized(sentence).includes(normalized(label))) return false
    return true
  })
}

function matches(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(re), ([match]) => match)
}

export const checkBusinessClaims: ClaimChecker = (channel, payload, ctx) => {
  const issues = new Set<string>()
  const facts = ctx.facts
  const { texts, overflow } = strings(payload)
  if (overflow) issues.add('검사할 내용이 너무 많아 사실 확인이 필요해요.')
  for (const text of texts) {
    // Remove zero-width, controls and whitespace before splitting, so a line break
    // inside a claim cannot make both halves invisible to detection.
    const sentences = normalized(text).split(/(?<=[!?。])|(?<=다\.)/u)
    for (const sentence of sentences) {
      if (matches(sentence, PRICE).some((token) => !supported(token, sentence, facts))) {
        issues.add('확인된 가격 정보가 없어 가격 문구를 사용할 수 없어요.')
      }
      if (matches(sentence, DISCOUNT).some((token) => !supported(token, sentence, facts))) {
        issues.add('확인된 혜택 정보가 없어 할인·쿠폰 문구를 사용할 수 없어요.')
      }
      if (matches(sentence, PERIOD).some((token) => !supported(token, sentence, facts))) {
        issues.add('확인된 기간 정보가 없어 기간 한정 안내를 사용할 수 없어요.')
      }
      if (matches(sentence, MEDICAL).some((token) => !supported(token, sentence, facts))) {
        issues.add('확인된 효능 정보가 없어 효능을 단정할 수 없어요.')
      }
      if (matches(sentence, HOURS).some((token) => !supported(token, sentence, facts))) {
        issues.add('확인된 영업시간 정보가 없어 운영 시간을 안내할 수 없어요.')
      }
      if (matches(sentence, AWARD).some((token) => !supported(token, sentence, facts))) {
        issues.add('확인된 수상·인증 정보가 없어 해당 내용을 안내할 수 없어요.')
      }
    }
  }
  if (channel === 'daangn_business' && typeof payload.coupon === 'string' && payload.coupon.trim()) {
    const coupon = normalized(payload.coupon)
    if (!facts.some((fact) => BENEFIT.test(normalized(fact.value)) && !NEGATED_BENEFIT.test(normalized(fact.value)) && containsExact(normalized(fact.value), coupon))) {
      issues.add('확인된 혜택 정보가 없어 쿠폰을 사용할 수 없어요.')
    }
  }
  return { status: issues.size ? 'UNKNOWN' : 'OK', issues: [...issues] }
}
